"""Account-bound WebRTC signaling. Only call metadata is stored, never media or SDP."""
import asyncio
import json
import logging
import secrets
import time
import uuid
from contextlib import closing
from dataclasses import dataclass, field
from datetime import timedelta
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from app.auth import ApiError, _connect, _now, signed_in_user_id

router=APIRouter(prefix='/api/v1/live-voice',tags=['live voice'])
TABLE='''CREATE TABLE IF NOT EXISTS caregiver_calls (
call_id CHAR(36) PRIMARY KEY, user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
session_id CHAR(36) NOT NULL, caller_name VARCHAR(80) NOT NULL,
started_at DATETIME(3) NOT NULL, ended_at DATETIME(3) NULL, end_reason VARCHAR(24) NULL,
INDEX calls_owner(user_id,started_at),
FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE)'''

@dataclass
class Call:
    call_id: str
    owner: str
    session_id: str
    caller_name: str
    created: float = field(default_factory=time.monotonic)
    peers: dict = field(default_factory=dict)
    tickets: dict = field(default_factory=dict)

calls: dict[str,Call]={}

def expire_metadata():
    # Only this new feature's ended-call metadata; legacy notes are left intact.
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM caregiver_calls WHERE ended_at < %s', (_now()-timedelta(hours=24),))

async def maintain_calls():
    while True:
        await asyncio.sleep(3600)
        try: await asyncio.to_thread(expire_metadata)
        except Exception:
            logging.getLogger(__name__).warning('Call metadata expiry failed; retrying next hour.')

def init_calls():
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(TABLE)
        # A process restart cannot resume old peer connections. Keep their metadata.
        cur.execute("UPDATE caregiver_calls SET ended_at=%s,end_reason='server_restart' WHERE ended_at IS NULL",(_now(),))

def record_end(call,reason):
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute('UPDATE caregiver_calls SET ended_at=%s,end_reason=%s WHERE call_id=%s AND ended_at IS NULL',(_now(),reason,call.call_id))

async def end(call,reason='ended'):
    if calls.pop(call.call_id,None) is None: return
    call.tickets.clear()
    for peer in list(call.peers.values()):
        try: await peer.close(code=1000,reason=reason)
        except Exception: pass
    call.peers.clear()
    await asyncio.to_thread(record_end,call,reason)

def owned(call_id,user_id):
    call=calls.get(call_id)
    if not call or call.owner!=user_id: raise ApiError(404,'call_not_found','Live call not found.')
    return call

def ticket(call,role):
    token=secrets.token_urlsafe(32)
    call.tickets={k:v for k,v in call.tickets.items() if v[1]>time.monotonic() and v[0]!=role}
    call.tickets[token]=(role,time.monotonic()+20)
    return {'call_id':call.call_id,'ticket':token,'caller_name':call.caller_name}

class Start(BaseModel):
    session_id: uuid.UUID

@router.post('/start')
async def start(body: Start,user_id=Depends(signed_in_user_id)):
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT s.session_id,u.name FROM sessions s JOIN users u ON s.user_id=u.user_id WHERE s.session_id=%s AND s.user_id=%s AND s.status='live'",(str(body.session_id),user_id))
        row=cur.fetchone()
        if not row: raise ApiError(403,'phone_unavailable','No active phone linked to this account.')
        if any(c.owner==user_id for c in calls.values()): raise ApiError(409,'call_busy','A call is already connecting or live.')
        call=Call(str(uuid.uuid4()),user_id,str(body.session_id),row['name'])
        cur.execute('INSERT INTO caregiver_calls(call_id,user_id,session_id,caller_name,started_at) VALUES(%s,%s,%s,%s,%s)',(call.call_id,user_id,call.session_id,call.caller_name,_now()))
    calls[call.call_id]=call
    async def expire():
        await asyncio.sleep(30)
        if len(call.peers)<2: await end(call,'not_answered')
    asyncio.create_task(expire())
    return ticket(call,'dashboard')

@router.get('/pending')
async def pending(session_id: uuid.UUID,user_id=Depends(signed_in_user_id)):
    call=next((c for c in calls.values() if c.owner==user_id and c.session_id==str(session_id)),None)
    return {'call':{'call_id':call.call_id,'caller_name':call.caller_name} if call else None}

@router.post('/{call_id}/join')
async def join(call_id: str,user_id=Depends(signed_in_user_id)):
    return ticket(owned(call_id,user_id),'phone')

@router.post('/{call_id}/end')
async def finish(call_id: str,user_id=Depends(signed_in_user_id)):
    await end(owned(call_id,user_id),'user_ended')
    return {'ok':True}

@router.websocket('/signal')
async def signal(ws: WebSocket):
    # Secret is the first frame, never a URL/query value in access logs.
    await ws.accept()
    call=None; role=None
    try:
        raw=await asyncio.wait_for(ws.receive_text(),5)
        if len(raw)>1024: raise ValueError()
        hello=json.loads(raw)
        if not isinstance(hello,dict): raise ValueError()
        call=calls.get(hello.get('call_id')); token=hello.get('ticket')
        auth=call.tickets.pop(token,None) if call else None
        if not auth or auth[1]<time.monotonic():
            await ws.close(code=4401); return
        role=auth[0]
        if role in call.peers:
            await ws.close(code=4409); role=None; return
        call.peers[role]=ws
        if len(call.peers)==2:
            for peer in call.peers.values(): await peer.send_json({'type':'ready'})
        while True:
            raw=await asyncio.wait_for(ws.receive_text(),35)
            if len(raw)>65536: raise ValueError()
            message=json.loads(raw)
            if not isinstance(message,dict): raise ValueError()
            kind=message.get('type')
            if kind=='ping': await ws.send_json({'type':'pong'}); continue
            if kind not in ('offer','answer','ice') or (kind=='offer' and role!='dashboard') or (kind=='answer' and role!='phone'): raise ValueError()
            other=call.peers.get('phone' if role=='dashboard' else 'dashboard')
            if other: await other.send_json(message)
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, TypeError, KeyError): pass
    finally:
        if call and role and call.peers.get(role) is ws: await end(call,'disconnected')
        else:
            try: await ws.close(code=4401)
            except Exception: pass

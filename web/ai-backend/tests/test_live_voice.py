import uuid
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.auth import signed_in_user_id
from app import live_voice as live

@pytest.fixture
def context(monkeypatch):
    owner=['owner-a']; connection=MagicMock();cursor=connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value={'name':'Caregiver','session_id':'test'}
    monkeypatch.setattr(live,'_connect',lambda:connection)
    monkeypatch.setattr(live,'record_end',lambda *args:None)
    app.dependency_overrides[signed_in_user_id]=lambda:owner[0]
    live.calls.clear()
    yield TestClient(app),owner,cursor
    app.dependency_overrides.clear();live.calls.clear()

def start(client):
    result=client.post('/api/v1/live-voice/start',json={'session_id':str(uuid.uuid4())})
    assert result.status_code==200
    return result.json()

def test_account_boundary_and_retired_notes(context):
    client,owner,cur=context
    call=start(client);owner[0]='other-account'
    assert client.post('/api/v1/live-voice/'+call['call_id']+'/join').status_code==404
    assert client.post('/api/v1/live-voice/'+call['call_id']+'/end').status_code==404
    cur.fetchone.return_value=None
    assert client.post('/api/v1/live-voice/start',json={'session_id':str(uuid.uuid4())}).status_code==403
    assert client.post('/api/v1/notes',json={'text':'retired'}).status_code==404

def test_signaling_and_disconnect_end_metadata(context):
    client,_,_=context
    call=start(client);phone=client.post('/api/v1/live-voice/'+call['call_id']+'/join').json()
    with client.websocket_connect('/api/v1/live-voice/signal') as sender:
        sender.send_json(call)
        with client.websocket_connect('/api/v1/live-voice/signal') as receiver:
            receiver.send_json(phone)
            assert receiver.receive_json()=={'type':'ready'}
            assert sender.receive_json()=={'type':'ready'}
            sender.send_json({'type':'offer','sdp':'synthetic'})
            assert receiver.receive_json()['sdp']=='synthetic'
            receiver.send_json({'type':'answer','sdp':'response'})
            assert sender.receive_json()['type']=='answer'
            sender.send_json({'type':'ping'});assert sender.receive_json()['type']=='pong'
    assert call['call_id'] not in live.calls

def test_bad_ticket_and_two_quick_cycles(context):
    client,_,_=context
    from starlette.websockets import WebSocketDisconnect
    with client.websocket_connect('/api/v1/live-voice/signal') as ws:
        ws.send_json({'call_id':'missing','ticket':'wrong'})
        with pytest.raises(WebSocketDisconnect) as error: ws.receive_json()
        assert error.value.code==4401
    for _ in range(2):
        call=start(client)
        assert client.post('/api/v1/live-voice/'+call['call_id']+'/end').status_code==200
        assert not live.calls

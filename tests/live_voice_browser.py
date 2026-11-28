"""Real browser WebRTC loopback with synthesized microphone input; no recording files.
Run with scripts/with-env.mjs so cleanup uses the intended development database.
Requires Playwright Python and an installed Chrome (or PLAYWRIGHT_BROWSER path).
"""
import asyncio
import json
import os
import secrets
import uuid
import pymysql
from playwright.async_api import async_playwright

ORIGIN='http://localhost:5174'
PHONE = '''async () => {
 window.received=0;window.level=0;window.arrival=0;
 window.phoneConnect=async (call) => {
   const ticket=await fetch('/api/v1/live-voice/'+call.call_id+'/join',{method:'POST'}).then(r=>r.json());
   const peer=window.phonePeer=new RTCPeerConnection({iceServers:[]});
   peer.addTransceiver('audio',{direction:'recvonly'});
   peer.ontrack=event=>{
     window.remoteTrack=event.track;
     const element=window.remoteAudio=new Audio();element.autoplay=true;element.volume=0;element.srcObject=new MediaStream([event.track]);void element.play().catch(()=>{});
     const context=window.recvAudio=new AudioContext();context.resume();
     const analyser=context.createAnalyser();analyser.fftSize=256;
     context.createMediaStreamSource(new MediaStream([event.track])).connect(analyser);
     const silent=context.createGain();silent.gain.value=0;analyser.connect(silent).connect(context.destination);
     const values=new Float32Array(256);
     window.sampleTimer=setInterval(()=>{analyser.getFloatTimeDomainData(values);window.level=Math.sqrt(values.reduce((s,v)=>s+v*v,0)/256);if(window.level>.01&&!window.arrival)window.arrival=Date.now();},10);
   };
   const socket=window.phoneSocket=new WebSocket(location.origin.replace('http','ws')+'/api/v1/live-voice/signal');
   const send=value=>{if(socket.readyState===1)socket.send(JSON.stringify(value));};
   const candidates=[];
   peer.onicecandidate=e=>{if(e.candidate)send({type:'ice',candidate:e.candidate.toJSON()});};
   socket.onopen=()=>{send(ticket);window.phonePing=setInterval(()=>send({type:'ping'}),10000);};
   socket.onmessage=async event=>{
     const msg=JSON.parse(event.data);
     if(msg.type==='offer'){
       await peer.setRemoteDescription({type:'offer',sdp:msg.sdp});
       for(const c of candidates.splice(0))await peer.addIceCandidate(c);
       const answer=await peer.createAnswer();await peer.setLocalDescription(answer);send({type:'answer',sdp:answer.sdp});
     }
     if(msg.type==='ice'){if(peer.remoteDescription)await peer.addIceCandidate(msg.candidate);else candidates.push(msg.candidate);}
   };
   socket.onclose=()=>{peer.close();clearInterval(window.phonePing);clearInterval(window.sampleTimer);window.recvAudio?.close();window.remoteAudio?.pause();if(window.remoteAudio)window.remoteAudio.srcObject=null;};
 };
}'''
SENDER = '''async () => {
 const {LiveVoiceSender}=await import('/src/services/liveVoiceClient.js');
 window.sender=new LiveVoiceSender((state,error)=>{window.callState=state;window.callError=error;},value=>window.micLevel=value);
 navigator.mediaDevices.getUserMedia=async()=>{
   const context=window.testAudio=new AudioContext();await context.resume();
   const oscillator=context.createOscillator(),gain=window.testGain=context.createGain(),destination=context.createMediaStreamDestination();
   gain.gain.value=0;oscillator.connect(gain).connect(destination);oscillator.start();
   window.syntheticStream=destination.stream;return destination.stream;
 };
}'''

async def main():
    emails=[];report=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.getenv('PLAYWRIGHT_BROWSER',r'C:\Program Files\Google\Chrome\Application\chrome.exe'),headless=True,args=['--autoplay-policy=no-user-gesture-required'])
        context=await browser.new_context()
        other=await browser.new_context()
        try:
            for ctx in (context,other):
                email='voice-browser-'+uuid.uuid4().hex+'@example.invalid';emails.append(email)
                result=await ctx.request.post(ORIGIN+'/api/v1/auth/signup',data={'name':'Synthetic caregiver','email':email,'password':secrets.token_urlsafe(24)})
                assert result.status==201
            session=str(uuid.uuid4())
            assert (await context.request.post(ORIGIN+'/api/v1/streams/start',data={'session_id':session})).status==200
            assert (await other.request.post(ORIGIN+'/api/v1/live-voice/start',data={'session_id':session})).status==403
            report.append({'check':'unlinked account start','result':'pass'})
            sender=await context.new_page();phone=await context.new_page()
            await sender.goto(ORIGIN);await phone.goto(ORIGIN)
            await sender.evaluate(SENDER);await phone.evaluate(PHONE)
            for cycle in range(3):
                print('Cycle',cycle,flush=True)
                await sender.evaluate('sender.start()')
                call=await sender.evaluate('sender.call')
                assert (await other.request.post(ORIGIN+'/api/v1/live-voice/'+call['call_id']+'/join')).status==404
                await phone.evaluate('(call)=>phoneConnect(call)',call)
                try:
                    await sender.wait_for_function("callState==='Live'",timeout=20000)
                except Exception:
                    print('Sender status:',await sender.evaluate('({state:callState,error:callError,ice:sender.peer?.iceConnectionState})'),flush=True)
                    print('Receiver status:',await phone.evaluate('({ice:phonePeer?.iceConnectionState,signaling:phonePeer?.signalingState,ws:phoneSocket?.readyState})'),flush=True)
                    raise
                await phone.evaluate('window.arrival=0')
                sent=await sender.evaluate('()=>{testGain.gain.value=.3;return Date.now();}')
                try:
                    await phone.wait_for_function('arrival>0',timeout=5000,polling=10)
                except Exception:
                    print('Audio sender',await sender.evaluate('({context:testAudio.state,level:micLevel,track:syntheticStream.getAudioTracks()[0].readyState})'),flush=True)
                    print('Audio receiver',await phone.evaluate('async()=>({context:recvAudio?.state,level,stats:Array.from((await phonePeer.getStats()).values()).filter(x=>x.type==="inbound-rtp").map(x=>({bytes:x.bytesReceived,energy:x.totalAudioEnergy}))})'),flush=True)
                    raise
                latency=await phone.evaluate('arrival')-sent
                stats=await phone.evaluate('async()=>Array.from((await phonePeer.getStats()).values()).filter(x=>x.type==="inbound-rtp"&&x.kind==="audio").map(x=>({bytes:x.bytesReceived,packets:x.packetsReceived}))')
                assert stats and stats[0]['bytes']>0
                await sender.wait_for_function('micLevel>0',timeout=3000)
                report.append({'check':'audio start/restart '+str(cycle+1),'result':'pass','pulse_latency_ms':latency,'rtp':stats,'under_500ms':latency<500})
                if cycle!=1: await sender.evaluate('sender.stop()')
                else:
                    await context.set_offline(True)
                    await sender.wait_for_function("callState!=='Live'",timeout=40000)
                    await context.set_offline(False)
                    await sender.evaluate('sender.stop()')
                    report.append({'check':'network drop closes call; network restored','result':'pass'})
                assert await sender.evaluate('syntheticStream.getTracks().every(t=>t.readyState==="ended")')
                await sender.evaluate('testAudio.close()')
                await asyncio.sleep(.5)
            for cycle in range(2):
                await sender.evaluate('async()=>{await sender.start();sender.stop();await testAudio.close();}')
                await asyncio.sleep(.5)
                assert await sender.evaluate('syntheticStream.getTracks().every(t=>t.readyState==="ended")')
            report.append({'check':'two quick start/stop cycles release microphone','result':'pass'})
            for name in ['NotAllowedError','NotFoundError']:
                await sender.evaluate('(name)=>navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException("test",name);}',name)
                await sender.evaluate('sender.start()')
                assert await sender.evaluate('callState')=='Failed'
                report.append({'check':name,'result':'pass','message':await sender.evaluate('callError')})
            # The actual visible component is present and offers a toggle, no text message form.
            await sender.reload();await sender.wait_for_selector('text=Talk to user')
            assert await sender.get_by_role('button',name='Start talking').count()==1
            assert await sender.locator('textarea').count()==0
            report.append({'check':'dashboard call UI replaces text messaging','result':'pass'})
        finally:
            await browser.close()
            with pymysql.connect(host=os.environ['MYSQL_HOST'],port=int(os.environ['MYSQL_PORT']),user=os.environ['MYSQL_USER'],password=os.environ['MYSQL_PASSWORD'],database=os.environ['MYSQL_DATABASE'],autocommit=True) as conn:
                with conn.cursor() as cur:
                    for email in emails:
                        cur.execute('SELECT user_id FROM users WHERE email=%s',(email,));row=cur.fetchone()
                        if row:
                            cur.execute('DELETE FROM login_sessions WHERE user_id=%s',row)
                            cur.execute('DELETE FROM sessions WHERE user_id=%s',row)
                            cur.execute('DELETE FROM users WHERE user_id=%s',row)
            print(json.dumps(report,indent=2))

if __name__=='__main__': asyncio.run(asyncio.wait_for(main(),120))

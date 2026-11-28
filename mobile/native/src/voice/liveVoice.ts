import { loadRtc } from '../platform/capabilities';
import { nativeFetch } from '../platform/network';
import { boundedFetch } from '../platform/config';
import { memoryAudio } from './localVoice';
import { encode64, wav16 } from './pcm';
import type { Language } from '../shared/types';

export const liveCopy = {
 en: { speaking: 'Caregiver is speaking.', end: 'End live voice', failed: 'Live voice unavailable. Check the connection and install the latest app build.' },
 ar: { speaking: 'مقدّم الرعاية يتحدث الآن.', end: 'إنهاء الصوت المباشر', failed: 'الصوت المباشر غير متاح. تحقق من الاتصال وحدّث التطبيق.' },
 fr: { speaking: 'Votre accompagnant vous parle.', end: 'Terminer la voix en direct', failed: 'Voix en direct indisponible. Vérifiez la connexion et mettez à jour l’application.' },
};

export class LiveVoiceReceiver {
  private stopped = false;
  private call?: string;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private peer?: InstanceType<ReturnType<typeof loadRtc>['RTCPeerConnection']>;
  private socket?: WebSocket;
  constructor(private origin: string, private sessionId: string, private language: () => Language,
    private begin: () => Promise<boolean>, private ended: () => void, private failed: (text: string) => void) {}
  private async request(path: string, method = 'POST') {
    const response = await boundedFetch(this.origin+'/api/v1/live-voice'+path,{method,credentials:'include'},5000,nativeFetch);
    if (!response.ok) throw Error('live_voice_failed');
    return response.json();
  }
  start() { void this.poll(); }
  private async poll() {
    try {
      if (!this.call && !this.stopped) {
        const result = await this.request('/pending?session_id='+encodeURIComponent(this.sessionId),'GET');
        if (result.call && !this.stopped) await this.connect(result.call.call_id);
      }
    } catch { if (this.call) { this.failed(liveCopy[this.language()].failed); this.end(); } }
    finally { if (!this.stopped) this.pollTimer=setTimeout(() => void this.poll(),1000); }
  }
  private async connect(id: string) {
    this.call=id;
    const current=() => !this.stopped && this.call===id;
    if (!memoryAudio?.routeSpeaker) throw Error('native_required');
    // Pause Aether and announce before accepting any remote media.
    if (!await this.begin() || !current()) { this.end(); return; }
    await memoryAudio.routeSpeaker(true);
    if (!current()) { await memoryAudio.routeSpeaker(false); return; }
    const ticket=await this.request('/'+id+'/join');
    if (!current()) return;
    const rtc=loadRtc(), peer=this.peer=new rtc.RTCPeerConnection({iceServers:[]});
    peer.addTransceiver('audio',{direction:'recvonly'});
    const socket=this.socket=new WebSocket(this.origin.replace(/^http/,'ws')+'/api/v1/live-voice/signal');
    const send=(value: unknown) => { if (current() && socket.readyState===1) socket.send(JSON.stringify(value)); };
    const candidates: unknown[]=[];
    peer.addEventListener('icecandidate',event => { if(event.candidate) send({type:'ice',candidate:event.candidate.toJSON()}); });
    peer.addEventListener('connectionstatechange',() => {
      if (!current()) return;
      if(peer.connectionState==='connected') clearTimeout(this.deadline);
      if(['failed','disconnected','closed'].includes(peer.connectionState)) { this.failed(liveCopy[this.language()].failed);this.end(); }
    });
    let lastPong=Date.now();
    socket.onopen=() => {send(ticket);this.ping=setInterval(() => {if(Date.now()-lastPong>25000) this.end();else send({type:'ping'});},10000);};
    socket.onmessage=async event => {
      try {
        if (!current()) return;
        const message=JSON.parse(String(event.data));
        if(message.type==='pong') lastPong=Date.now();
        if(message.type==='offer') {
          await peer.setRemoteDescription(new rtc.RTCSessionDescription({type:'offer',sdp:message.sdp}));
          for(const candidate of candidates.splice(0)) await peer.addIceCandidate(new rtc.RTCIceCandidate(candidate as any));
          const answer=await peer.createAnswer();
          if (!current()) return;
          await peer.setLocalDescription(answer);send({type:'answer',sdp:answer.sdp});
        }
        if(message.type==='ice') {if(peer.remoteDescription) await peer.addIceCandidate(new rtc.RTCIceCandidate(message.candidate));else candidates.push(message.candidate);}
      } catch { if(current()) {this.failed(liveCopy[this.language()].failed);this.end();} }
    };
    socket.onclose=() => {if(current()) this.end();};
    socket.onerror=() => {if(current()) {this.failed(liveCopy[this.language()].failed);this.end();}};
    this.deadline=setTimeout(() => {if(current()) {this.failed(liveCopy[this.language()].failed);this.end();}},25000);
  }
  end = () => {
    const id=this.call;this.call=undefined;
    clearInterval(this.ping);clearTimeout(this.deadline);
    this.socket?.close();this.socket=undefined;this.peer?.close();this.peer=undefined;
    void memoryAudio?.routeSpeaker?.(false).catch(() => {});
    if(id) {void this.request('/'+id+'/end').catch(() => {});this.ended();}
  };
  stop() {this.stopped=true;clearTimeout(this.pollTimer);this.end();}
}

export async function liveChime() {
  if(!memoryAudio) return;
  const data=new Uint8Array(6400), view=new DataView(data.buffer);
  for(let i=0;i<3200;i++) view.setInt16(i*2,Math.sin(2*Math.PI*880*i/16000)*6000*Math.sin(Math.PI*i/3200),true);
  await memoryAudio.play(encode64(wav16([data])),1,'live-chime');
}

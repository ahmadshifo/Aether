import { useEffect, useRef, useState } from 'react';
import { LiveVoiceSender } from '../services/liveVoiceClient';
export default function TalkToUser() {
  const [state,setState]=useState('Ended'), [error,setError]=useState(''), [level,setLevel]=useState(0);
  const sender=useRef(null);
  useEffect(() => {
    sender.current=new LiveVoiceSender((next,message) => {setState(next);setError(message);},setLevel);
    return () => sender.current?.stop(false);
  },[]);
  const active=state==='Connecting'||state==='Live';
  return <section className="card section section-tight" aria-label="Talk to user">
    <h2 className="card-title">Talk to user</h2>
    <p>Your microphone streams live to the active phone on this account. Audio is not recorded.</p>
    <p role="status">{state}</p>
    <meter aria-label="Microphone level" min="0" max="1" value={level} style={{width:'100%'}} />
    {error && <p role="alert">{error}</p>}
    <button className="btn" aria-pressed={active} onClick={() => active ? sender.current?.stop() : void sender.current?.start()}>{active?'Stop talking':'Start talking'}</button>
  </section>;
}

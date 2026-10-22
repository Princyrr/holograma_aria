import {useEffect,useRef,useState} from 'react';
import {LiveSession,type LivePhase,type LiveTurn} from './live/live-session';

export default function LiveVoiceChat(){
  const [phase,setPhase]=useState<'idle'|LivePhase>('idle');
  const [notice,setNotice]=useState('Ative o microfone para conversar em tempo real.');
  const session=useRef<LiveSession|null>(null),history=useRef<LiveTurn[]>([]),generation=useRef(0);
  const greeting=useRef<{abort:AbortController;audio:HTMLAudioElement|null;url:string}|null>(null);
  const cache=useRef(new Map<string,Blob>());
  function stopGreeting(){const current=greeting.current;if(!current)return;greeting.current=null;current.abort.abort();if(current.audio){current.audio.onended=null;current.audio.onerror=null;current.audio.onplaying=null;current.audio.pause();}if(current.url)URL.revokeObjectURL(current.url);window.dispatchEvent(new Event('aria-audio-end'));}
  function stop(){generation.current++;session.current?.stop();session.current=null;stopGreeting();setPhase('idle');setNotice('Conversa pausada. Ative o microfone para continuar.');}
  function start(){
    if(session.current){stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext||!window.AudioWorkletNode){setNotice('Use um navegador atualizado e permita o microfone para conversar em tempo real.');return;}
    stopGreeting();window.dispatchEvent(new Event('aria-stop'));
    const current=++generation.current;
    const live=new LiveSession({
      phase:value=>{if(current!==generation.current)return;setPhase(value);setNotice(value==='connecting'?'Conectando a voz em tempo real…':value==='speaking'?'Aria está falando. Você pode interromper falando.':value==='thinking'?'Aria está respondendo…':'Estou ouvindo. Pode falar e continuar a conversa.');},
      error:message=>{if(current!==generation.current)return;session.current=null;setPhase('idle');setNotice(message);},
      turn:(user,model)=>{if(current!==generation.current)return;history.current=[...history.current,{role:'user',parts:[{text:user.slice(0,8000)}]},{role:'model',parts:[{text:model.slice(0,8000)}]}].slice(-20) as LiveTurn[];}
    },history.current);
    session.current=live;void live.start();
  }
  useEffect(()=>{
    const greet=async(event:Event)=>{
      if(session.current||greeting.current)return;
      const text=(event as CustomEvent).detail?.text;if(typeof text!=='string'||!text)return;
      const current={abort:new AbortController(),audio:null as HTMLAudioElement|null,url:''};greeting.current=current;
      try{
        let blob=cache.current.get(text);
        if(!blob){const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:current.abort.signal});if(!response.ok)throw new Error();blob=await response.blob();cache.current.set(text,blob);}
        if(greeting.current!==current)return;
        current.url=URL.createObjectURL(blob);const audio=new Audio(current.url);current.audio=audio;
        audio.onplaying=()=>{window.dispatchEvent(new Event('aria-greeting-wave'));window.dispatchEvent(new CustomEvent('aria-audio-start',{detail:{text,duration:Number.isFinite(audio.duration)?audio.duration:text.length/12}}));};
        audio.onended=audio.onerror=()=>{if(greeting.current===current)stopGreeting();};
        await audio.play();
      }catch{if(greeting.current===current)stopGreeting();}
    };
    const off=()=>stopGreeting();
    window.addEventListener('aria-greeting',greet);window.addEventListener('aria-camera-off',off);
    return()=>{generation.current++;session.current?.stop();session.current=null;stopGreeting();window.removeEventListener('aria-greeting',greet);window.removeEventListener('aria-camera-off',off);};
  },[]);
  return <section className="voice-chat" aria-label="Converse com a Aria em tempo real">
    <button className="aria-control-button" type="button" onClick={start} aria-pressed={phase!=='idle'}>{phase==='idle'?'🎤 Falar com a Aria':phase==='connecting'?'Cancelar conexão':'Encerrar conversa'}</button>
    <p role="status" aria-live="polite">{notice}</p>
  </section>;
}

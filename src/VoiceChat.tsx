// @refresh reset
import { useEffect, useRef, useState } from 'react';
type Turn={role:'user'|'model';parts:{text:string}[]};
type VoiceClip={url:string;text:string};
type AudioInput={data:string;mimeType:string};
export default function VoiceChat() {
  const [phase,setPhase]=useState<'idle'|'starting'|'listening'|'thinking'|'speaking'>('idle');
  const [notice,setNotice]=useState('Clique no microfone para conversar com a Aria.');
  const [answer,setAnswer]=useState(''),[canReplay,setCanReplay]=useState(false);
  const pendingGreeting=useRef(''),greetingActive=useRef(false),greetingCache=useRef(new Map<string,Blob>()),phaseRef=useRef(phase);
  phaseRef.current=phase;
  const history=useRef<Turn[]>([]),controller=useRef<AbortController|null>(null),run=useRef(0),locked=useRef(false);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),context=useRef<AudioContext|null>(null),meter=useRef(0),recordTimeout=useRef(0);
  const player=useRef<HTMLAudioElement|null>(null),audioUrl=useRef('');
  const clips=useRef<VoiceClip[]>([]),endPlayback=useRef<((played:boolean)=>void)|null>(null);
  function clearClips() {for(const clip of clips.current)URL.revokeObjectURL(clip.url);clips.current=[];}
  function closeMic() {window.clearInterval(meter.current);window.clearTimeout(recordTimeout.current);stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;void context.current?.close();context.current=null;}
  function closeAudio() {endPlayback.current?.(false);endPlayback.current=null;if(player.current){player.current.onended=null;player.current.onerror=null;player.current.onplaying=null;player.current.pause();player.current=null;}window.dispatchEvent(new Event('aria-audio-end'));}
  function cancel() {greetingActive.current=false;run.current++;locked.current=false;controller.current?.abort();const mic=recorder.current;recorder.current=null;if(mic&&mic.state!=='inactive'){mic.onstop=null;mic.stop();}closeMic();closeAudio();window.dispatchEvent(new Event('aria-stop'));}
  useEffect(()=>()=>{cancel();clearClips();if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);},[]);
  function stop() {cancel();setPhase('idle');setNotice('Conversa pausada. Clique no microfone para perguntar novamente.');}
  async function playVoice(url:string,text:string,current:number,wave=false,more=false):Promise<boolean> {
    closeAudio();if(current!==run.current)return false;
    const audio=new Audio(url);player.current=audio;
    return new Promise(resolve=>{
      let settled=false;
      const finish=(error?:string)=>{
        if(settled)return;settled=true;endPlayback.current=null;
        if(current!==run.current){resolve(false);return;}
        window.dispatchEvent(new Event('aria-audio-end'));
        if(error||!more){locked.current=false;setPhase('idle');setCanReplay(true);greetingActive.current=false;setNotice(error||'Clique no microfone para fazer outra pergunta.');}
        else {setPhase('thinking');setNotice('Preparando o restante da resposta…');}
        resolve(!error);
      };
      endPlayback.current=played=>{if(!settled){settled=true;resolve(played);}};
      audio.onplaying=()=>{if(current!==run.current)return;setPhase('speaking');setNotice('Aria está respondendo…');if(wave)window.dispatchEvent(new Event('aria-greeting-wave'));window.dispatchEvent(new CustomEvent('aria-audio-start',{detail:{text,duration:Number.isFinite(audio.duration)?audio.duration:text.length/12}}));};
      audio.onended=()=>finish();audio.onerror=()=>finish('Não foi possível tocar a voz. Clique em Ouvir resposta para tentar novamente.');
      void audio.play().catch(()=>finish('Clique em Ouvir resposta para liberar o áudio.'));
    });
  }
  async function replay() {
    locked.current=true;setPhase('speaking');const current=++run.current;
    if(!clips.current.length){await playVoice(audioUrl.current,answer,current);return;}
    const saved=[...clips.current];
    for(let i=0;i<saved.length;i++)if(!await playVoice(saved[i].url,saved[i].text,current,false,i<saved.length-1))break;
  }
  async function ask(text:string,audio?:AudioInput) {
    text=text.trim();if((!text&&!audio)||locked.current)return;
    locked.current=true;const current=++run.current;setCanReplay(false);closeAudio();window.dispatchEvent(new Event('aria-stop'));
    const contents:Turn[]=[...history.current.slice(-20),{role:'user',parts:[{text:text||'Pergunta por voz'}]}];
    setPhase('thinking');setNotice(audio?'Estou entendendo sua pergunta…':'Aria está pensando…');
    const abort=new AbortController();controller.current=abort;
    const timeout=window.setTimeout(()=>abort.abort(),150000);
    try {
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents,audio}),signal:abort.signal});
      const data=await response.json();if(current!==run.current)return;
      if(!response.ok)throw new Error(data.error||'Não foi possível obter a resposta.');
      if(data.transcript){contents[contents.length-1].parts[0].text=data.transcript;}
      history.current=[...contents,{role:'model',parts:[{text:data.text}]}];setAnswer(data.text);
      setNotice('Preparando a voz natural…');
      clearClips();
      // Only split at a complete sentence; keep short answers in a single request.
      const boundary=String(data.text).match(/^([\s\S]{30,}?[.!?])\s+(?=[A-ZÀ-Ý])/);
      const parts=boundary ? [boundary[1],data.text.slice(boundary[0].length)] : [data.text];
      // Fetch both clips immediately, then play the first without waiting for the second.
      const ready:(VoiceClip|undefined)[]=[];
      const pending=parts.map(async(part:string,index:number)=>{
        try {
          const speech=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:part}),signal:abort.signal});
          if(!speech.ok){const error=await speech.json();throw new Error(error.error||'A resposta chegou, mas a voz natural não ficou disponível.');}
          const blob=await speech.blob();if(current!==run.current||abort.signal.aborted)return {cancelled:true} as const;
          const clip={url:URL.createObjectURL(blob),text:part};ready[index]=clip;clips.current=ready.filter((item):item is VoiceClip=>!!item);return {clip} as const;
        }catch(error){return {error} as const;}
      });
      let playing=true;
      for(let i=0;i<pending.length;i++){
        const result=await pending[i];if(current!==run.current)return;
        if('error' in result)throw result.error;
        if('cancelled' in result)return;
        if(playing)playing=await playVoice(result.clip.url,result.clip.text,current,false,i<pending.length-1);
      }


    } catch(error) {if(current!==run.current)return;closeAudio();abort.abort();locked.current=false;setPhase('idle');setCanReplay(clips.current.length>0);setNotice(error instanceof Error&&error.name!=='AbortError'?error.message:'A resposta demorou demais. Tente novamente.');}
    finally {window.clearTimeout(timeout);}
  }
  async function greet(text:string) {
    if(locked.current||phaseRef.current!=='idle'){pendingGreeting.current=text;return;}
    clearClips();locked.current=true;greetingActive.current=true;const current=++run.current;
    setCanReplay(false);setAnswer(text);setPhase('thinking');setNotice('Aria vai cumprimentar…');
    const abort=new AbortController();controller.current=abort;
    const timeout=window.setTimeout(()=>abort.abort(),65000);
    try {
      let blob=greetingCache.current.get(text);
      if(!blob){const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:abort.signal});if(!response.ok)throw new Error('Não foi possível reproduzir a saudação.');blob=await response.blob();greetingCache.current.set(text,blob);}
      if(current!==run.current)return;
      if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);audioUrl.current=URL.createObjectURL(blob);
      await playVoice(audioUrl.current,text,current,true);
    }catch{if(current!==run.current)return;locked.current=false;greetingActive.current=false;setPhase('idle');setNotice('Não foi possível tocar a saudação. Você pode conversar pelo microfone.');}
    finally{window.clearTimeout(timeout);}
  }
  useEffect(()=>{
    const arrival=(event:Event)=>{const text=(event as CustomEvent).detail.text;void greet(text);};
    const off=()=>{pendingGreeting.current='';if(greetingActive.current){greetingActive.current=false;stop();}};
    window.addEventListener('aria-greeting',arrival);window.addEventListener('aria-camera-off',off);
    return()=>{window.removeEventListener('aria-greeting',arrival);window.removeEventListener('aria-camera-off',off);};
  },[]);
  useEffect(()=>{if(phase==='idle'&&pendingGreeting.current){const text=pendingGreeting.current;pendingGreeting.current='';void greet(text);}},[phase]);
  function sendRecording() {const mic=recorder.current;if(mic&&mic.state!=='inactive'){setPhase('thinking');setNotice('Enviando sua pergunta…');mic.stop();closeMic();}}
  async function listen() {
    if(phase==='listening'){sendRecording();return;}
    if(phase!=='idle'){stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setNotice('Este navegador não permite gravar o microfone. Use Chrome ou Edge para conversar por voz.');return;}
    cancel();clearClips();if(audioUrl.current){URL.revokeObjectURL(audioUrl.current);audioUrl.current='';}setCanReplay(false);setAnswer('');
    const current=run.current;setPhase('starting');setNotice('Permita o microfone para fazer sua pergunta.');
    try {
      const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(current!==run.current){media.getTracks().forEach(track=>track.stop());return;}
      stream.current=media;
      const mimeType=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      const mic=new MediaRecorder(media,mimeType?{mimeType}:undefined);recorder.current=mic;const chunks:Blob[]=[];
      mic.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      mic.onerror=()=>{if(current!==run.current)return;cancel();setPhase('idle');setNotice('Não foi possível gravar. Verifique o microfone e tente novamente.');};
      mic.onstop=async()=>{
        closeMic();recorder.current=null;if(current!==run.current)return;
        try {const blob=new Blob(chunks,{type:mic.mimeType});if(blob.size<200)throw new Error('Não ouvi sua pergunta. Tente novamente.');
          const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Não foi possível ler o áudio.'));reader.readAsDataURL(blob);});
          if(current!==run.current)return;await ask('',{data,mimeType:mic.mimeType.split(';')[0]});
        }catch(error){if(current!==run.current)return;setPhase('idle');setNotice(error instanceof Error?error.message:'Não foi possível enviar o áudio.');}
      };
      mic.start(250);setPhase('listening');setNotice('Estou ouvindo. Fale e faça uma pausa, ou clique em Enviar pergunta.');
      recordTimeout.current=window.setTimeout(sendRecording,30000);
      try {
        const ctx=new AudioContext();context.current=ctx;await ctx.resume();if(current!==run.current||mic.state==='inactive'){closeMic();return;}
        const analyser=ctx.createAnalyser();analyser.fftSize=2048;ctx.createMediaStreamSource(media).connect(analyser);const samples=new Float32Array(analyser.fftSize);let speechFrames=0,lastSpeech=performance.now(),started=performance.now();
        meter.current=window.setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);if(rms>.018){speechFrames++;lastSpeech=performance.now();}if(speechFrames>=3&&performance.now()-lastSpeech>900&&performance.now()-started>1000)sendRecording();},100);
      }catch {/* The Send button remains available when automatic silence detection is unavailable. */}
    }catch(error){if(current!==run.current)return;closeMic();setPhase('idle');setNotice(error instanceof DOMException&&error.name==='NotAllowedError'?'Permita o microfone no navegador para conversar.':'Não foi possível acessar o microfone. Verifique se ele está conectado.');}
  }
  return <section className="voice-chat" aria-label="Converse com a Aria">
    <button className="aria-control-button" type="button" onClick={()=>void listen()} aria-pressed={phase==='listening'}>{phase==='idle'?'🎤 Falar com a Aria':phase==='listening'?'Enviar pergunta':phase==='starting'?'Cancelar microfone':phase==='thinking'?'Cancelar pergunta':'Interromper resposta'}</button>
    <p role="status" aria-live="polite">{notice}</p>
    {canReplay&&phase==='idle'&&<button className="aria-control-button" type="button" onClick={()=>void replay()}>Ouvir resposta</button>}

  </section>;
}

import {useEffect,useRef,useState} from 'react';
import {LiveSession,type LivePhase,type LiveTurn} from './live/live-session';
import {enrollmentChannel,type EnrollmentVoice} from './identity/voice-enrollment';
type EnrollmentConnection={owner:LiveSession;abort:AbortController;reply:((text:string)=>void)|null;close:()=>void};

export default function LiveVoiceChat(){
  const [phase,setPhase]=useState<'idle'|LivePhase>('idle');
  const [notice,setNotice]=useState('Ative o microfone para conversar em tempo real.');
  const session=useRef<LiveSession|null>(null),history=useRef<LiveTurn[]>([]),generation=useRef(0);
  const greeting=useRef<{abort:AbortController;audio:HTMLAudioElement|null;url:string}|null>(null);
  const cache=useRef(new Map<string,Blob>());
  const enrollment=useRef<EnrollmentConnection|null>(null);
  const livePhase=useRef<LivePhase>('connecting'),pendingName=useRef(''),namedSpeaking=useRef(false),greetingRun=useRef(0),resumeTimer=useRef(0);
  function stopGreeting(){const current=greeting.current;if(!current)return;greeting.current=null;current.abort.abort();if(current.audio){current.audio.onended=null;current.audio.onerror=null;current.audio.onplaying=null;current.audio.pause();}if(current.url)URL.revokeObjectURL(current.url);window.dispatchEvent(new Event('aria-audio-end'));}
  function stop(){endEnrollment();pendingName.current='';greetingRun.current++;namedSpeaking.current=false;window.clearTimeout(resumeTimer.current);window.dispatchEvent(new Event('aria-stop'));generation.current++;session.current?.stop();session.current=null;stopGreeting();setPhase('idle');setNotice('Conversa pausada. Ative o microfone para continuar.');}
  async function playGreeting(text:string,onEnd?:(error?:string)=>void){
    const current={abort:new AbortController(),audio:null as HTMLAudioElement|null,url:''};greeting.current=current;
    const finish=(error?:string)=>{if(greeting.current!==current)return;stopGreeting();onEnd?.(error);};
    try{
      let blob=cache.current.get(text);
      if(!blob){
        const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:current.abort.signal});
        if(!response.ok)throw new Error();blob=await response.blob();
        if(greeting.current!==current)return;
        if(cache.current.size>=32)cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(text,blob);
      }
      if(greeting.current!==current)return;
      current.url=URL.createObjectURL(blob);const audio=new Audio(current.url);current.audio=audio;
      audio.onplaying=()=>{if(greeting.current!==current)return;window.dispatchEvent(new Event('aria-greeting-wave'));window.dispatchEvent(new CustomEvent('aria-audio-start',{detail:{text,duration:Number.isFinite(audio.duration)?audio.duration:text.length/12}}));};
      audio.onended=()=>finish();
      audio.onerror=()=>finish('Não foi possível reproduzir a saudação. Desligue e ative a câmera para tentar novamente.');
      await audio.play();
    }catch{finish('Não foi possível gerar a saudação com a voz da Aria. Verifique a conexão e tente novamente.');}
  }
  function endEnrollment(){
    window.dispatchEvent(new Event('aria-conversation-ended'));
    enrollment.current?.close();
  }
  function openEnrollment():EnrollmentVoice|null{
    const owner=session.current;
    if(!owner||livePhase.current!=='listening'||enrollment.current||namedSpeaking.current||greeting.current||pendingName.current)return null;
    const connection:EnrollmentConnection={owner,abort:new AbortController(),reply:null,close:()=>{}};
    connection.close=()=>{
      if(enrollment.current!==connection)return;
      connection.abort.abort();connection.reply=null;enrollment.current=null;
      stopGreeting();owner.setEnrollmentMode(false);
      window.clearTimeout(resumeTimer.current);
      resumeTimer.current=window.setTimeout(()=>{if(session.current===owner&&!enrollment.current&&!namedSpeaking.current)owner.pauseMicrophone(false);},300);
    };
    enrollment.current=connection;owner.setEnrollmentMode(true);owner.pauseMicrophone(true);
    const prompt=(text:string,listen:boolean,signal:AbortSignal):Promise<string>=>new Promise((resolve,reject)=>{
      let settled=false,timer=0;
      const finish=(error?:Error,value='')=>{
        if(settled)return;settled=true;window.clearTimeout(timer);connection.reply=null;
        signal.removeEventListener('abort',abort);connection.abort.signal.removeEventListener('abort',abort);
        if(error)reject(error);else resolve(value);
      };
      const abort=()=>finish(new DOMException('Cadastro cancelado.','AbortError'));
      if(signal.aborted||connection.abort.signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});connection.abort.signal.addEventListener('abort',abort,{once:true});
      owner.pauseMicrophone(true);setNotice(text);
      void playGreeting(text,error=>{
        if(settled)return;
        if(error){finish(new Error(error));return;}
        if(!listen){finish();return;}
        // Let the loudspeaker tail fade before listening for the person's answer.
        timer=window.setTimeout(()=>{
          if(settled)return;
          connection.reply=answer=>{
            if(!answer.trim())return;
            owner.pauseMicrophone(true);finish(undefined,answer);
          };
          owner.pauseMicrophone(false);setNotice('Pode responder. Estou ouvindo seu cadastro.');
          timer=window.setTimeout(()=>finish(new Error('Não ouvi sua resposta. O cadastro foi cancelado. Podemos tentar outra hora.')),35000);
        },300);
      });
    });
    return {ask:(text,signal)=>prompt(text,true,signal),say:async(text,signal)=>{await prompt(text,false,signal);},close:connection.close};
  }
  function speakNamed(text:string){
    if(enrollment.current)return;
    if(session.current&&livePhase.current!=='listening'){pendingName.current=text;return;}
    if(namedSpeaking.current){pendingName.current=text;return;}
    stopGreeting();window.dispatchEvent(new Event('aria-stop'));
    const active=session.current,current=++greetingRun.current;
    window.clearTimeout(resumeTimer.current);active?.pauseMicrophone(true);namedSpeaking.current=true;
    setNotice('Preparando a saudação com a voz da Aria…');
    void playGreeting(text,(error?:string)=>{
      if(current!==greetingRun.current)return;namedSpeaking.current=false;
      if(error)setNotice(error);
      else setNotice(session.current?'Estou ouvindo. Pode continuar.':'Ative o microfone para conversar em tempo real.');
      resumeTimer.current=window.setTimeout(()=>{if(current!==greetingRun.current)return;if(session.current===active)active?.pauseMicrophone(false);if(pendingName.current){const next=pendingName.current;pendingName.current='';speakNamed(next);}},300);
    });
  }
  function start(){
    if(session.current){stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext||!window.AudioWorkletNode){setNotice('Use um navegador atualizado e permita o microfone para conversar em tempo real.');return;}
    greetingRun.current++;namedSpeaking.current=false;pendingName.current='';window.clearTimeout(resumeTimer.current);
    stopGreeting();window.dispatchEvent(new Event('aria-stop'));
    const current=++generation.current;
    const live=new LiveSession({
      phase:value=>{if(current!==generation.current)return;livePhase.current=value;setPhase(value);if(value==='listening'&&pendingName.current&&!namedSpeaking.current&&!enrollment.current){queueMicrotask(()=>{if(current!==generation.current||livePhase.current!=='listening')return;const text=pendingName.current;pendingName.current='';if(text)speakNamed(text);});}if(!enrollment.current)setNotice(value==='connecting'?'Conectando a voz em tempo real…':value==='speaking'?'Aria está falando. Você pode interromper falando.':value==='thinking'?'Aria está respondendo…':'Estou ouvindo. Pode falar e continuar a conversa.');},
      error:message=>{if(current!==generation.current)return;endEnrollment();session.current=null;setPhase('idle');setNotice(message);},
      transcript:text=>{if(current===generation.current)enrollment.current?.reply?.(text);},
      turn:(user,model)=>{if(current!==generation.current)return;history.current=[...history.current,{role:'user',parts:[{text:user.slice(0,8000)}]},{role:'model',parts:[{text:model.slice(0,8000)}]}].slice(-20) as LiveTurn[];}
    },history.current);
    session.current=live;void live.start();
  }
  useEffect(()=>{
    enrollmentChannel.open=openEnrollment;
    const greet=(event:Event)=>{
      if(session.current||greeting.current||namedSpeaking.current||pendingName.current||enrollment.current)return;
      const detail=(event as CustomEvent).detail;
      if(typeof detail?.text!=='string'||!detail.text)return;
      const text=detail.unknown===true?'Olá, tudo bem? Não reconheci seu rosto. Você gostaria de se cadastrar para eu reconhecer você nas próximas visitas? Se quiser, clique em Falar com a Aria para eu ouvir sua resposta.':detail.text;
      if(detail.unknown===true)setNotice('Quer se cadastrar? Clique em Falar com a Aria e responda à pergunta. Só depois vou pedir seu nome.');
      void playGreeting(text,error=>{if(error)setNotice(error);});
    };
    const named=(event:Event)=>{const text=(event as CustomEvent).detail?.text;if(typeof text==='string'&&text.length<=100)speakNamed(text);};
    const off=()=>{endEnrollment();pendingName.current='';greetingRun.current++;namedSpeaking.current=false;window.clearTimeout(resumeTimer.current);session.current?.pauseMicrophone(false);window.dispatchEvent(new Event('aria-stop'));stopGreeting();};
    window.addEventListener('aria-identity-greeting',named);window.addEventListener('aria-greeting',greet);window.addEventListener('aria-camera-off',off);
    return()=>{if(enrollmentChannel.open===openEnrollment)enrollmentChannel.open=null;endEnrollment();greetingRun.current++;window.clearTimeout(resumeTimer.current);window.dispatchEvent(new Event('aria-stop'));window.removeEventListener('aria-identity-greeting',named);generation.current++;session.current?.stop();session.current=null;stopGreeting();window.removeEventListener('aria-greeting',greet);window.removeEventListener('aria-camera-off',off);};
  },[]);
  return <section className="voice-chat" aria-label="Converse com a Aria em tempo real">
    <button className="aria-control-button" type="button" onClick={start} aria-pressed={phase!=='idle'}>{phase==='idle'?'🎤 Falar com a Aria':phase==='connecting'?'Cancelar conexão':'Encerrar conversa'}</button>
    <p role="status" aria-live="polite">{notice}</p>
  </section>;
}

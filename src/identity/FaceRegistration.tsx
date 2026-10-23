import {useEffect,useRef,useState,type RefObject} from 'react';
import {IdentityGreeting,STORAGE_KEY,SAMPLE_COUNT,distance,matchProfile,normalizeName,saveProfiles,validName,validateProfiles,type FaceProfile} from './identity';
import {captureSamples,checkAbort,enrollmentChannel,guidedEnrollment,samePerson,wait,type EnrollmentVoice,type FaceObservation} from './voice-enrollment';
type Props={video:RefObject<HTMLVideoElement>;active:boolean;registrationPage?:boolean;onEnabled:(enabled:boolean)=>void};
export default function FaceRegistration({video,active,registrationPage=false,onEnabled}:Props){
  const [profiles,setProfiles]=useState<FaceProfile[]>([]),[error,setError]=useState('');
  const [name,setName]=useState('Priscila'),[consent,setConsent]=useState(false);
  const [capturing,setCapturing]=useState(false),[notice,setNotice]=useState(''),[progress,setProgress]=useState(0);
  const preview=useRef<HTMLVideoElement>(null),profilesRef=useRef(profiles),mounted=useRef(true),busy=useRef(false),capturingRef=useRef(false);
  const engine=useRef<Promise<typeof import('./face-engine')>|null>(null),currentActive=useRef(active),greetings=useRef(new IdentityGreeting());
  const voiceController=useRef<AbortController|null>(null),manualController=useRef<AbortController|null>(null),storageReady=useRef(false);
  const multiWarned=useRef(false),unknown=useRef<{reference:Float32Array;count:number;offered:boolean}|null>(null),offerAfter=useRef(0);
  profilesRef.current=profiles;currentActive.current=active;
  function load(){if(!engine.current)engine.current=import('./face-engine').then(async value=>{await value.loadFaceEngine();return value;}).catch(error=>{engine.current=null;throw error;});return engine.current;}
  function cancelCapture(){voiceController.current?.abort();manualController.current?.abort();capturingRef.current=false;setCapturing(false);setProgress(0);}
  function commit(next:FaceProfile[]){saveProfiles(next);storageReady.current=true;profilesRef.current=next;setProfiles(next);onEnabled(true);greetings.current=new IdentityGreeting();}
  useEffect(()=>{
    mounted.current=true;onEnabled(true);
    try{const saved=localStorage.getItem(STORAGE_KEY);const values=saved?validateProfiles(JSON.parse(saved)):[];profilesRef.current=values;setProfiles(values);storageReady.current=true;}
    catch{setError('Não foi possível ler o cadastro local. Você pode excluir os cadastros e começar novamente.');}
    return()=>{mounted.current=false;voiceController.current?.abort();manualController.current?.abort();};
  },[]);
  useEffect(()=>{
    const ended=()=>{voiceController.current?.abort();};
    window.addEventListener('aria-conversation-ended',ended);
    return()=>window.removeEventListener('aria-conversation-ended',ended);
  },[]);
  useEffect(()=>{
    if(!active){cancelCapture();greetings.current=new IdentityGreeting();unknown.current=null;multiWarned.current=false;offerAfter.current=0;}
    const element=preview.current;if(!element)return;
    if(registrationPage&&active){element.srcObject=video.current?.srcObject??null;void element.play().catch(()=>{});}else element.srcObject=null;
    return()=>{element.srcObject=null;};
  },[active,registrationPage,video]);
  async function readObservations(signal:AbortSignal):Promise<FaceObservation[]>{
    while(busy.current)await wait(100,signal);
    checkAbort(signal);
    if(!currentActive.current||!mounted.current||document.hidden)throw new DOMException('Cadastro cancelado.','AbortError');
    busy.current=true;
    try{
      const element=video.current;
      if(!element||element.readyState<2)throw new Error('Ative a câmera antes de cadastrar.');
      const api=await load();checkAbort(signal);
      const found=await api.readFace(element);checkAbort(signal);
      return found.map(face=>({descriptor:face.descriptor,score:face.detection.score,widthRatio:face.detection.box.width/element.videoWidth}));
    }finally{busy.current=false;}
  }
  async function enrollByVoice(reference:Float32Array,voice:EnrollmentVoice){
    const controller=new AbortController();voiceController.current=controller;
    capturingRef.current=true;setCapturing(true);setError('');setProgress(0);setNotice('Cadastro por voz iniciado.');
    let saved=false,cancelReason='';
    const monitor=window.setInterval(()=>{
      if(busy.current||controller.signal.aborted||voiceController.current!==controller)return;
      void readObservations(controller.signal).then(faces=>samePerson(faces,reference)).catch(error=>{
        if(controller.signal.aborted)return;
        cancelReason=error instanceof Error?error.message:'O cadastro foi cancelado.';controller.abort();
      });
    },1100);
    try{
      await guidedEnrollment({voice,reference,signal:controller.signal,
        read:()=>readObservations(controller.signal),profiles:()=>profilesRef.current,
        progress:(count,message)=>{if(mounted.current){setProgress(count);setNotice(message);}},
        save:profile=>{
          checkAbort(controller.signal);commit([...profilesRef.current,profile]);saved=true;
          // The confirmation already greets this person; avoid a second immediate greeting.
          for(let i=0;i<3;i++)greetings.current.update(profile,true,performance.now());
          setNotice(`${profile.name} cadastrada com sucesso.`);
        }
      });
      if(!saved&&mounted.current)setNotice('Nenhum novo cadastro foi salvo. Podemos continuar a conversa.');
    }catch(error){
      if(mounted.current){
        const message=cancelReason||(error instanceof Error?error.message:'Não foi possível concluir o cadastro.');
        if(!saved)setNotice(message);
        if(!controller.signal.aborted){
          setError(saved?'O cadastro foi salvo, mas não consegui falar a confirmação.':message);
          if(!saved)try{await voice.say(message,controller.signal);}catch{}
        }
      }
    }finally{
      window.clearInterval(monitor);controller.abort();
      if(voiceController.current===controller){voiceController.current=null;capturingRef.current=false;if(mounted.current)setCapturing(false);}
      voice.close();
    }
  }
  useEffect(()=>{
    if(registrationPage||!active)return;
    let cancelled=false,failed=false,timer=0;onEnabled(true);
    const scan=async()=>{
      if(cancelled||!mounted.current)return;
      try{
        const element=video.current;
        if(!document.hidden&&!capturingRef.current&&!busy.current&&element&&element.readyState>=2){
          busy.current=true;
          try{
            const api=await load();if(cancelled)return;
            const found=await api.readFace(element);if(cancelled||capturingRef.current)return;
            const now=performance.now();
            const person=found.length===1?matchProfile(found[0].descriptor,profilesRef.current):null;
            if(found.length>1&&!multiWarned.current){
              multiWarned.current=true;
              window.dispatchEvent(new CustomEvent('aria-identity-greeting',{detail:{text:'Para reconhecer ou cadastrar pelo nome, fique apenas você na câmera, por favor.'}}));
            }else if(found.length<=1)multiWarned.current=false;
            let offered=false;
            if(found.length===1&&!person){
              if(!unknown.current||distance(unknown.current.reference,found[0].descriptor)>.5)unknown.current={reference:new Float32Array(found[0].descriptor),count:1,offered:false};
              else unknown.current.count++;
              if(!unknown.current.offered&&unknown.current.count>=3&&now>=offerAfter.current&&storageReady.current){
                const voice=enrollmentChannel.open?.();
                if(voice){offered=true;unknown.current.offered=true;offerAfter.current=now+60000;void enrollByVoice(unknown.current.reference,voice);}
              }
            }else unknown.current=null;
            const text=greetings.current.update(person,found.length===1,now);
            if(text&&!offered)window.dispatchEvent(new CustomEvent(person?'aria-identity-greeting':'aria-greeting',{detail:{text,unknown:!person}}));
            if(mounted.current&&!offered)setNotice(found.length>1?'Fique apenas você na câmera para cumprimentar ou cadastrar pelo nome.':person?`${person.name} reconhecida.`:found.length?'Rosto sem correspondência segura. Ative Falar com a Aria para cadastrar por voz.':'Aguardando uma pessoa aparecer.');
          }finally{busy.current=false;}
        }
      }catch{failed=true;if(!cancelled)setError('Não foi possível iniciar a identificação local. Desligue e ative a câmera para tentar novamente, ou exclua o cadastro.');}
      finally{if(!cancelled&&!failed)timer=window.setTimeout(scan,1100);}
    };
    void scan();return()=>{cancelled=true;window.clearTimeout(timer);};
  },[active,profiles,video,onEnabled,registrationPage]);
  async function enroll(){
    const personName=normalizeName(name);
    if(!registrationPage||!active||!consent||!validName(personName)||capturingRef.current)return;
    if(!storageReady.current){setError('Não consegui ler os cadastros anteriores. Exclua os cadastros inválidos antes de cadastrar novamente.');return;}
    const controller=new AbortController();manualController.current=controller;
    capturingRef.current=true;setCapturing(true);setError('');setProgress(0);setNotice('Preparando o cadastro local…');
    try{
      const samples=await captureSamples({signal:controller.signal,read:()=>readObservations(controller.signal),progress:(count,message)=>{setProgress(count);setNotice(message);}});
      checkAbort(controller.signal);
      if(samples.some(sample=>!!matchProfile(new Float32Array(sample),profilesRef.current)))throw new Error('Este rosto já tem um cadastro. Exclua o cadastro anterior se quiser refazê-lo.');
      commit([...profilesRef.current,{id:crypto.randomUUID(),name:personName,descriptors:samples,consentedAt:new Date().toISOString()}]);
      setConsent(false);setNotice(`${personName} cadastrada. Volte para a Aria e ative a câmera para receber o cumprimento.`);
    }catch(error){if(!controller.signal.aborted&&mounted.current)setError(error instanceof Error?error.message:'Não foi possível salvar o cadastro neste navegador.');}
    finally{if(manualController.current===controller){manualController.current=null;capturingRef.current=false;if(mounted.current)setCapturing(false);}}
  }
  function remove(id?:string){cancelCapture();try{const next=id?profilesRef.current.filter(profile=>profile.id!==id):[];commit(next);setError('');setNotice('Cadastro excluído deste navegador.');}catch(error){setError(error instanceof Error?error.message:'O navegador não permitiu excluir o cadastro.');}}
  return <>
    {!registrationPage&&(active||profiles.length>0)&&<small className="identity-status">{active?(notice||'Identificação local ativa.'):'Cadastros salvos neste navegador.'}</small>}
    {!registrationPage&&capturing&&<button className="aria-control-button" type="button" onClick={()=>{cancelCapture();setNotice('Cadastro cancelado.');}}>Cancelar cadastro</button>}
    {error&&!registrationPage&&<p role="alert" className="identity-status">{error}</p>}
    {registrationPage&&<section className="identity-card" aria-labelledby="identity-title">
      <form onSubmit={event=>{event.preventDefault();void enroll();}}>
        <div className="identity-heading"><h2 id="identity-title">Seu cadastro</h2></div>
        <p>Cadastre somente o seu próprio rosto. A comparação acontece neste computador. Salvamos apenas seu nome e uma representação matemática do rosto neste navegador, sem guardar fotos nem enviar imagens ao Google. Para a saudação com a voz humanizada da Aria, enviamos ao Google somente o texto do cumprimento, incluindo o nome reconhecido.</p>
        {!active&&<p role="status">Ative a câmera no botão acima para começar.</p>}
        <video ref={preview} autoPlay muted playsInline className="identity-preview" aria-label="Prévia da câmera para seu cadastro" />
        <label>Seu nome<input value={name} onChange={event=>setName(event.target.value)} disabled={capturing} maxLength={40} autoComplete="given-name" /></label>
        <label className="identity-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} disabled={capturing} />Autorizo o cadastro e a comparação do meu rosto neste navegador e o envio do texto do cumprimento com meu nome ao Google para gerar a voz da Aria. Posso excluir meu cadastro abaixo.</label>
        <button type="submit" disabled={!active||!consent||!validName(normalizeName(name))||capturing}>{capturing?`Capturando ${progress} de ${SAMPLE_COUNT}…`:'Cadastrar meu rosto'}</button>
        {capturing&&<button type="button" onClick={()=>{cancelCapture();setNotice('Captura cancelada. Nenhum novo cadastro foi salvo.');}}>Cancelar captura</button>}
        <p role="status" aria-live="polite">{notice}</p>{error&&<p role="alert">{error}</p>}
        <h3>Cadastros neste navegador ({profiles.length})</h3>
        {profiles.length?profiles.map(profile=><div className="identity-person" key={profile.id}><span>{profile.name}</span><button type="button" disabled={capturing} onClick={()=>remove(profile.id)}>Excluir cadastro de {profile.name}</button></div>):<p>Nenhuma pessoa cadastrada.</p>}
        <button type="button" onClick={()=>remove()} disabled={capturing}>Excluir todos os cadastros</button>
        <small>Sem limite fixo de pessoas; a quantidade depende do espaço disponível neste navegador. Se não houver confiança suficiente, a Aria usa uma saudação genérica. Esta função não deve ser usada para liberar acesso ou autenticar pessoas.</small>
      </form>
    </section>}
  </>;
}

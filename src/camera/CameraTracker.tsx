import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { idleTracking, type CameraTracking } from './tracking';
type Status='off'|'loading'|'on';
export default function CameraTracker({tracking}:{tracking:MutableRefObject<CameraTracking>}) {
  const video=useRef<HTMLVideoElement>(null);
  const diagnostics=useRef<HTMLOutputElement>(null);
  const waveCounts=useRef({frames:0,handFrames:0,fingers:0,sideways:0});
  const stream=useRef<MediaStream|null>(null),worker=useRef<Worker|null>(null);
  const generation=useRef(0),frameRequest=useRef(0),startupTimeout=useRef(0),busy=useRef(false),enabled=useRef(false);
  const [status,setStatus]=useState<Status>('off');
  const [message,setMessage]=useState('Ative para acompanhar seu rosto e reconhecer tchau e beijo.');
  const lastStatus=useRef('');
  const reactionNotice=useRef({text:'',until:0});
  const stop=(notice='Câmera desligada. A personagem acompanha o mouse.')=>{
    window.dispatchEvent(new Event('aria-camera-off'));
    generation.current++;enabled.current=false;
    cancelAnimationFrame(frameRequest.current);window.clearTimeout(startupTimeout.current);
    worker.current?.terminate();worker.current=null;
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    if(video.current)video.current.srcObject=null;
    busy.current=false;tracking.current=idleTracking();setStatus('off');setMessage(notice);
  };
  useEffect(()=>{
    const hidden=()=>{if(document.hidden&&enabled.current)stop('Câmera pausada ao sair da página. Ative novamente para continuar.');};
    document.addEventListener('visibilitychange',hidden);
    return()=>{document.removeEventListener('visibilitychange',hidden);generation.current++;enabled.current=false;cancelAnimationFrame(frameRequest.current);window.clearTimeout(startupTimeout.current);worker.current?.terminate();stream.current?.getTracks().forEach(t=>t.stop());tracking.current=idleTracking();};
  },[]);
  const start=async()=>{
    if(enabled.current)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext){setMessage('A câmera precisa de HTTPS ou localhost e de um navegador com acesso à webcam.');return;}
    if(typeof Worker==='undefined'||typeof createImageBitmap==='undefined'||typeof OffscreenCanvas==='undefined'){setMessage('Use uma versão atual do Chrome, Edge ou Safari para ativar a câmera.');return;}
    enabled.current=true;const run=++generation.current;
    setStatus('loading');setMessage('Preparando o reconhecimento…');lastStatus.current='';
    try {
      const detector=new Worker(new URL('./vision.worker.ts',import.meta.url),{type:'module'});worker.current=detector;
      await new Promise<void>((resolve,reject)=>{
        startupTimeout.current=window.setTimeout(()=>reject(new Error('MODEL_TIMEOUT')),30000);
        detector.onerror=event=>{console.error('Inicialização da visão:',event.message);reject(new Error('MODEL_LOAD'));};
        detector.onmessage=event=>{if(event.data.type==='ready'){window.clearTimeout(startupTimeout.current);resolve();}else if(event.data.type==='error'){console.error('Modelo de visão:',event.data.message);reject(new Error('MODEL_LOAD'));}};
        detector.postMessage({type:'init',base:new URL(import.meta.env.BASE_URL,window.location.href).href});
      });
      if(run!==generation.current)return;
      setMessage('Permita o uso da câmera no navegador.');
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:20}},audio:false});
      if(run!==generation.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;const element=video.current!;element.srcObject=media;await element.play();
      if(run!==generation.current)return;
      media.getVideoTracks()[0]?.addEventListener('ended',()=>{if(run===generation.current)stop('A câmera foi desconectada. Você pode ativá-la novamente.');});
      tracking.current={...idleTracking(),active:true};setStatus('on');setMessage('Procurando seu rosto…');
      detector.onerror=()=>{if(run===generation.current)stop('O reconhecimento foi interrompido. Tente ativar a câmera novamente.');};
      detector.onmessage=event=>{
        if(run!==generation.current)return;
        busy.current=false;const result=event.data;
        if(result.type==='error'){stop('Não foi possível processar a câmera. Tente novamente.');return;}
        if(result.type!=='result')return;
        const now=performance.now();
        if(result.greeting)window.dispatchEvent(new CustomEvent('aria-greeting',{detail:{text:result.greeting}}));
        if(import.meta.env.DEV&&diagnostics.current){
          const counts=waveCounts.current;counts.frames++;
          if(result.handVisible)counts.handFrames++;
          if(result.waveKind==='fingers')counts.fingers++;
          if(result.waveKind==='sideways')counts.sideways++;
          diagnostics.current.textContent=JSON.stringify({...counts,handVisible:result.handVisible,lastWave:result.waveKind??null});
        }
        tracking.current={active:true,found:result.found,x:result.x,y:result.y,updatedAt:now,waveAt:result.wave?now:tracking.current.waveAt,waveKind:result.waveKind??tracking.current.waveKind,kissAt:result.kiss?now:tracking.current.kissAt,smile:result.smile??0,blinkLeft:result.blinkLeft??0,blinkRight:result.blinkRight??0,eyesWide:result.eyesWide??0,browLeft:result.browLeft??0,browRight:result.browRight??0,smileTeeth:result.smileTeeth??0,headYaw:result.headYaw??0,headRoll:result.headRoll??0};
        if(result.wave)reactionNotice.current={text:'Tchau reconhecido: acenando!',until:now+2200};
        if(result.kiss)reactionNotice.current={text:'Beijo reconhecido! Mandando um beijo de volta.',until:now+2200};
        const text=now<reactionNotice.current.until?reactionNotice.current.text:result.kiss?'Beijo reconhecido! Mandando um beijo de volta.':result.wave?'Tchau reconhecido! 😊':result.found?'Acene para ela dar tchau. Faça bico de beijo para ela retribuir.':'Não encontrei seu rosto. Fique de frente para a câmera.';
        if(text!==lastStatus.current){lastStatus.current=text;setMessage(text);}
      };
      let lastSent=0,lastVideoTime=-1;
      const capture=async(now:number)=>{
        if(run!==generation.current)return;
        frameRequest.current=requestAnimationFrame(capture);
        if(busy.current||now-lastSent<100||element.readyState<2||element.currentTime===lastVideoTime)return;
        busy.current=true;lastSent=now;lastVideoTime=element.currentTime;
        try {
          const bitmap=await createImageBitmap(element);
          if(run!==generation.current){bitmap.close();return;}
          detector.postMessage({type:'frame',frame:bitmap,timestamp:now},[bitmap]);
        } catch {busy.current=false;if(run===generation.current)stop('A câmera não conseguiu fornecer vídeo. Tente novamente.');}
      };
      frameRequest.current=requestAnimationFrame(capture);
    } catch(error) {
      if(run!==generation.current)return;
      const name=error instanceof Error?error.name:'';
      const detail=error instanceof Error?error.message:'';
      stop(name==='NotAllowedError'?'Acesso à câmera não autorizado. Permita a câmera nas configurações do navegador e tente novamente.':name==='NotFoundError'?'Nenhuma câmera encontrada neste computador.':name==='NotReadableError'?'A câmera está ocupada por outro aplicativo. Feche-o e tente novamente.':detail==='MODEL_TIMEOUT'?'O reconhecimento demorou para carregar. Tente novamente.':detail==='MODEL_LOAD'?'Não foi possível carregar o reconhecimento. Atualize a página e tente novamente.':'Não foi possível ativar a câmera. Verifique a webcam e tente novamente.');
    }
  };
  return <aside className="camera-panel" aria-label="Controle da câmera">
    <button className="aria-control-button" type="button" onClick={()=>status==='off'?void start():stop()} aria-pressed={status==='on'}>{status==='loading'?'Cancelar ativação':status==='on'?'Desligar câmera':'Ativar câmera'}</button>
    <p className="camera-status camera-status-hidden" role="status">{message}</p>
    {import.meta.env.DEV&&<output ref={diagnostics} data-testid="vision-diagnostics" hidden aria-hidden="true" />}
    <video ref={video} className="camera-preview" hidden autoPlay muted playsInline aria-hidden="true" />
  </aside>;
}

import {distance,matchProfile,normalizeName,SAMPLE_COUNT,validName,type FaceProfile} from './identity';

export type FaceObservation={descriptor:Float32Array;score:number;widthRatio:number};
export type EnrollmentVoice={
  ask:(text:string,signal:AbortSignal)=>Promise<string>;
  say:(text:string,signal:AbortSignal)=>Promise<void>;
  close:()=>void;
};
// Only the active microphone session can open a guided enrollment conversation.
export const enrollmentChannel:{open:(()=>EnrollmentVoice|null)|null}={open:null};

export function checkAbort(signal:AbortSignal){
  if(signal.aborted)throw new DOMException('Cadastro cancelado.','AbortError');
}
export function wait(milliseconds:number,signal:AbortSignal):Promise<void>{
  checkAbort(signal);
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException('Cadastro cancelado.','AbortError'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);
    signal.addEventListener('abort',abort,{once:true});
  });
}
const plain=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,' ').trim().replace(/\s+/g,' ');
export function declined(text:string){return /\b(nao|cancelar|cancela|pare|parar|recuso)\b/.test(plain(text));}
export function spokenName(text:string):string|null{
  if(declined(text))return null;
  const name=normalizeName(text.replace(/^\s*(?:(?:o\s+)?meu nome [eé]|eu me chamo|me chamo|eu sou|sou|pode me chamar de)\s+/iu,'').replace(/[.!?,;:]+\s*$/u,''));
  if(!validName(name)||name.split(' ').length>6||/\b(sim|autorizo|aceito|talvez|quero|cadastro|cadastrar|obrigad[oa])\b/i.test(plain(name)))return null;
  return name;
}
export function authorized(text:string){
  if(declined(text))return false;
  return /^(sim(?: eu)?(?: autorizo| aceito| pode(?: cadastrar(?: meu rosto)?)?)?|(?:eu )?(?:autorizo|aceito)(?: (?:o|meu) cadastro)?|pode (?:me )?cadastrar(?: meu rosto)?)$/.test(plain(text));
}
export function samePerson(faces:FaceObservation[],reference:ArrayLike<number>){
  if(faces.length>1)throw new Error('Mais de uma pessoa apareceu. Para cadastrar, fique apenas você na câmera. O cadastro foi cancelado.');
  if(!faces.length)throw new Error('Não encontrei seu rosto. O cadastro foi cancelado.');
  if(distance(faces[0].descriptor,reference)>.5)throw new Error('O rosto na câmera mudou. O cadastro foi cancelado para não trocar os nomes.');
  return faces[0];
}
type CaptureOptions={
  read:()=>Promise<FaceObservation[]>;signal:AbortSignal;reference?:ArrayLike<number>;
  progress?:(count:number,message:string)=>void;now?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;
};
export async function captureSamples({read,signal,reference,progress,now=()=>performance.now(),sleep=wait}:CaptureOptions){
  const samples:number[][]=[],deadline=now()+45000;
  while(samples.length<SAMPLE_COUNT){
    checkAbort(signal);
    if(now()>deadline)throw new Error('Não consegui capturar seis amostras. Melhore a iluminação e tente novamente.');
    const faces=await read();checkAbort(signal);
    const anchor=reference??samples[0];
    const face=anchor?samePerson(faces,anchor):(faces.length===1?faces[0]:null);
    if(!face)progress?.(samples.length,'Fique apenas você na câmera, com o rosto bem iluminado.');
    else if(face.widthRatio<.22||face.score<.8)progress?.(samples.length,'Aproxime um pouco o rosto da câmera e olhe para a frente.');
    else{
      samples.push(Array.from(face.descriptor));
      progress?.(samples.length,samples.length<3?'Olhe para a câmera.':'Vire levemente o rosto, sem sair da câmera.');
    }
    if(samples.length<SAMPLE_COUNT)await sleep(650,signal);
  }
  return samples;
}
type GuidedOptions={
  voice:EnrollmentVoice;signal:AbortSignal;reference:Float32Array;read:()=>Promise<FaceObservation[]>;
  profiles:()=>FaceProfile[];save:(profile:FaceProfile)=>void;progress?:CaptureOptions['progress'];
  sleep?:CaptureOptions['sleep'];
};
export async function guidedEnrollment({voice,signal,reference,read,profiles,save,progress,sleep}:GuidedOptions){
  const verify=async()=>{checkAbort(signal);const faces=await read();checkAbort(signal);return samePerson(faces,reference);};
  await verify();
  let interested=false;
  for(let attempt=0;attempt<2&&!interested;attempt++){
    const answer=await voice.ask(attempt?'Você quer se cadastrar? Responda sim ou não, por favor.':'Olá, tudo bem? Não reconheci seu rosto. Você gostaria de se cadastrar para eu reconhecer você nas próximas visitas? Diga sim ou não.',signal);
    checkAbort(signal);await verify();
    if(declined(answer)){await voice.say('Tudo bem! Não vou cadastrar seu rosto. Podemos continuar a conversa.',signal);return null;}
    interested=authorized(answer)||/^(?:sim )?(?:eu )?quero(?: (?:me )?cadastrar(?: meu rosto)?)?$/.test(plain(answer));
  }
  if(!interested){await voice.say('Tudo bem! Vou deixar o cadastro para outra hora.',signal);return null;}
  let name:string|null=null;
  for(let attempt=0;attempt<2&&!name;attempt++){
    const answer=await voice.ask(attempt?'Não entendi o nome. Diga apenas seu nome, por favor.':'Qual é o seu nome?',signal);
    checkAbort(signal);await verify();
    if(declined(answer)){await voice.say('Tudo bem! Não vou cadastrar seu rosto.',signal);return null;}
    name=spokenName(answer);
  }
  if(!name){await voice.say('Não consegui entender seu nome. Podemos tentar outra hora. Nenhum cadastro foi salvo.',signal);return null;}
  let consent=false;
  for(let attempt=0;attempt<2&&!consent;attempt++){
    const prompt=attempt?'Não entendi sua autorização. Para cadastrar seu rosto e usar seu nome na voz do Google, diga sim, autorizo. Para recusar, diga não.':`Entendi ${name}. Posso salvar seu nome e a representação do seu rosto neste navegador para reconhecer você? A comparação fica no computador, e o texto com seu nome vai ao Google para gerar minha voz. Você pode excluir em barra cadastro. Diga sim, autorizo, ou não.`;
    const answer=await voice.ask(prompt,signal);checkAbort(signal);await verify();
    if(declined(answer)){await voice.say('Tudo bem! Não vou cadastrar seu rosto.',signal);return null;}
    consent=authorized(answer);
  }
  if(!consent){await voice.say('Sem sua autorização, não vou cadastrar seu rosto.',signal);return null;}
  const consentedAt=new Date().toISOString();
  await voice.say('Obrigada! Vou cadastrar agora. Olhe para a câmera e vire levemente o rosto, sem sair do lugar.',signal);
  const samples=await captureSamples({read,signal,reference,progress,sleep});checkAbort(signal);
  if(samples.some(sample=>matchProfile(new Float32Array(sample),profiles())))throw new Error('Este rosto já tem cadastro. Nenhum cadastro duplicado foi criado.');
  const profile:FaceProfile={id:crypto.randomUUID(),name,descriptors:samples,consentedAt};
  save(profile);
  await voice.say(`Pronto, ${name}! Seu cadastro foi salvo. Agora vou reconhecer você.`,signal);
  return profile;
}

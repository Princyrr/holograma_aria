import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}}).outputText).toString('base64');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('unknown faces explain the microphone button before guided enrollment, which waits for user transcripts and cancels with camera off',async()=>{
 const names=['window','navigator','Audio','fetch','CustomEvent','__ariaVoiceTest'];
 const originals=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const effects=[],audios=[],requests=[],instances=[];
 const fakeWindow=new EventTarget();Object.assign(fakeWindow,{setTimeout,clearTimeout,AudioContext:class{},AudioWorkletNode:class{}});
 const harness={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:effect=>effects.push(effect),React:{createElement:(type,props,...children)=>({type,props,children})},LiveSession:class{
  paused=[];modes=[];constructor(callbacks){this.callbacks=callbacks;instances.push(this);}
  start(){this.callbacks.phase('listening');}stop(){}pauseMicrophone(value){this.paused.push(value);}setEnrollmentMode(value){this.modes.push(value);}
 }};
 const globals={window:fakeWindow,navigator:{mediaDevices:{getUserMedia(){}}},Audio:class{
  constructor(){audios.push(this);this.duration=1;}async play(){this.onplaying?.();}pause(){this.paused=true;}
 },fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return new Response(new Blob(['mock audio']));},CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options?.detail;}},__ariaVoiceTest:harness};
 for(const [name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 let cleanup;
 try{
  const identity=compile(await readFile(new URL('../src/identity/identity.ts',import.meta.url),'utf8'));
  const voiceUrl=compile((await readFile(new URL('../src/identity/voice-enrollment.ts',import.meta.url),'utf8')).replace("'./identity'",JSON.stringify(identity)));
  let source=await readFile(new URL('../src/LiveVoiceChat.tsx',import.meta.url),'utf8');
  source=source.replace(/^import .*\n/gm,'');
  const preamble=`const {useRef,useState,useEffect,React,LiveSession}=globalThis.__ariaVoiceTest;\nimport {enrollmentChannel} from ${JSON.stringify(voiceUrl)};\n`;
  const {default:Component}=await import(compile(preamble+source));
  const {enrollmentChannel}=await import(voiceUrl);
  const tree=Component();cleanup=effects[0]();
  assert.equal(enrollmentChannel.open(),null,'must require the user to start the microphone');
  window.dispatchEvent(new CustomEvent('aria-greeting',{detail:{text:'Olá! Tudo bem?',unknown:true}}));await tick(0);
  assert.match(requests.at(-1).body.text,/Você gostaria de se cadastrar/);assert.match(requests.at(-1).body.text,/ouvir sua resposta/);assert.match(requests.at(-1).body.text,/clique em Falar com a Aria/);
  assert.equal(instances.length,0,'the camera must not silently activate the microphone');
  audios.at(-1).onended();
  tree.children[0].props.onClick();
  const speechRequests=requests.length;
  window.dispatchEvent(new CustomEvent('aria-greeting',{detail:{text:'Olá! Tudo bem?',unknown:true}}));await tick(0);
  assert.equal(requests.length,speechRequests,'an active conversation must not be interrupted by the microphone instruction');
  const session=instances[0],voice=enrollmentChannel.open();assert.ok(voice);assert.equal(enrollmentChannel.open(),null,'one enrollment at a time');
  const controller=new AbortController();
  const reply=voice.ask('Qual é o seu nome?',controller.signal);await tick(0);
  assert.equal(session.paused.at(-1),true);session.callbacks.transcript('Eco da Aria');
  audios.at(-1).onended();await tick(320);
  assert.equal(session.paused.at(-1),false);session.callbacks.transcript('Pessoa Teste');
  assert.equal(await reply,'Pessoa Teste');assert.equal(session.paused.at(-1),true);
  const pending=voice.ask('Posso cadastrar?',controller.signal);const rejection=assert.rejects(pending,{name:'AbortError'});await tick(0);
  window.dispatchEvent(new Event('aria-camera-off'));await rejection;assert.equal(audios.at(-1).paused,true);
  assert.deepEqual(session.modes,[true,false]);assert.ok(requests.every(request=>request.url==='/api/speech'&&Object.keys(request.body).join()==='text'));
  await tick(320);assert.equal(session.paused.at(-1),false);
 }finally{
  cleanup?.();
  for(const name of names){if(originals[name])Object.defineProperty(globalThis,name,originals[name]);else delete globalThis[name];}
 }
});

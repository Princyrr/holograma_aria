import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createLiveToken,chatMiddleware} from '../server/chat.mjs';
const source=(await readFile(new URL('../src/live/live-session.ts',import.meta.url),'utf8')).replace("new URL('./pcm-capture.worklet.js',import.meta.url)",JSON.stringify(new URL('../src/live/pcm-capture.worklet.js',import.meta.url).href));
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
const {LiveSession,encodePcm,decodePcm}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));

test('PCM uses signed little-endian samples, clips peaks and downsamples to 16 kHz',()=>{
 const encoded=encodePcm(new Float32Array([-2,-1,0,.5,1,2]),16000),bytes=Buffer.from(encoded,'base64');
 assert.equal(bytes.readInt16LE(0),-32768);assert.equal(bytes.readInt16LE(6),16384);assert.equal(bytes.readInt16LE(10),32767);
 const decoded=decodePcm(encoded);assert.equal(decoded.length,6);assert.equal(decoded[0],-1);
 assert.equal(Buffer.from(encodePcm(new Float32Array(4800).fill(.5),48000),'base64').length,3200);
 assert.throws(()=>decodePcm('YQ=='),/inválido/);
});

test('temporary credential has one use, short expiry and never returns the permanent key',async()=>{
 let body;
 const result=await createLiveToken({key:'permanent-secret',request:async(url,options)=>{
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/auth_tokens');assert.equal(options.headers['x-goog-api-key'],'permanent-secret');body=JSON.parse(options.body);
  return Response.json({name:'auth_tokens/temporary'});
 }});
 assert.equal(body.uses,1);assert.ok(Date.parse(body.newSessionExpireTime)-Date.now()<=60000);
 assert.equal(result.token,'auth_tokens/temporary');assert.ok(!JSON.stringify(result).includes('permanent-secret'));
 assert.deepEqual(result.setup.generationConfig.responseModalities,['AUDIO']);
 await assert.rejects(createLiveToken({key:'secret',request:async()=>Response.json({})}),{status:502});
 await assert.rejects(createLiveToken(),{status:503});
});

test('token route requires POST, rejects other origins, and disables caching',async()=>{
 let calls=0;
 const middleware=chatMiddleware({key:'secret',request:async()=>{calls++;return Response.json({name:'auth_tokens/test'});}});
 for(const [method,origin,status] of [['GET',undefined,405],['POST','https://other.example',403],['POST','http://localhost:5173',200]]){
  const req={method,url:'/api/live-token',headers:{host:'localhost:5173',origin},async *[Symbol.asyncIterator](){yield '{}';}};
  const headers={};let result;
  const res={statusCode:200,setHeader:(key,value)=>headers[key]=value,end:body=>result=JSON.parse(body)};
  await middleware(req,res,()=>assert.fail('must handle token route'));assert.equal(res.statusCode,status);
  if(status===200){assert.equal(headers['Cache-Control'],'no-store');assert.equal(result.token,'auth_tokens/test');}
 }
 assert.equal(calls,1);
});

function environment({delayedMic=false}={}){
 const names=['window','AudioContext','AudioWorkletNode','WebSocket','navigator','fetch','CustomEvent'];
 const original=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const messages=[],phases=[],errors=[],turns=[],transcripts=[],events=[];let stopped=0,closed=0,released=0,resolveMic;
 const track={stop(){stopped++;},onended:null};const media={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const sourceNodes=[];
 const node=()=>({connect(){},disconnect(){}});
 class Context{
  sampleRate=16000;currentTime=0;destination={};audioWorklet={addModule:async()=>{}};
  resume(){return Promise.resolve();}close(){closed++;return Promise.resolve();}
  createMediaStreamSource(){return node();}createGain(){return {...node(),gain:{value:1}};}
  createBuffer(channels,length,rate){return {duration:length/rate,copyToChannel(){}};}
  createBufferSource(){const source={...node(),onended:null,start(time){this.time=time;},stop(){this.stopped=true;}};sourceNodes.push(source);return source;}
 }
 let capture,socket;
 class Capture{constructor(){capture=this;this.port={onmessage:null,close(){released++;}};}connect(){}disconnect(){}}
 class Socket{
  static OPEN=1;readyState=1;bufferedAmount=0;
  constructor(){socket=this;}send(message){messages.push(JSON.parse(message));}close(){this.closed=true;}
 }
 const globals={window:{dispatchEvent:event=>events.push(event.type)},AudioContext:Context,AudioWorkletNode:Capture,WebSocket:Socket,CustomEvent:class extends Event{constructor(type,options){super(type);this.detail=options.detail;}},navigator:{mediaDevices:{getUserMedia:()=>delayedMic?new Promise(resolve=>resolveMic=resolve):Promise.resolve(media)}},fetch:async()=>Response.json({token:'auth_tokens/temporary',setup:{model:'models/test'}})};
 for(const [name,value]of Object.entries(globals))Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const history=[{role:'user',parts:[{text:'Assunto anterior'}]},{role:'model',parts:[{text:'Contexto anterior'}]}];
 const live=new LiveSession({phase:value=>phases.push(value),error:value=>errors.push(value),turn:(...args)=>turns.push(args),transcript:text=>transcripts.push(text)},history);
 return {live,messages,phases,errors,turns,transcripts,events,sourceNodes,get capture(){return capture;},get socket(){return socket;},get stopped(){return stopped;},get closed(){return closed;},get released(){return released;},grant:()=>resolveMic(media),receive:message=>socket.onmessage({data:JSON.stringify(message)}),restore(){live.stop();for(const name of names){if(original[name])Object.defineProperty(globalThis,name,original[name]);else delete globalThis[name];}}};
}

test('continuous microphone starts after setup, restores context and streams audio before turn completion',async()=>{
 const env=environment();try{
  await env.live.start();env.socket.onopen();
  env.capture.port.onmessage({data:new Float32Array(1600)});assert.equal(env.messages.length,1,'microphone must wait for setup acknowledgement');
  env.receive({setupComplete:{}});assert.equal(env.messages[1].clientContent.turnComplete,false);assert.equal(env.messages[1].clientContent.turns[0].parts[0].text,'Assunto anterior');
  env.capture.port.onmessage({data:new Float32Array(1600)});assert.equal(env.messages.at(-1).realtimeInput.audio.mimeType,'audio/pcm;rate=16000');
  const audio={mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')};
  env.receive({serverContent:{inputTranscription:{text:'E na indústria?'},outputTranscription:{text:'Posso ajudar.'},modelTurn:{parts:[{inlineData:audio}]}}});
  assert.equal(env.sourceNodes.length,1,'must play without waiting for turnComplete');assert.equal(env.phases.at(-1),'speaking');
  env.receive({serverContent:{modelTurn:{parts:[{inlineData:audio}]}}});assert.ok(env.sourceNodes[1].time>env.sourceNodes[0].time);
  env.receive({serverContent:{turnComplete:true}});assert.deepEqual(env.turns,[['E na indústria?','Posso ajudar.']]);
  env.sourceNodes[0].onended();env.sourceNodes[1].onended();assert.equal(env.phases.at(-1),'listening');
  env.live.stop();assert.equal(env.stopped,1);assert.equal(env.closed,1);assert.equal(env.released,1);assert.equal(env.socket.closed,true);
 }finally{env.restore();}
});

test('speaking interruption removes queued playback and closing the socket stops the microphone',async()=>{
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});
  env.receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')}}]}}});
  env.receive({serverContent:{interrupted:true}});assert.equal(env.sourceNodes[0].stopped,true);assert.equal(env.phases.at(-1),'listening');
  env.socket.onclose({code:1006});assert.equal(env.stopped,1);assert.match(env.errors[0],/desconectada/);
 }finally{env.restore();}
});

test('cancelling while permission is pending releases late microphone access',async()=>{
 const env=environment({delayedMic:true});try{
  const pending=env.live.start();await Promise.resolve();env.live.stop();env.grant();await pending;
  assert.equal(env.stopped,1);assert.equal(env.socket,undefined);assert.equal(env.closed,1);
 }finally{env.restore();}
});

test('local greetings can pause microphone transmission and resume without sending a name',async()=>{
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});env.live.pauseMicrophone(true);
  assert.equal(env.messages.at(-1).realtimeInput.audioStreamEnd,true);
  const count=env.messages.length;
  env.capture.port.onmessage({data:new Float32Array(1600)});assert.equal(env.messages.length,count);
  env.live.pauseMicrophone(false);env.capture.port.onmessage({data:new Float32Array(1600)});
  assert.equal(env.messages.length,count+1);assert.ok(env.messages.at(-1).realtimeInput.audio);
 }finally{env.restore();}
});

test('guided enrollment uses completed user transcripts, suppresses generated speech and resumes normal conversation',async()=>{
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});env.live.setEnrollmentMode(true);
  const audio={mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')};
  env.receive({serverContent:{inputTranscription:{text:'Meu nome é '},outputTranscription:{text:'Sim, autorizo'},modelTurn:{parts:[{inlineData:audio}]}}});
  assert.deepEqual(env.transcripts,[]);assert.equal(env.sourceNodes.length,0);
  env.receive({serverContent:{inputTranscription:{text:'Pessoa Teste.'}}});
  env.receive({serverContent:{turnComplete:true}});
  assert.deepEqual(env.transcripts,['Meu nome é Pessoa Teste.']);assert.deepEqual(env.turns,[]);
  env.live.pauseMicrophone(true);
  env.receive({serverContent:{inputTranscription:{text:'sim'},turnComplete:true}});
  assert.equal(env.transcripts.length,1,'speaker echo while paused must not authorize enrollment');
  env.live.setEnrollmentMode(false);env.live.pauseMicrophone(false);
  env.receive({serverContent:{inputTranscription:{text:'Podemos conversar?'},outputTranscription:{text:'Sim!'},modelTurn:{parts:[{inlineData:audio}]},turnComplete:true}});
  assert.equal(env.sourceNodes.length,1);assert.deepEqual(env.turns,[['Podemos conversar?','Sim!']]);
 }finally{env.restore();}
});

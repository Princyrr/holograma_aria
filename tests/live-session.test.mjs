import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createLiveToken,chatMiddleware} from '../server/chat.mjs';
const source=(await readFile(new URL('../src/live/live-session.ts',import.meta.url),'utf8')).replaceAll('../../shared/aria-time.mjs',new URL('../shared/aria-time.mjs',import.meta.url).href).replace(/new URL\(["']\.\/pcm-capture\.worklet\.js["'],\s*import\.meta\.url\)/,JSON.stringify(new URL('../src/live/pcm-capture.worklet.js',import.meta.url).href));
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
const {cameraIdentityPresentation,LiveSession,encodePcm,decodePcm}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));

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
  sampleRate=48000;currentTime=0;destination={};audioWorklet={addModule:async()=>{}};
  constructor(options){this.sampleRate=options.sampleRate;}
  resume(){return Promise.resolve();}close(){closed++;return Promise.resolve();}
  createMediaStreamSource(){return node();}createGain(){return {...node(),gain:{value:1}};}
  createBuffer(channels,length,rate){return {sampleRate:rate,duration:length/rate,copyToChannel(){}};}
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

test('camera identity is restored on connection, changes silently and clears old names',async()=>{
 const env=environment();try{
  env.live.setCameraIdentity('Priscila');await env.live.start();env.receive({setupComplete:{}});
  let context=env.messages.at(-1).clientContent;
  assert.equal(context.turnComplete,false);assert.match(context.turns[0].parts[0].text,/Você é Priscila/);
  assert.match(context.turns[0].parts[0].text,/Não responda/);
  const count=env.messages.length;env.live.setCameraIdentity('Priscila');assert.equal(env.messages.length,count);
  env.live.setCameraIdentity('Ana');assert.match(env.messages.at(-1).clientContent.turns[0].parts[0].text,/Você é Ana/);
  env.live.setCameraIdentity(null);
  const cleared=env.messages.at(-1).clientContent.turns[0].parts[0].text;
  assert.match(cleared,/nenhuma pessoa cadastrada/);assert.ok(!cleared.includes('Ana'));assert.ok(!cleared.includes('Priscila'));
  assert.equal(env.sourceNodes.length,0,'context updates must not play greetings');
 }finally{env.restore();}
});

test('Suelio receives his full presentation only when he is recognized',async()=>{
 const expected='Você é Suelio, é analista de informática, seu sobrenome é Matias, tem mestrado em Ciência da Computação, é especialista em Gestão da Tecnologia da Informação, graduando em Ciência da Computação e técnico em informática.';
 assert.equal(cameraIdentityPresentation('Suelio'),expected);
 assert.equal(cameraIdentityPresentation(' SUÉLIO '),expected);
 for(const name of ['Ana','Suelio Outra Pessoa'])assert.equal(cameraIdentityPresentation(name),`Você é ${name}.`);
 const env=environment();try{
  env.live.setCameraIdentity('Suelio');await env.live.start();env.receive({setupComplete:{}});
  const context=env.messages.at(-1).clientContent;
  assert.ok(context.turns[0].parts[0].text.includes(expected));assert.equal(context.turnComplete,false);
  assert.equal(env.sourceNodes.length,0,'the presentation waits for the person to ask');
  for(const name of ['Marcos','Priscila',null]){
   env.live.setCameraIdentity(name);
   const text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
   assert.ok(!text.includes('Matias'));assert.ok(!text.includes('mestrado'));
  }
 }finally{env.restore();}
});

test('Marcos receives his own presentation without mixing it with Suelio',async()=>{
 const expected='Você é Marcos,  Trabalha no Observatório, é desenvolvedor  e estuda no curso de Engenharia de Computação e no curso técnico em Programação de Jogos Digitais. ';
 assert.equal(cameraIdentityPresentation('Marcos'),expected);
 assert.equal(cameraIdentityPresentation(' MARCOS '),expected);
 const env=environment();try{
  env.live.setCameraIdentity('Marcos');await env.live.start();env.receive({setupComplete:{}});
  let text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
  assert.ok(text.includes(expected));assert.ok(!text.includes('Matias'));
  assert.equal(env.messages.at(-1).clientContent.turnComplete,false);
  assert.equal(env.sourceNodes.length,0);
  env.live.setCameraIdentity('Suelio');text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
  assert.ok(text.includes('Matias'));assert.ok(!text.includes('Jogos Digitais'));
  for(const name of ['Priscila',null]){
   env.live.setCameraIdentity(name);text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
   assert.ok(!text.includes('Jogos Digitais'));assert.ok(!text.includes('estagiando'));
  }
 }finally{env.restore();}
});

test('Priscila receives her own professional presentation only when recognized',async()=>{
 const expected='Você é Priscila, a desenvolvedora frontend do Observatório da Paraíba. É graduada em Sistemas para Internet e técnica em Desenvolvimento de Sistemas.';
 assert.equal(cameraIdentityPresentation('Priscila'),expected);
 assert.equal(cameraIdentityPresentation(' PRISCILA '),expected);
 const env=environment();try{
  env.live.setCameraIdentity('Priscila');await env.live.start();env.receive({setupComplete:{}});
  let text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
  assert.ok(text.includes(expected));assert.ok(!text.includes('Matias'));assert.ok(!text.includes('estagiando'));
  assert.equal(env.messages.at(-1).clientContent.turnComplete,false);assert.equal(env.sourceNodes.length,0);
  for(const name of ['Marcos','Suelio',null]){
   env.live.setCameraIdentity(name);text=env.messages.at(-1).clientContent.turns[0].parts[0].text;
   assert.ok(!text.includes('frontend'));assert.ok(!text.includes('Sistemas para Internet'));
  }
 }finally{env.restore();}
});

test('full presentations are restricted to who am I, never recognition or name questions',async()=>{
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});
  for(const name of ['Suelio','Marcos','Priscila']){
   env.live.setCameraIdentity(name);
   const context=env.messages.at(-1).clientContent;
   const text=context.turns[0].parts[0].text;
   assert.match(text,/Somente se a pessoa perguntar quem sou eu ou quem sou/);
   assert.match(text,/Fora da pergunta quem sou ou quem sou eu, não revele nem recite a identidade/);
   assert.match(text,/apenas uma vez por pessoa até atualizar a página/);
   assert.match(text,/nem espontaneamente durante a conversa/);
   assert.equal(context.turnComplete,false);
  }
  assert.equal(env.sourceNodes.length,0);
 }finally{env.restore();}
});

test('Caina Moura and Pedro have separate presentations for the current recognized person',async()=>{
 const caina='Você é Cainã Moura, o desenvolvedor de sistemas do Observatório, bacharel em Sistemas de Informação.';
 const pedro='Você é Pedro, o economista do Observatório da Paraíba, graduado em Ciências Econômicas.';
 for(const name of ['Cainã','Cainã Moura',' CAINÃ MOURA '])assert.equal(cameraIdentityPresentation(name),caina);
 assert.equal(cameraIdentityPresentation('Pedro'),pedro);
 assert.equal(cameraIdentityPresentation(' PEDRO '),pedro);
 assert.equal(cameraIdentityPresentation('Pessoa desconhecida'),'Você é Pessoa desconhecida.');
 const env=environment();try{
  env.live.setCameraIdentity('Cainã Moura');await env.live.start();env.receive({setupComplete:{}});
  let context=env.messages.at(-1).clientContent;
  assert.ok(context.turns[0].parts[0].text.includes(caina));assert.equal(context.turnComplete,false);
  env.live.setCameraIdentity('Pedro');context=env.messages.at(-1).clientContent;
  assert.ok(context.turns[0].parts[0].text.includes(pedro));assert.ok(!context.turns[0].parts[0].text.includes('Cainã'));
  assert.match(context.turns[0].parts[0].text,/Somente se a pessoa perguntar quem sou eu ou quem sou/);
  env.live.setCameraIdentity(null);const cleared=env.messages.at(-1).clientContent.turns[0].parts[0].text;
  assert.ok(!cleared.includes('Pedro'));assert.ok(!cleared.includes('Cainã'));
  assert.equal(env.sourceNodes.length,0);
 }finally{env.restore();}
});


test('live output preserves 24 kHz speech while microphone input remains 16 kHz',async()=>{
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});
  env.capture.port.onmessage({data:new Float32Array(4800).fill(.5)});
  const input=env.messages.at(-1).realtimeInput.audio;
  assert.equal(input.mimeType,'audio/pcm;rate=16000');
  assert.equal(Buffer.from(input.data,'base64').length,3200,'100ms of 48 kHz input is encoded as 100ms at 16 kHz');
  env.receive({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(4800).toString('base64')}}]}}});
  assert.equal(env.sourceNodes[0].buffer.sampleRate,24000);
  assert.equal(env.sourceNodes[0].buffer.duration,.1);
 }finally{env.restore();}
});

test('live clock follows Fortaleza across noon without triggering a reply or repeating every audio packet',async()=>{
 const RealDate=globalThis.Date;let instant='2026-10-29T14:59:00Z';
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new RealDate(instant).getTime();}};
 const env=environment();try{
  await env.live.start();env.receive({setupComplete:{}});
  const clockMessages=()=>env.messages.filter(message=>message.clientContent?.turns?.[0]?.parts?.[0]?.text.startsWith('Horário local de referência:'));
  assert.equal(clockMessages().length,1);
  assert.match(clockMessages()[0].clientContent.turns[0].parts[0].text,/11:59.*America\/Fortaleza.*Bom dia/);
  for(let i=0;i<3;i++)env.capture.port.onmessage({data:new Float32Array(480)});
  assert.equal(clockMessages().length,1);
  instant='2026-10-29T15:00:00Z';env.capture.port.onmessage({data:new Float32Array(480)});
  assert.equal(clockMessages().length,2);
  assert.match(clockMessages()[1].clientContent.turns[0].parts[0].text,/12:00.*Boa tarde/);
  assert.equal(clockMessages()[1].clientContent.turnComplete,false);
  assert.equal(env.sourceNodes.length,0);
 }finally{env.restore();globalThis.Date=RealDate;}
});

test('live and camera greeting share the selected voice and speaking style, with a grounded morning clock',async()=>{
 const {synthesize,pcmToWav}=await import('../server/chat.mjs');
 let greetingStyle;
 await synthesize('Bom dia!',{key:'test',voice:'Kore',request:async(url,options)=>{
  const body=JSON.parse(options.body);greetingStyle=body.contents[0].parts[0].speech_metadata.style;
  assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');
  return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:pcmToWav(Buffer.alloc(20)).toString('base64')}}]}}]});
 }});
 const live=await createLiveToken({key:'test',voice:'Kore',now:()=>new Date('2026-10-29T12:42:00Z'),request:async()=>Response.json({name:'auth_tokens/test'})});
 assert.equal(live.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');
 const instruction=live.setup.systemInstruction.parts[0].text;
 assert.ok(instruction.includes(greetingStyle));
 assert.match(instruction,/09:42.*America\/Fortaleza.*Bom dia/);
});

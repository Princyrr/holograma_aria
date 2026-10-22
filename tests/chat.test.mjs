import test from 'node:test';
import assert from 'node:assert/strict';
import {chat} from '../server/chat.mjs';
const contents=[{role:'user',parts:[{text:'Olá'}]}];
test('sends conversation and key only to Google and returns spoken answer',async()=>{
 const result=await chat(contents,{key:'test-secret',request:async(url,options)=>{
  assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
  assert.ok(!url.includes('test-secret'));assert.equal(options.headers['x-goog-api-key'],'test-secret');
  assert.deepEqual(JSON.parse(options.body).contents,contents);
  return new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'internal'},{text:'Olá, sou Aria.'}]}}]}));
 }});assert.deepEqual(result,{text:'Olá, sou Aria.'});
});
test('rejects invalid conversation before contacting Google',async()=>{
 for(const value of [[],[{role:'model',parts:[{text:'x'}]}],[{role:'user',parts:[{text:'x'.repeat(8001)}]}]])
 await assert.rejects(chat(value,{key:'secret',request:()=>assert.fail('must not contact Google')}),{status:400});
});
test('missing configuration, quota, and blocked answers have useful errors',async()=>{
 await assert.rejects(chat(contents),{status:503});
 await assert.rejects(chat(contents,{key:'secret',request:async()=>new Response('{}',{status:429})}),/limite/);
 await assert.rejects(chat(contents,{key:'secret',request:async()=>new Response('{}')}),/reformular/);
});

import {pcmToWav,synthesize,transcribe} from '../server/chat.mjs';
test('natural voice preserves WAV audio and voice style',async()=>{
 const wav=pcmToWav(Buffer.alloc(100));
 const audio=await synthesize('Olá!',{key:'secret',request:async(url,options)=>{
  assert.ok(url.includes('gemini-3.8-flash-tts'));
  const body=JSON.parse(options.body);assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');
  assert.ok(body.contents[0].parts[0].speech_metadata.style.includes('Brazilian Portuguese'));
  return new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:wav.toString('base64')}}]}}]}));
 }});assert.deepEqual(audio,wav);assert.equal(audio.toString('ascii',0,4),'RIFF');assert.equal(audio.readUInt32LE(40),100);
});
test('natural voice wraps raw PCM and rejects empty audio responses',async()=>{
 const audio=await synthesize('Oi',{key:'secret',request:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:Buffer.alloc(20).toString('base64')}}]}}]}))});
 assert.equal(audio.length,64);assert.equal(audio.readUInt32LE(24),24000);
 await assert.rejects(synthesize('Oi',{key:'secret',request:async()=>new Response('{}')}),{status:502});
});
test('recorded speech is transcribed and silence gets a clear error',async()=>{
 const audio={mimeType:'audio/webm',data:'YWJjZA=='};
 assert.equal(await transcribe(audio,{key:'secret',request:async(url,options)=>{assert.deepEqual(JSON.parse(options.body).contents[0].parts[1].inlineData,audio);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Como você está?'}]}}]}));}}),'Como você está?');
 await assert.rejects(transcribe(audio,{key:'secret',request:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'SEM_FALA'}]}}]}))}),{status:422});
 await assert.rejects(transcribe({mimeType:'text/html',data:'a'},{key:'secret'}),{status:400});
});

test('answers recorded questions in one request and returns transcript for history',async()=>{
 const audio={mimeType:'audio/webm',data:'YWJjZA=='};let calls=0;
 const result=await chat(contents,{key:'secret',audio,request:async(url,options)=>{
  calls++;const body=JSON.parse(options.body);
  assert.deepEqual(body.contents.at(-1).parts[1].inlineData,audio);
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({transcript:'Como você está?',text:'Estou bem!'})}]}}]}));
 }});
 assert.equal(calls,1);assert.deepEqual(result,{transcript:'Como você está?',text:'Estou bem!'});
});
test('combined audio request rejects invalid audio, silence and malformed responses',async()=>{
 await assert.rejects(chat(contents,{key:'secret',audio:{mimeType:'text/html',data:'YWJjZA=='},request:()=>assert.fail('must not contact Google')}),{status:400});
 for(const [text,status] of [['invalid',502],[JSON.stringify({transcript:'SEM_FALA',text:'Oi'}),422],[JSON.stringify({transcript:'Oi',text:''}),502]]) {
  await assert.rejects(chat(contents,{key:'secret',audio:{mimeType:'audio/webm',data:'YWJjZA=='},request:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text}]}}]}))}),{status});
 }
});

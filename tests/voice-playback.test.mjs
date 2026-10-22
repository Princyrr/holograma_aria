import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

test('starts first sentence before remaining audio arrives and cancels pending playback',async()=>{
 const original={window:globalThis.window,Audio:globalThis.Audio,fetch:globalThis.fetch};
 const played=[];let finishRemaining;
 const first='Esta é uma primeira frase suficientemente longa.';
 const rest='Esta é a segunda frase da resposta.';
 globalThis.window={setTimeout,clearTimeout,clearInterval,dispatchEvent(){}};
 globalThis.Audio=class {
  duration=2;
  constructor(url){this.url=url;}
  play(){played.push(this);this.onplaying?.();return Promise.resolve();}
  pause(){}
 };
 globalThis.fetch=async(url,options)=>{
  if(url==='/api/chat')return Response.json({text:first+' '+rest,transcript:'Uma pergunta'});
  const {text}=JSON.parse(options.body);
  if(text===first)return new Response(new Blob(['first']));
  assert.equal(text,rest);
  return new Promise(resolve=>{finishRemaining=()=>resolve(new Response(new Blob(['rest'])));});
 };
 try {
  let source=await readFile(new URL('../src/VoiceChat.tsx',import.meta.url),'utf8');
  source=source.replace("import { useEffect, useRef, useState } from 'react';",`const useRef=(current)=>({current});const useState=(value)=>[value,()=>{}];const useEffect=()=>{};const React={createElement:()=>null};`);
  source=source.replace('return <section','globalThis.voiceControls={ask,stop}; return <section');
  const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}});
  const {default:VoiceChat}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
  VoiceChat();
  const pending=globalThis.voiceControls.ask('Uma pergunta');
  for(let i=0;i<20&&!played.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(played.length,1,'first sentence should play while remaining audio is pending');
  globalThis.voiceControls.stop();finishRemaining();await pending;
  assert.equal(played.length,1,'cancelled response must not play the remaining sentence');
 }finally{
  Object.assign(globalThis,original);delete globalThis.voiceControls;
 }
});

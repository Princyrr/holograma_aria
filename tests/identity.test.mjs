import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/identity/identity.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
const {IdentityGreeting,matchProfile,validateProfiles,distance,validName,normalizeName}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const vector=value=>Array(128).fill(value);
const profile=(id,name,value)=>({id,name,descriptors:Array.from({length:6},()=>vector(value)),consentedAt:'2026-10-23T12:00:00Z'});
const first=profile('first','Pessoa Teste',0),second=profile('second','Outra Pessoa',.2);
test('local consented profiles validate names and reject corrupted or unconsented data',()=>{
 assert.equal(normalizeName('  Pessoa   Teste  '),'Pessoa Teste');assert.ok(validName('João D’Ávila'));
 assert.equal(validName('<script>'),false);assert.equal(validName('x'),false);
 assert.deepEqual(validateProfiles([first]),[first]);
 for(const value of [[{...first,consentedAt:null}],[{...first,descriptors:[vector(0)]}],[{...first,name:'<b>'}],[first,first],[{...first,descriptors:Array.from({length:6},()=>vector(Infinity))}]])assert.throws(()=>validateProfiles(value));
});
test('matching requires close samples and rejects ambiguous or invalid descriptors',()=>{
 assert.equal(matchProfile(new Float32Array(vector(.01)),[first,second])?.id,'first');
 assert.equal(matchProfile(new Float32Array(vector(.8)),[first,second]),null);
 assert.equal(matchProfile(new Float32Array(vector(.006)),[first,profile('near','Pessoa Parecida',.012)]),null);
 assert.equal(matchProfile(new Float32Array(vector(NaN)),[first]),null);
 assert.equal(distance([0],[0]),Infinity);
});
test('personal greeting requires three consistent observations and does not repeat while the person stays',()=>{
 const state=new IdentityGreeting();assert.equal(state.update(first,true,0),null);assert.equal(state.update(first,true,1100),null);assert.equal(state.update(first,true,2200),'Oi, Pessoa Teste!');
 for(let i=3;i<80;i++)assert.equal(state.update(first,true,i*1100),null);
});
test('brief absence does not greet again and a real return respects a cooldown',()=>{
 const state=new IdentityGreeting();state.update(first,true,0);state.update(first,true,1100);state.update(first,true,2200);
 state.update(null,false,3000);state.update(first,true,3500);state.update(first,true,4600);assert.equal(state.update(first,true,5700),null);
 state.update(null,false,10000);state.update(null,false,14000);state.update(first,true,15000);state.update(first,true,16100);assert.equal(state.update(first,true,17200),null);
 assert.equal(state.update(first,true,34000),'Oi, Pessoa Teste!');
});
test('unknown people get a generic greeting without a guessed name',()=>{
 const state=new IdentityGreeting();state.update(null,true,0);state.update(null,true,1100);assert.equal(state.update(null,true,2200),'Olá! Tudo bem?');
 const unstable=new IdentityGreeting();unstable.update(first,true,0);unstable.update(second,true,1100);assert.equal(unstable.update(first,true,2200),null);
});

test('generic model manifests match all local weights files',async()=>{
 for(const model of ['tiny_face_detector','face_landmark_68_tiny','face_recognition']){
  const base=new URL('../public/vision/identity/',import.meta.url);
  const groups=JSON.parse(await readFile(new URL(model+'_model-weights_manifest.json',base),'utf8'));
  for(const group of groups){
   const files=await Promise.all(group.paths.map(path=>readFile(new URL(path,base))));
   const expected=group.weights.reduce((sum,weight)=>sum+weight.shape.reduce((a,b)=>a*b,1)*({uint8:1,uint16:2,float32:4,int32:4}[weight.quantization?.dtype??weight.dtype]),0);
   assert.equal(files.reduce((sum,file)=>sum+file.length,0),expected,model+' weights must match the manifest');
  }
 }
});
test('personalized speech selects local Portuguese voices only, with no cloud fallback',async()=>{
 const source=await readFile(new URL('../src/identity/local-voice.ts',import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
 const {localPortugueseVoice}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
 const remote={name:'Online',lang:'pt-BR',localService:false},local={name:'Luciana',lang:'pt-BR',localService:true};
 assert.equal(localPortugueseVoice([remote]),undefined);
 assert.equal(localPortugueseVoice([remote,{name:'English',lang:'en-US',localService:true},local]),local);
});

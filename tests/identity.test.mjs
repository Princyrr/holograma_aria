import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../src/identity/identity.ts',import.meta.url),'utf8')).replaceAll('../../shared/aria-time.mjs',new URL('../shared/aria-time.mjs',import.meta.url).href);
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
const {timeGreeting,IdentityGreeting,matchProfile,validateProfiles,distance,validName,normalizeName}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
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
 const state=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));assert.equal(state.update(first,true,0),null);assert.equal(state.update(first,true,1100),null);assert.equal(state.update(first,true,2200),'Oi, Pessoa Teste! Bom dia!');
 for(let i=3;i<80;i++)assert.equal(state.update(first,true,i*1100),null);
});
test('returning after a long absence never repeats a greeting before reload',()=>{
 const state=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));state.update(first,true,0);state.update(first,true,1100);state.update(first,true,2200);
 state.update(null,false,3000);state.update(first,true,3500);state.update(first,true,4600);assert.equal(state.update(first,true,5700),null);
 state.update(null,false,10000);state.update(null,false,14000);state.update(first,true,15000);state.update(first,true,16100);assert.equal(state.update(first,true,17200),null);
 assert.equal(state.update(first,true,34000),null);
 state.update(second,true,35000);state.update(second,true,36100);assert.equal(state.update(second,true,37200),'Oi, Outra Pessoa! Bom dia!');
 state.update(first,true,40000);state.update(first,true,41100);assert.equal(state.update(first,true,42200),null);
 const refreshed=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));refreshed.update(first,true,0);refreshed.update(first,true,1100);assert.equal(refreshed.update(first,true,2200),'Oi, Pessoa Teste! Bom dia!');
});
test('unknown people get a generic greeting without a guessed name',()=>{
 const state=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));state.update(null,true,0);state.update(null,true,1100);assert.equal(state.update(null,true,2200),'Olá! Bom dia! Tudo bem?');
 const unstable=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));unstable.update(first,true,0);unstable.update(second,true,1100);assert.equal(unstable.update(first,true,2200),null);
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

test('uncatalogued faces are remembered for this page even after camera absence',()=>{
 const state=new IdentityGreeting(()=>new Date('2026-10-26T09:00:00-03:00'));const a=new Float32Array(vector(0)),b=new Float32Array(vector(.2));
 for(const [descriptor,time] of [[a,0],[b,5000]]){
  assert.equal(state.update(null,true,time,descriptor),null);state.update(null,true,time+1100,descriptor);
  assert.equal(state.update(null,true,time+2200,descriptor),'Olá! Bom dia! Tudo bem?');
 }
 state.update(null,false,10000);state.update(null,false,100000);
 for(let i=0;i<5;i++)assert.equal(state.update(null,true,101000+i*1100,a),null);
});

test('greetings follow the local time at morning, afternoon and night boundaries',()=>{
 for(const [hour,minute,expected] of [[0,0,'Boa noite'],[4,59,'Boa noite'],[5,0,'Bom dia'],[11,59,'Bom dia'],[12,0,'Boa tarde'],[17,59,'Boa tarde'],[18,0,'Boa noite'],[23,59,'Boa noite']]){
  const date=new Date(`2026-10-26T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00-03:00`);
  assert.equal(timeGreeting(date),expected);
  const state=new IdentityGreeting(()=>date);
  state.update(first,true,0);state.update(first,true,1100);
  assert.equal(state.update(first,true,2200),`Oi, Pessoa Teste! ${expected}!`);
  state.update(null,false,3000);
  state.update(first,true,4000);state.update(first,true,5000);
  assert.equal(state.update(first,true,6000),null);
 }
});
test('the period is evaluated at greeting time without repeating earlier visitors',()=>{
 let date=new Date('2026-10-26T11:59:00-03:00');const state=new IdentityGreeting(()=>date);
 state.update(first,true,0);state.update(first,true,1100);
 assert.equal(state.update(first,true,2200),'Oi, Pessoa Teste! Bom dia!');
 date=new Date('2026-10-26T12:00:00-03:00');
 state.update(second,true,3300);state.update(second,true,4400);
 assert.equal(state.update(second,true,5500),'Oi, Outra Pessoa! Boa tarde!');
 state.update(first,true,6600);state.update(first,true,7700);
 assert.equal(state.update(first,true,8800),null);
});

test('greetings use Fortaleza rather than the browser timezone or UTC',()=>{
 for(const [date,expected] of [['2026-10-29T12:42:00Z','Bom dia'],['2026-10-29T14:59:00Z','Bom dia'],['2026-10-29T15:00:00Z','Boa tarde'],['2026-10-29T21:00:00Z','Boa noite'],['2026-10-30T07:59:00Z','Boa noite'],['2026-10-30T08:00:00Z','Bom dia']]){
  assert.equal(timeGreeting(new Date(date)),expected);
 }
});

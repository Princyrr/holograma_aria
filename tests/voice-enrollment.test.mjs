import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const identityUrl=compile(await readFile(new URL('../src/identity/identity.ts',import.meta.url),'utf8'));
const {validateProfiles,saveProfiles}=await import(identityUrl);
const source=(await readFile(new URL('../src/identity/voice-enrollment.ts',import.meta.url),'utf8')).replace("'./identity'",JSON.stringify(identityUrl));
const {authorized,spokenName,guidedEnrollment,captureSamples}=await import(compile(source));
const vector=(value=0)=>new Float32Array(128).fill(value);
const face=(value=0)=>({descriptor:vector(value),score:.99,widthRatio:.4});
const makeProfile=id=>({id,name:'Pessoa Teste',descriptors:Array.from({length:6},()=>Array.from(vector(.3))),consentedAt:'2026-10-23T12:00:00Z'});
function fixture(answers=['Meu nome é Pessoa Teste.','Sim, autorizo.']){
 answers=['Sim',...answers];
 const controller=new AbortController(),prompts=[],said=[],saved=[];let faces=[face()],reads=0;
 const options={signal:controller.signal,reference:vector(),read:async()=>{reads++;return faces;},profiles:()=>[],save:profile=>saved.push(profile),sleep:async()=>{},voice:{
  ask:async text=>{prompts.push(text);assert.ok(answers.length,'unexpected extra question');return answers.shift();},
  say:async text=>{said.push(text);if(text.startsWith('Pronto'))assert.equal(saved.length,1,'must persist before confirming');},close(){}
 }};
 return {options,controller,prompts,said,saved,get reads(){return reads;},set faces(value){faces=value;}};
}
test('spoken names strip introductions and ambiguous consent never authorizes',()=>{
 for(const input of ['Meu nome é Ana.','Me chamo Ana.','Eu sou Ana','Ana'])assert.equal(spokenName(input),'Ana');
 for(const input of ['sim','não quero','autorizo','Ana 123','<Ana>'])assert.equal(spokenName(input),null);
 for(const input of ['Sim!','Sim, autorizo.','Eu autorizo','Pode cadastrar meu rosto'])assert.equal(authorized(input),true,input);
 for(const input of ['não','sim, mas não quero','talvez','pode falar','não autorizo','meu nome é Sim'])assert.equal(authorized(input),false,input);
});
test('voice enrollment confirms the heard name, explains storage and Google, and saves six samples only after consent',async()=>{
 const env=fixture();const result=await guidedEnrollment(env.options);
 assert.match(env.prompts[0],/gostaria de se cadastrar/);assert.match(env.prompts[1],/Qual é o seu nome/);
 assert.equal(result.name,'Pessoa Teste');assert.equal(result.descriptors.length,6);assert.equal(env.saved.length,1);
 assert.match(env.prompts[2],/Entendi Pessoa Teste/);assert.match(env.prompts[2],/Google/);assert.match(env.prompts[2],/navegador/);
 assert.match(env.said.at(-1),/Pronto, Pessoa Teste/);
});
test('refusing at the name or permission question saves nothing and takes no enrollment samples',async()=>{
 for(const answers of [['Não quero'],['Ana','Não autorizo']]){
  const env=fixture(answers);assert.equal(await guidedEnrollment(env.options),null);
  assert.deepEqual(env.saved,[]);assert.ok(env.reads<=4);assert.match(env.said.at(-1),/Não vou cadastrar/);
 }
});
test('unclear permission and an unrecognized name do not create a profile',async()=>{
 for(const answers of [['Ana','talvez','pode falar'],['sim','autorizo']]){
  const env=fixture(answers);assert.equal(await guidedEnrollment(env.options),null);assert.deepEqual(env.saved,[]);
 }
});
test('the person changing or another face entering after a question cancels before persistence',async()=>{
 for(const replacement of [[face(.3)],[face(),face(.3)],[]]){
  const env=fixture();env.options.voice.ask=async()=>{env.faces=replacement;return 'Ana';};
  await assert.rejects(guidedEnrollment(env.options),/cancelado/);assert.deepEqual(env.saved,[]);
 }
});
test('changing people during capture and camera cancellation prevent any save',async()=>{
 const swap=fixture();let sleeps=0;swap.options.sleep=async()=>{if(++sleeps===1)swap.faces=[face(.3)];};
 await assert.rejects(guidedEnrollment(swap.options),/rosto na câmera mudou/);assert.deepEqual(swap.saved,[]);
 const cancel=fixture();cancel.options.voice.ask=async()=>{cancel.controller.abort();return 'Ana';};
 await assert.rejects(guidedEnrollment(cancel.options),{name:'AbortError'});assert.deepEqual(cancel.saved,[]);
});
test('duplicate faces and full storage never report a successful new enrollment',async()=>{
 const duplicate=fixture();duplicate.options.profiles=()=>[{...makeProfile('existing'),descriptors:Array.from({length:6},()=>Array.from(vector()))}];
 await assert.rejects(guidedEnrollment(duplicate.options),/já tem cadastro/);assert.deepEqual(duplicate.saved,[]);
 const full=fixture();full.options.save=()=>{throw new Error('Armazenamento cheio');};
 await assert.rejects(guidedEnrollment(full.options),/cheio/);assert.ok(!full.said.some(text=>text.startsWith('Pronto')));
});
test('capture waits for good quality but times out instead of saving poor samples',async()=>{
 let now=0;
 await assert.rejects(captureSamples({signal:new AbortController().signal,read:async()=>[{...face(),score:.5}],now:()=>now,sleep:async()=>{now+=20000;}}),/seis amostras/);
});
test('more than six profiles validate, persist, reload, and preserve previous data on quota failure',()=>{
 const profiles=Array.from({length:100},(_,index)=>makeProfile(String(index)));
 let stored='original';saveProfiles(profiles,{setItem:(_key,value)=>stored=value});
 assert.equal(validateProfiles(JSON.parse(stored)).length,100);
 const previous=stored;
 assert.throws(()=>saveProfiles([...profiles,makeProfile('new')],{setItem:()=>{throw new Error('QuotaExceededError');}}),/anteriores foram mantidos/);
 assert.equal(stored,previous);
});

test('the initial enrollment offer can be refused or left unanswered without asking for a name',async()=>{
 for(const answer of ['Não, obrigada','Talvez']){
  const env=fixture();env.options.voice.ask=async text=>{env.prompts.push(text);return answer;};
  assert.equal(await guidedEnrollment(env.options),null);assert.deepEqual(env.saved,[]);
  assert.ok(env.prompts.every(text=>!text.includes('Qual é o seu nome')));
  assert.ok(env.said.every(text=>!text.startsWith('Pronto')));
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/camera/tracking.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}});
const {ArrivalDetector,teethSmileAmount,headPose,WaveDetector,KissDetector,smileAmount,blinkAmounts,wideEyesAmount,browAmounts,openPalm,faceGaze}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
function palm(x=.5){
  const points=Array.from({length:21},()=>({x,y:.55}));points[0]={x,y:.75};
  for(const [mcp,pip,tip,offset] of [[5,6,8,-.07],[9,10,12,-.02],[13,14,16,.03],[17,18,20,.07]]){
    points[mcp]={x:x+offset,y:.59};points[pip]={x:x+offset,y:.46};points[tip]={x:x+offset,y:.29};
  }
  return points;
}
const sweep=[0,.04,.08,.12,.08,.04,0,-.04,-.08,-.04,0,.04,.08];
function wave(detector,start=0){return sweep.map((x,i)=>detector.update(palm(.5+x),start+i*100)).filter(Boolean).length;}
test('open hand accepted; closed fingers rejected',()=>{
 assert.equal(openPalm(palm()),true);const fist=palm();for(const tip of [8,12,16,20])fist[tip]={x:.5,y:.65};assert.equal(openPalm(fist),false);
});
test('stationary open hand never triggers a wave',()=>{const detector=new WaveDetector();for(let i=0;i<40;i++)assert.equal(detector.update(palm(.5+Math.sin(i)*.006),i*100),false);});
test('one-way movement is not a goodbye gesture',()=>{const detector=new WaveDetector();for(let i=0;i<13;i++)assert.equal(detector.update(palm(.3+i*.02),i*100),false);});
test('successive back-and-forth waves trigger without a cooldown',()=>{const detector=new WaveDetector();assert.ok(wave(detector)>=1);assert.ok(wave(detector,1400)>=1);assert.ok(wave(detector,2800)>=1);});
test('lost hand clears motion history',()=>{const detector=new WaveDetector();for(let i=0;i<6;i++)detector.update(palm(.4+i*.02),i*100);detector.update(undefined,1000);assert.equal(detector.update(palm(.4),1100),false);});
test('gaze centers, mirrors horizontally and clamps extremes',()=>{assert.deepEqual(faceGaze({x:.5,y:.48}),{x:0,y:0});assert.ok(faceGaze({x:.2,y:.48}).x>0);assert.deepEqual(faceGaze({x:1.2,y:-.2}),{x:-1,y:1});});

test('kiss must be held and does not repeat while puckered',()=>{const detector=new KissDetector();const kiss={mouthPucker:.8,jawOpen:.05};assert.equal(detector.update(kiss,0),false);assert.equal(detector.update(kiss,200),false);assert.equal(detector.update(kiss,350),true);assert.equal(detector.update(kiss,5500),false);});
test('kiss rejects brief speech shapes and an open mouth',()=>{const detector=new KissDetector();assert.equal(detector.update({mouthPucker:.8,jawOpen:.8},0),false);assert.equal(detector.update({mouthPucker:.8,jawOpen:.8},400),false);assert.equal(detector.update({mouthPucker:.7,jawOpen:0},500),false);assert.equal(detector.update(undefined,650),false);assert.equal(detector.update({mouthPucker:.7,jawOpen:0},700),false);});
test('new kiss requires release and respects cooldown',()=>{const detector=new KissDetector(),kiss={mouthPucker:.8,jawOpen:0};detector.update(kiss,0);assert.equal(detector.update(kiss,350),true);detector.update({mouthPucker:.1},500);assert.equal(detector.update(kiss,1200),false);assert.equal(detector.update(kiss,5000),false);assert.equal(detector.update(kiss,5400),true);});

test('one short sideways wave triggers without repeated shaking',()=>{const detector=new WaveDetector();const short=[0,.025,.055,.080,.055,.025,0];const signals=short.map((x,i)=>detector.update(palm(.5+x),i*100));assert.equal(signals.filter(Boolean).length,1);});
test('waving fingers with a mostly stationary wrist is recognized',()=>{const detector=new WaveDetector();const shifts=[0,.04,.08,.12,.08,.04,0,.04,.08,.12];let count=0;for(let i=0;i<shifts.length;i++){const hand=palm();for(const tip of [8,12,16,20])hand[tip].x+=shifts[i];if(detector.update(hand,i*100))count++;}assert.ok(count>=1);});

test('smile follows both mouth corners and ignores neutral or puckered lips',()=>{assert.equal(smileAmount(undefined),0);assert.equal(smileAmount({mouthSmileLeft:.1,mouthSmileRight:.1}),0);assert.equal(smileAmount({mouthSmileLeft:.9,mouthSmileRight:.8}),1);assert.equal(smileAmount({mouthSmileLeft:.9,mouthSmileRight:.8,mouthPucker:.8}),0);assert.ok(smileAmount({mouthSmileLeft:.5,mouthSmileRight:.5})>0);assert.ok(smileAmount({mouthSmileLeft:.5,mouthSmileRight:.5})<1);});

test('blink tracking handles each eye independently and both eyes together',()=>{assert.deepEqual(blinkAmounts(undefined),{left:0,right:0});assert.deepEqual(blinkAmounts({eyeBlinkLeft:.1,eyeBlinkRight:.2}),{left:0,right:0});assert.deepEqual(blinkAmounts({eyeBlinkLeft:.9,eyeBlinkRight:.1}),{left:1,right:0});assert.deepEqual(blinkAmounts({eyeBlinkLeft:.1,eyeBlinkRight:.9}),{left:0,right:1});assert.deepEqual(blinkAmounts({eyeBlinkLeft:.9,eyeBlinkRight:.9}),{left:1,right:1});});

test('raising an open hand vertically does not trigger goodbye',()=>{const detector=new WaveDetector();for(let i=0;i<18;i++){const hand=palm(.5+Math.sin(i)*.008);for(const point of hand)point.y-=i*.016;assert.equal(detector.update(hand,i*100),false);}});

test('wide eyes raise brows while neutral eyes and blinks do not',()=>{assert.equal(wideEyesAmount(undefined),0);assert.equal(wideEyesAmount({eyeWideLeft:.1,eyeWideRight:.1}),0);assert.equal(wideEyesAmount({eyeWideLeft:.8,eyeWideRight:.8}),1);assert.equal(wideEyesAmount({eyeWideLeft:.8,eyeWideRight:.8,eyeBlinkLeft:.7}),0);const value=wideEyesAmount({eyeWideLeft:.25,eyeWideRight:.25});assert.ok(value>0&&value<1);});

test('raised brow signals also lift the avatar brows',()=>{assert.ok(wideEyesAmount({eyeWideLeft:.05,eyeWideRight:.05,browOuterUpLeft:.6,browOuterUpRight:.6})>.9);assert.ok(wideEyesAmount({browInnerUp:.6})>.9);});

test('each brow is independent and both can rise together',()=>{assert.deepEqual(browAmounts(undefined),{left:0,right:0});assert.deepEqual(browAmounts({browOuterUpLeft:.8,browOuterUpRight:0}),{left:1,right:0});assert.deepEqual(browAmounts({browOuterUpLeft:0,browOuterUpRight:.8}),{left:0,right:1});assert.deepEqual(browAmounts({browOuterUpLeft:.8,browOuterUpRight:.8}),{left:1,right:1});});

test('head pose follows turning and tilting independently of frame position',()=>{
 const points=Array.from({length:264},()=>({x:.5,y:.5}));
 points[33]={x:.35,y:.4};points[263]={x:.65,y:.4};points[1]={x:.5,y:.55};
 assert.ok(Math.abs(headPose(points,640,480).headYaw)<1e-8);
 assert.equal(headPose(points,640,480).headRoll,0);
 points[1].x=.6;assert.ok(headPose(points,640,480).headYaw<0);
 points[1].x=.4;assert.ok(headPose(points,640,480).headYaw>0);
 points[263].y=.45;assert.ok(headPose(points,640,480).headRoll>0);
 points[263].y=.35;assert.ok(headPose(points,640,480).headRoll<0);
 assert.deepEqual(headPose(undefined,640,480),{headYaw:0,headRoll:0});
 points[1].x=5;assert.ok(Math.abs(headPose(points,640,480).headYaw)<=.28);
});

test('teeth smile needs both a smile and separated lips',()=>{
 const p=Array.from({length:292},()=>({x:.5,y:.5}));
 p[61]={x:.4,y:.5};p[291]={x:.6,y:.5};
 const scores={mouthSmileLeft:.8,mouthSmileRight:.8};
 assert.equal(teethSmileAmount(scores,p,640,480),0);
 p[14]={x:.5,y:.54};assert.ok(teethSmileAmount(scores,p,640,480)>.9);
 assert.equal(teethSmileAmount({},p,640,480),0);
 assert.equal(teethSmileAmount({...scores,mouthPucker:.8},p,640,480),0);
 assert.equal(teethSmileAmount(scores,undefined,640,480),0);
});

function curledPalm(amount){
 const hand=palm();
 for(const [tip,offset] of [[8,-.07],[12,-.02],[16,.03],[20,.07]]){
  hand[tip]={x:.5+offset,y:.29+amount*.25,z:-amount*.04};
 }
 return hand;
}
test('discreet curling and extending fingers triggers without moving the wrist',()=>{
 const detector=new WaveDetector();
 const result=[0,.2,.5,.8,.5,.2,0].map((curl,i)=>detector.update(curledPalm(curl),i*100));
 assert.ok(result.some(Boolean));
});
test('only curling once or holding curled fingers does not wave',()=>{
 const detector=new WaveDetector();
 for(let i=0;i<25;i++)assert.equal(detector.update(curledPalm(Math.min(1,i/6)),i*100),false);
});
test('moving only one finger is not a goodbye',()=>{
 const detector=new WaveDetector();
 for(const [i,curl] of [0,.2,.5,.8,.5,.2,0].entries()){
  const hand=palm();hand[8]=curledPalm(curl)[8];assert.equal(detector.update(hand,i*100),false);
 }
});
test('discreet waves can repeat without a cooldown',()=>{
 const detector=new WaveDetector();
 for(const start of [0,800])assert.ok([0,.2,.5,.8,.5,.2,0].some((curl,i)=>detector.update(curledPalm(curl),start+i*100)));
});

test('small finger curls are detected with a stationary wrist',()=>{
 const detector=new WaveDetector();
 assert.ok([0,.06,.12,.18,.12,.06,0].map((curl,i)=>detector.update(curledPalm(curl),i*100)).some(Boolean));
});
test('fingertips bending toward the camera trigger a discreet wave',()=>{
 const detector=new WaveDetector();
 const signals=[0,.015,.03,.05,.03,.015,0].map((depth,i)=>{
  const hand=palm();for(const tip of [8,12,16,20])hand[tip].z=-depth;
  return detector.update(hand,i*100);
 });
 assert.ok(signals.some(Boolean));
});
test('small finger tracking noise does not trigger a wave',()=>{
 const detector=new WaveDetector();
 for(let i=0;i<40;i++){
  const hand=palm();for(const tip of [8,12,16,20]){hand[tip].y+=Math.sin(i)*.003;hand[tip].z=Math.cos(i)*.002;}
  assert.equal(detector.update(hand,i*100),false);
 }
});

test('quick discreet wave works with two fingers and four camera frames',()=>{
 const detector=new WaveDetector();
 const signals=[0,.14,.28,0].map((curl,i)=>{
  const hand=palm(),curled=curledPalm(curl);
  hand[8]=curled[8];hand[12]=curled[12];
  return detector.update(hand,i*100);
 });
 assert.ok(signals.some(Boolean));
});
test('wave works when the fingers never fully straighten',()=>{
 const detector=new WaveDetector();
 assert.ok([.75,.9,1,.9,.75].map((curl,i)=>detector.update(curledPalm(curl),i*100)).some(Boolean));
});
test('slow discreet wave tolerates a brief tracking gap',()=>{
 const detector=new WaveDetector();
 assert.ok([0,.25,.5,.25,0].map((curl,i)=>detector.update(curledPalm(curl),i*500)).some(Boolean));
});

test('wave kind distinguishes finger curls from a whole-hand lateral wave',()=>{
 const fingers=new WaveDetector();let fingerKind=null;
 for(const [i,curl] of [0,.2,.5,.8,.5,.2,0].entries())if(fingers.update(curledPalm(curl),i*100))fingerKind=fingers.lastKind;
 assert.equal(fingerKind,'fingers');
 const lateral=new WaveDetector();let lateralKind=null;
 for(const [i,offset] of sweep.entries())if(lateral.update(palm(.5+offset),i*100))lateralKind=lateral.lastKind;
 assert.equal(lateralKind,'sideways');
});

test('lateral wave with incidental finger bending keeps the full-hand animation',()=>{
 const detector=new WaveDetector(),kinds=[];
 for(const [i,offset] of sweep.entries()){
  const hand=palm(.5+offset);
  for(const tip of [8,12,16,20]){hand[tip].y+=.025*Math.sin(i);hand[tip].z=.025*Math.sin(i);}
  if(detector.update(hand,i*100))kinds.push(detector.lastKind);
 }
 assert.ok(kinds.includes('sideways'));
 assert.ok(!kinds.includes('fingers'));
});
test('sideways fingertip swaying is distinct from curling forward',()=>{
 const detector=new WaveDetector(),kinds=[];
 for(const [i,offset] of sweep.entries()){
  const hand=palm();for(const tip of [8,12,16,20])hand[tip].x+=offset;
  if(detector.update(hand,i*100))kinds.push(detector.lastKind);
 }
 assert.ok(kinds.includes('sideways'));
 assert.ok(!kinds.includes('fingers'));
});

test('raising a hand with incidental fingertip changes never triggers a wave',()=>{
 const detector=new WaveDetector();
 for(let i=0;i<20;i++){
  const hand=curledPalm(.10*(1+Math.sin(i)));
  for(const point of hand)point.y-=i*.02;
  assert.equal(detector.update(hand,i*100),false);
 }
});


test('arrival greets only after stable detection and does not repeat for movement',()=>{
 const detector=new ArrivalDetector();
 assert.equal(detector.update([{x:.5,y:.5}],0),null);
 assert.equal(detector.update([{x:.51,y:.5}],700),'Oi!');
 for(let time=800;time<10000;time+=100)assert.equal(detector.update([{x:.51+Math.sin(time)*.01,y:.5}],time),null);
});
test('a second arriving face is greeted without repeating the first greeting',()=>{
 const detector=new ArrivalDetector();const first={x:.25,y:.5},second={x:.75,y:.5};
 detector.update([first],0);assert.equal(detector.update([first],700),'Oi!');
 detector.update([first,second],5000);
 assert.equal(detector.update([second,first],5700),'Oi, você também!');
 assert.equal(detector.update([first,second],11000),null);
});
test('three stable faces trigger one group greeting and tolerate short tracking gaps',()=>{
 const detector=new ArrivalDetector();const group=[{x:.2,y:.5},{x:.5,y:.5},{x:.8,y:.5}];
 detector.update(group,0);assert.equal(detector.update(group,700),'Quanta gente! Tudo bem com vocês?');
 detector.update([],1000);assert.equal(detector.update(group,1500),null);
 assert.equal(detector.update(group,7000),null);
});
test('returning after leaving gets a new greeting while a brief disappearance does not',()=>{
 const detector=new ArrivalDetector();const face={x:.5,y:.5};
 detector.update([face],0);detector.update([face],700);
 detector.update([],1000);assert.equal(detector.update([face],1500),null);
 detector.update([],5000);detector.update([face],6000);
 assert.equal(detector.update([face],6700),'Oi, você também!');
});
test('a transient detection does not trigger a greeting',()=>{
 const detector=new ArrivalDetector();detector.update([{x:.5,y:.5}],0);
 assert.equal(detector.update([],500),null);assert.equal(detector.update([],2500),null);
});

test('new arrivals rotate greetings while keeping the original greeting',()=>{
 const detector=new ArrivalDetector(),heard=[];
 for(let i=0;i<8;i++){
   const time=i*7000;detector.update([],time);detector.update([{x:.5,y:.5}],time);
   heard.push(detector.update([{x:.5,y:.5}],time+700));
 }
 assert.equal(heard[0],'Oi!');assert.equal(heard[1],'Oi, você também!');
 assert.equal(heard[2],'Olá! Tudo bem?');
 assert.equal(new Set(heard.slice(1,7)).size,6);
 assert.equal(heard[7],'Oi, você também!');
});
test('returning groups receive varied crowd greetings',()=>{
 const detector=new ArrivalDetector(),group=[{x:.2,y:.5},{x:.5,y:.5},{x:.8,y:.5}];
 detector.update(group,0);assert.equal(detector.update(group,700),'Quanta gente! Tudo bem com vocês?');
 detector.update([],6000);detector.update([],8500);detector.update(group,9000);
 assert.equal(detector.update(group,9700),'Oi, pessoal! Que bom ver vocês por aqui!');
});

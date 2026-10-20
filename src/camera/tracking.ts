export type CameraTracking = {
  active: boolean;
  found: boolean;
  x: number;
  y: number;
  updatedAt: number;
  waveAt: number;
  kissAt: number;
  smile: number;
  blinkLeft: number;
  blinkRight: number;
  eyesWide: number;
  browLeft: number;
  browRight: number;
  smileTeeth: number;
  headYaw: number;
  headRoll: number;
};
export const idleTracking = (): CameraTracking => ({ active:false,found:false,x:0,y:0,updatedAt:0,waveAt:0,kissAt:0,smile:0,blinkLeft:0,blinkRight:0,eyesWide:0,browLeft:0,browRight:0,smileTeeth:0,headYaw:0,headRoll:0 });
export type Point = { x:number; y:number; z?:number };
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export function openPalm(hand:Point[]) {
  if(hand.length!==21)return false;
  const wrist=hand[0];
  const extended=[[8,6],[12,10],[16,14],[20,18]].filter(([tip,pip])=>distance(hand[tip],wrist)>distance(hand[pip],wrist)*1.16).length;
  return extended>=3 && distance(hand[5],hand[17])>0.025;
}
export class WaveDetector {
  private samples:{time:number;x:number;y:number}[]=[];
  private lastWave=-Infinity;
  update(hand:Point[]|undefined,now:number) {
    if(!hand||!openPalm(hand)) {
      if(this.samples.length&&now-this.samples[this.samples.length-1].time>350)this.samples=[];
      return false;
    }
    const palmX=(hand[0].x+hand[5].x+hand[9].x+hand[17].x)/4;
    const tipsX=(hand[8].x+hand[12].x+hand[16].x+hand[20].x)/4;
    const center={x:palmX*.35+tipsX*.65,y:(hand[0].y+hand[5].y+hand[9].y+hand[17].y)/4};
    const last=this.samples[this.samples.length-1];
    if(last&&(now-last.time>450||Math.hypot(center.x-last.x,center.y-last.y)>0.25))this.samples=[];
    this.samples.push({...center,time:now});this.samples=this.samples.filter(p=>now-p.time<1500);
    if(now-this.lastWave<3500||this.samples.length<5)return false;
    const palmWidth=distance(hand[5],hand[17]);
    const threshold=Math.max(0.022,Math.min(0.060,palmWidth*0.25));
    let anchor=this.samples[0].x,direction=0,reversals=0,peak=anchor;
    for(const sample of this.samples.slice(1)) {
      if(direction===0) { if(Math.abs(sample.x-anchor)>=threshold){direction=Math.sign(sample.x-anchor);peak=sample.x;} }
      else if((sample.x-peak)*direction>0)peak=sample.x;
      else if((peak-sample.x)*direction>=threshold){reversals++;direction*=-1;peak=sample.x;}
    }
    const xs=this.samples.map(p=>p.x),ys=this.samples.map(p=>p.y);
    if(reversals>=1 && now-this.samples[0].time>=300 && Math.max(...xs)-Math.min(...xs)>=threshold*1.6 && Math.max(...ys)-Math.min(...ys)<0.12 && Math.max(...xs)-Math.min(...xs)>(Math.max(...ys)-Math.min(...ys))*1.3) {
      this.lastWave=now;this.samples=[];return true;
    }
    return false;
  }
}
export function faceGaze(center:Point) {
  // Mirror like the preview: movement toward the preview's right means look right.
  const clamp=(n:number)=>Math.max(-1,Math.min(1,n));
  return {x:clamp((0.5-center.x)/0.32),y:clamp((0.48-center.y)/0.30)};
}

export class KissDetector {
  private heldAt:number|null=null;
  private lastKiss=-Infinity;
  private armed=true;
  update(scores:Record<string,number>|undefined,now:number) {
    const pucker=scores?.mouthPucker??0;
    if(!scores||pucker<0.30){this.heldAt=null;this.armed=true;return false;}
    const kissing=pucker>=0.55&&(scores.jawOpen??0)<0.28&&((scores.mouthSmileLeft??0)+(scores.mouthSmileRight??0))/2<0.4;
    if(!kissing){this.heldAt=null;return false;}
    if(!this.armed||now-this.lastKiss<4500)return false;
    this.heldAt??=now;
    if(now-this.heldAt<300)return false;
    this.lastKiss=now;this.heldAt=null;this.armed=false;return true;
  }
}

export function smileAmount(scores:Record<string,number>|undefined) {
  if(!scores||(scores.mouthPucker??0)>.5)return 0;
  const strength=((scores.mouthSmileLeft??0)+(scores.mouthSmileRight??0))/2;
  const t=Math.max(0,Math.min(1,(strength-.22)/.48));
  return t*t*(3-2*t);
}

export function blinkAmounts(scores:Record<string,number>|undefined) {
  const amount=(score:number)=>{const t=Math.max(0,Math.min(1,(score-.28)/.50));return t*t*(3-2*t);};
  return {left:amount(scores?.eyeBlinkLeft??0),right:amount(scores?.eyeBlinkRight??0)};
}

export function wideEyesAmount(scores:Record<string,number>|undefined) {
  if(!scores)return 0;
  const blink=Math.max(scores.eyeBlinkLeft??0,scores.eyeBlinkRight??0);
  if(blink>.4)return 0;
  const wide=((scores.eyeWideLeft??0)+(scores.eyeWideRight??0))/2;
  const outer=((scores.browOuterUpLeft??0)+(scores.browOuterUpRight??0))/2;
  const expression=Math.max(wide,outer*.9,(scores.browInnerUp??0)*.75);
  const t=Math.max(0,Math.min(1,(expression-.12)/.28));
  return t*t*(3-2*t);
}

export function browAmounts(scores:Record<string,number>|undefined) {
  const amount=(side:'Left'|'Right')=>{
    if(!scores||(scores['eyeBlink'+side]??0)>.4)return 0;
    const expression=Math.max(scores['eyeWide'+side]??0,(scores['browOuterUp'+side]??0)*.9,(scores.browInnerUp??0)*.75);
    const t=Math.max(0,Math.min(1,(expression-.12)/.28));return t*t*(3-2*t);
  };
  return {left:amount('Left'),right:amount('Right')};
}

// Eye-relative pose is independent of where the person sits in the frame.
export function headPose(points:Point[]|undefined,width:number,height:number) {
  const left=points?.[33],right=points?.[263],nose=points?.[1];
  if(!left||!right||!nose||width<=0||height<=0)return {headYaw:0,headRoll:0};
  const dx=(right.x-left.x)*width,dy=(right.y-left.y)*height;
  const span=Math.hypot(dx,dy);
  if(span<1)return {headYaw:0,headRoll:0};
  const noseX=(nose.x-(left.x+right.x)/2)*width;
  const noseY=(nose.y-(left.y+right.y)/2)*height;
  const horizontal=(noseX*dx+noseY*dy)/(span*span);
  const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value));
  return {headYaw:clamp(-horizontal*.9,.28),headRoll:clamp(Math.atan2(dy,dx),.32)};
}

export function teethSmileAmount(scores:Record<string,number>|undefined,points:Point[]|undefined,width:number,height:number) {
  const smile=smileAmount(scores);
  const upper=points?.[13],lower=points?.[14],left=points?.[61],right=points?.[291];
  if(!smile||!upper||!lower||!left||!right||width<=0||height<=0)return 0;
  const pixelDistance=(a:Point,b:Point)=>Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
  const mouthWidth=pixelDistance(left,right);
  if(mouthWidth<1)return 0;
  const gap=pixelDistance(upper,lower)/mouthWidth;
  const t=Math.max(0,Math.min(1,(gap-.025)/.105));
  return smile*t*t*(3-2*t);
}

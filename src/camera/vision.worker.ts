/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { teethSmileAmount, headPose, faceGaze, ArrivalDetector, WaveDetector, KissDetector, smileAmount, blinkAmounts, wideEyesAmount, browAmounts, type Point } from './tracking';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let face:FaceLandmarker|undefined,hands:HandLandmarker|undefined;
let previous:Point|undefined,lastFaceAt=0;
const wave=new WaveDetector();
const arrivals=new ArrivalDetector();
const kiss=new KissDetector();
scope.onmessage=async(event:MessageEvent)=>{
  const message=event.data;
  if(message.type==='init') {
    try {
      const files=await FilesetResolver.forVisionTasks(message.base+'vision/wasm',true);
      // Both tasks share a cached ES-module loader. Restore its factory before
      // each initialization, because MediaPipe clears the global after use.
      const loader=await import(/* @vite-ignore */ files.wasmLoaderPath);
      const runtime=scope as unknown as {ModuleFactory:unknown};
      runtime.ModuleFactory=loader.default;
      face=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:message.base+'vision/models/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:5,outputFaceBlendshapes:true,minFaceDetectionConfidence:0.60,minFacePresenceConfidence:0.60,minTrackingConfidence:0.55});
      runtime.ModuleFactory=loader.default;
      hands=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:message.base+'vision/models/hand_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:0.50,minHandPresenceConfidence:0.50,minTrackingConfidence:0.50});
      scope.postMessage({type:'ready'});
    } catch(error) {face?.close();hands?.close();scope.postMessage({type:'error',message:String(error)});}
    return;
  }
  if(message.type!=='frame')return;
  const frame=message.frame as ImageBitmap;
  try {
    if(!face||!hands)throw new Error('Detector não inicializado');
    const faceResult=face.detectForVideo(frame,message.timestamp);
    const faces=faceResult.faceLandmarks.map((points,index)=>{
      const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
      const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      return {index,x:(minX+maxX)/2,y:(minY+maxY)/2,area:(maxX-minX)*(maxY-minY)};
    });
    const reference=message.timestamp-lastFaceAt<700?previous:undefined;
    faces.sort((a,b)=>reference?Math.hypot(a.x-reference.x,a.y-reference.y)-Math.hypot(b.x-reference.x,b.y-reference.y):b.area-a.area);
    const found=faces[0];
    const primaryIndex=found?.index??0;
    const scores=faceResult.faceBlendshapes[primaryIndex]?.categories.reduce((values,category)=>{values[category.categoryName]=category.score;return values;},{} as Record<string,number>);
    const greeting=arrivals.update(faces,message.timestamp);
    if(found){previous=found;lastFaceAt=message.timestamp;}
    const gaze=found?faceGaze(found):{x:0,y:0};
    const blink=blinkAmounts(scores);
    const brows=browAmounts(scores);
    const result=hands.detectForVideo(frame,message.timestamp);
    const waved=wave.update(result.landmarks[0],message.timestamp);
    scope.postMessage({type:'result',faceCount:faces.length,greeting,handVisible:!!result.landmarks[0],waveKind:wave.lastKind,found:!!found,...gaze,...headPose(faceResult.faceLandmarks[primaryIndex],frame.width,frame.height),wave:waved,kiss:kiss.update(scores,message.timestamp),smile:smileAmount(scores),smileTeeth:teethSmileAmount(scores,faceResult.faceLandmarks[primaryIndex],frame.width,frame.height),blinkLeft:blink.left,blinkRight:blink.right,eyesWide:wideEyesAmount(scores),browLeft:brows.left,browRight:brows.right});
  } catch(error) {scope.postMessage({type:'error',message:String(error)});}
  finally{frame.close();}
};

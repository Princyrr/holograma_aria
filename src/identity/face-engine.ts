import * as faceapi from '@vladmandic/face-api';
let loading:Promise<void>|null=null;
export function loadFaceEngine(){
  if(!loading)loading=(async()=>{
    const backend=faceapi.tf as unknown as {setBackend:(name:string)=>Promise<boolean>;ready:()=>Promise<void>};
    await backend.setBackend('webgl');await backend.ready();
    const url=new URL(import.meta.env.BASE_URL+'vision/identity/',window.location.origin).href;
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(url),faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),faceapi.nets.faceRecognitionNet.loadFromUri(url)]);
  })().catch(error=>{loading=null;throw error;});
  return loading;
}
export async function readFace(video:HTMLVideoElement){
  const found=await faceapi.detectAllFaces(video,new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.65})).withFaceLandmarks(true).withFaceDescriptors();
  return found;
}

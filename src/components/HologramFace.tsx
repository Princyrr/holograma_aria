import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CameraTracking } from '../camera/tracking';
import { createParticleHand } from './ParticleHand';
import * as THREE from 'three';
import faceUrl from '../assets/hologram-face-current.png';
import shouldersUrl from '../assets/hologram-shoulders.png';

export default function HologramFace({tracking}:{tracking:MutableRefObject<CameraTracking>}) {
  const host = useRef<HTMLDivElement>(null);
  const reactToClick = useRef<() => void>(() => {});
  const [failed, setFailed] = useState(false);
  const [speechMessage, setSpeechMessage] = useState('');
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);
    // A viewport-sized transparent canvas allows the hand to extend outside
    // the portrait container without moving its wrist or changing its scale.
    Object.assign(renderer.domElement.style,{position:'fixed',inset:'0',zIndex:'2',pointerEvents:'none'});
    renderer.autoClear=false;
    const scene = new THREE.Scene();
    const faceGroup = new THREE.Group(); scene.add(faceGroup);
    let reactionStart = -10000;
    let speaking = false, speechStarted = -10000, mouthOpen = 0, mouthRound = 0;
    let clickTimer = 0, lastClick = -10000;
    let utterance: SpeechSynthesisUtterance | null = null;
    let pendingSpeech = false;
    const welcomeText = 'Bem-vindos ao Observatório das Indústrias da Paraíba';
    let speechText = welcomeText;
    let done: ((error?:string)=>void) | undefined;
    let normalizedText = welcomeText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let estimatedDuration = 6.8;
    let boundaryIndex = -1, boundaryTime = 0, boundaryEnd = 0;
    const finishSpeech = () => {
      if (speaking) estimatedDuration = THREE.MathUtils.clamp((performance.now() - speechStarted) / 1000, 2, 20);
      speaking = false; pendingSpeech = false;
      setSpeechMessage('');
      const callback=done;done=undefined;callback?.();
    };
    const sayObservatorio = (text=welcomeText, onEnd?: (error?:string)=>void) => {
      if (utterance) {utterance.onstart=null;utterance.onend=null;utterance.onerror=null;utterance.onboundary=null;}
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      done?.();done=onEnd;
      speaking=false;pendingSpeech=false;
      speechText=text;normalizedText=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      estimatedDuration=Math.max(2,text.length/12);
      reactionStart = -10000;
      if (!('speechSynthesis' in window)) {
        setSpeechMessage('A voz não está disponível neste navegador.');
        done?.('A resposta está no histórico. A voz não está disponível neste navegador.');done=undefined;
        return;
      }
      utterance = new SpeechSynthesisUtterance(speechText);
      utterance.lang = 'pt-BR'; utterance.rate = 0.85; utterance.pitch = 1.05;
      const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('pt'));
      const voice = voices.find((item) => /luciana|francisca|female/i.test(item.name)) ?? voices.find((item) => item.lang.toLowerCase() === 'pt-br') ?? voices[0];
      if (voice) utterance.voice = voice;
      pendingSpeech = true;
      utterance.onstart = () => { pendingSpeech = false; speaking = true; speechStarted = performance.now(); boundaryIndex = -1; setSpeechMessage(speechText); };
      utterance.onboundary = (event) => {
        if (event.name !== 'word') return;
        boundaryIndex = event.charIndex;
        boundaryTime = performance.now();
        const word = speechText.slice(boundaryIndex).match(/^\S+/)?.[0] ?? '';
        boundaryEnd = boundaryIndex + word.length;
      };
      utterance.onend = finishSpeech;
      utterance.onerror = () => { speaking = false; pendingSpeech = false; setSpeechMessage('Não foi possível reproduzir a voz.');done?.('A resposta está no histórico, mas não foi possível reproduzir a voz.');done=undefined; };
      speechSynthesis.speak(utterance);
    };
    const externalSpeech=(event:Event)=>{const {text,onEnd}=(event as CustomEvent).detail;sayObservatorio(text,onEnd);};
    let welcomeAudio:HTMLAudioElement|null=null,welcomeUrl='',welcomeRun=0;
    let welcomeRequest:AbortController|null=null;
    const stopSpeech=()=>{welcomeRun++;welcomeRequest?.abort();welcomeRequest=null;if(welcomeAudio){welcomeAudio.onplaying=null;welcomeAudio.onended=null;welcomeAudio.onerror=null;welcomeAudio.pause();welcomeAudio=null;}if(welcomeUrl){URL.revokeObjectURL(welcomeUrl);welcomeUrl='';}if(utterance){utterance.onstart=null;utterance.onend=null;utterance.onerror=null;}if('speechSynthesis' in window)speechSynthesis.cancel();finishSpeech();};
    const audioStart=(event:Event)=>{stopSpeech();const {text,duration}=(event as CustomEvent).detail;speechText=text;normalizedText=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();estimatedDuration=duration;utterance=null;boundaryIndex=-1;speaking=true;speechStarted=performance.now();};
    const audioEnd=()=>finishSpeech();
    window.addEventListener('aria-audio-start',audioStart);
    window.addEventListener('aria-audio-end',audioEnd);
    window.addEventListener('aria-speak',externalSpeech);
    window.addEventListener('aria-stop',stopSpeech);
    const sayNaturalWelcome=async()=>{
      stopSpeech();const current=welcomeRun;const request=new AbortController();welcomeRequest=request;
      setSpeechMessage('Preparando a voz natural…');
      const timeout=window.setTimeout(()=>request.abort(),65000);
      try {
        const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:welcomeText}),signal:request.signal});
        if(!response.ok)throw new Error('Não foi possível gerar a voz natural. Tente novamente.');
        const blob=await response.blob();if(current!==welcomeRun)return;
        welcomeUrl=URL.createObjectURL(blob);welcomeAudio=new Audio(welcomeUrl);
        welcomeAudio.onplaying=()=>{if(current!==welcomeRun)return;speechText=welcomeText;normalizedText=welcomeText.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();estimatedDuration=welcomeAudio?.duration||6.8;utterance=null;boundaryIndex=-1;speaking=true;speechStarted=performance.now();setSpeechMessage(welcomeText);};
        welcomeAudio.onended=finishSpeech;
        welcomeAudio.onerror=()=>{finishSpeech();setSpeechMessage('Não foi possível tocar a voz natural.');};
        await welcomeAudio.play();
      }catch{if(current===welcomeRun)setSpeechMessage('Não foi possível tocar a voz natural. Tente novamente com dois cliques.');}
      finally{window.clearTimeout(timeout);}
    };
    reactToClick.current = () => {
      const now = performance.now();
      if (now - lastClick < 330) {
        window.clearTimeout(clickTimer); lastClick = -10000; void sayNaturalWelcome();
      } else {
        lastClick = now;
        clickTimer = window.setTimeout(() => { if (!speaking) reactionStart = performance.now(); }, 330);
      }
    };
    let downX = 0, downY = 0;
    const pointerDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) < 6) reactToClick.current();
    };
    container.addEventListener('pointerdown', pointerDown);
    container.addEventListener('pointerup', pointerUp);
    const gazeTarget = new THREE.Vector2();
    const gaze = new THREE.Vector2();
    const followPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || tracking.current.active) return;
      const rect = container.getBoundingClientRect();
      const headHeight=Math.min(760,rect.width*1.47);
      const focusY=rect.top+55+(1.725-(440-426)*3.45/860)*headHeight/3.45;
      gazeTarget.set(
        THREE.MathUtils.clamp((event.clientX - rect.left - rect.width / 2) / (rect.width * 0.4), -1, 1),
        THREE.MathUtils.clamp((focusY - event.clientY) / (headHeight * 0.42), -1, 1),
      );
    };
    const resetGaze = () => { if(!tracking.current.active)gazeTarget.set(0, 0); };
    window.addEventListener('pointermove', followPointer);
    document.documentElement.addEventListener('pointerleave', resetGaze);
    window.addEventListener('blur', resetGaze);
    const particleHand=createParticleHand(renderer.getPixelRatio());
    const greetingWave=()=>particleHand.trigger(performance.now());
    window.addEventListener('aria-greeting-wave',greetingWave);
    const handScene=new THREE.Scene();
    handScene.add(particleHand.group);
    const handCamera=new THREE.OrthographicCamera(-2,2,2,-4,.1,50);
    handCamera.position.set(0,0,7);
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -4, 0.1, 50);
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.ShaderMaterial | undefined;
    let portraitTexture: THREE.CanvasTexture | undefined;
    let frame = 0, disposed = false;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      renderer.setSize(window.innerWidth,window.innerHeight);
      // Anchor the original head near the top; extra height reveals the shoulders.
      const pixelsPerUnit=Math.min(760,bounds.width*1.47)/3.45;
      const halfWidth=bounds.width/(2*pixelsPerUnit);
      camera.left=-halfWidth; camera.right=halfWidth;
      camera.top=1.725+55/pixelsPerUnit;
      camera.bottom=camera.top-bounds.height/pixelsPerUnit;
      if(material)material.uniforms.uTorsoStretch.value=Math.max(1,(-1.38-camera.bottom+0.60)/2.48);
      camera.updateProjectionMatrix();
    };
    const bounds = container.getBoundingClientRect();
    camera.position.set(0,0,7);

    const observer=new ResizeObserver(resize); observer.observe(container); resize();
    window.addEventListener('resize',resize);
    const image=new Image();
    const shoulders=new Image();
    let built=false;
    const loadPortrait=() => {
      if(disposed||built||!image.naturalWidth||!shoulders.naturalWidth)return;
      built=true;
      // Crop transparent margins so the face fills the view, preserving alpha.
      const original=document.createElement('canvas'); original.width=image.naturalWidth; original.height=1420;
      const originalContext=original.getContext('2d')!; originalContext.drawImage(image,0,0);
      // Keep every original head pixel; blend only the generated continuation below the neck.
      const body=document.createElement('canvas'); body.width=original.width; body.height=original.height;
      const bodyContext=body.getContext('2d')!;
      const extensionScale=213/172;
      bodyContext.drawImage(shoulders,848-686*extensionScale,426-334*extensionScale,
        shoulders.naturalWidth*extensionScale,shoulders.naturalHeight*extensionScale);
      bodyContext.globalCompositeOperation='destination-in';
      const blend=bodyContext.createLinearGradient(0,760,0,810);
      blend.addColorStop(0,'rgba(255,255,255,0)'); blend.addColorStop(1,'rgba(255,255,255,1)');
      bodyContext.fillStyle=blend; bodyContext.fillRect(0,0,body.width,body.height);
      originalContext.drawImage(body,0,0);
      const originalPixels=originalContext.getImageData(0,0,original.width,original.height).data;
      let left=original.width,top=original.height,right=0,bottom=0;
      for(let y=0;y<original.height;y+=2) for(let x=0;x<original.width;x+=2) {
        if(originalPixels[(y*original.width+x)*4+3]<40)continue;
        left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      }
      if(right<=left||bottom<=top){setFailed(true);return;}
      const cropWidth=right-left+1,cropHeight=bottom-top+1;
      const sample=document.createElement('canvas'); sample.width=1100; sample.height=Math.round(sample.width*cropHeight/cropWidth);
      const ctx=sample.getContext('2d')!; ctx.drawImage(original,left,top,cropWidth,cropHeight,0,0,sample.width,sample.height);
      const portraitPixels=ctx.getImageData(0,0,sample.width,sample.height);
      const pixels=portraitPixels.data;
      portraitTexture = new THREE.CanvasTexture(sample);
      portraitTexture.colorSpace = THREE.SRGBColorSpace;
      const mouth = new THREE.Vector2((848-left)/cropWidth,1-(640-top)/cropHeight);
      const eyes = new THREE.Vector4((741-left)/cropWidth,1-(426-top)/cropHeight,(954-left)/cropWidth,1-(426-top)/cropHeight);
      const positions:number[]=[],colors:number[]=[],origins:number[]=[],alphas:number[]=[],seeds:number[]=[],uvs:number[]=[];
      const scale=3.45/860*cropWidth/sample.width;
      const anchorY=(440-top)/cropHeight*sample.height;
      for(let y=0;y<sample.height;y+=1) for(let x=0;x<sample.width;x+=1) {
        const i=(y*sample.width+x)*4;
        if(pixels[i+3]<30)continue;
        // Break the regular screen-aligned grid that produced moire on rotation.
        const jitterX=(Math.random()-0.5)*0.8;
        const jitterY=(Math.random()-0.5)*0.8;
        positions.push((x+jitterX-sample.width/2)*scale,(anchorY-y-jitterY)*scale,0);
        const color=new THREE.Color(pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255).convertSRGBToLinear();
        uvs.push((x+jitterX) / sample.width, 1 - (y+jitterY) / sample.height);
        colors.push(color.r,color.g,color.b); alphas.push(pixels[i+3]/255); seeds.push(Math.random());
        origins.push((Math.random()-0.5)*6,(Math.random()-0.5)*5,(Math.random()-0.5)*2);
      }
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      geometry.setAttribute('aOrigin',new THREE.Float32BufferAttribute(origins,3));
      geometry.setAttribute('aAlpha',new THREE.Float32BufferAttribute(alphas,1));
      geometry.setAttribute('aSeed',new THREE.Float32BufferAttribute(seeds,1));
      geometry.setAttribute('aUv',new THREE.Float32BufferAttribute(uvs,2));
      material=new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,vertexColors:true,
        uniforms:{uWaveShoulder:{value:0},uHeadYaw:{value:0},uTorsoStretch:{value:Math.max(1,(-1.38-camera.bottom+0.60)/2.48)},uFaceScale:{value:new THREE.Vector2(740/cropWidth,860/cropHeight)},uEyeWorldY:{value:(440-426)*3.45/860},uTime:{value:0},uFormation:{value:0},uPixelRatio:{value:renderer.getPixelRatio()},uGaze:{value:gaze},uEyes:{value:eyes},uPortrait:{value:portraitTexture},uRound:{value:0},uSpeak:{value:0},uSmile:{value:0},uTeeth:{value:0},uBrows:{value:new THREE.Vector2()},uCameraActive:{value:0},uKiss:{value:0},uWink:{value:0},uWinkLeft:{value:0},uMouth:{value:mouth}},
        vertexShader:`uniform float uWaveShoulder; uniform float uHeadYaw; uniform float uTorsoStretch; uniform vec2 uFaceScale; uniform float uEyeWorldY; uniform float uTime; uniform float uFormation; uniform float uPixelRatio;
          uniform float uRound; uniform float uSpeak; uniform float uSmile; uniform float uTeeth; uniform vec2 uBrows; uniform float uCameraActive; uniform float uKiss; uniform float uWink; uniform float uWinkLeft; uniform vec2 uMouth; uniform vec2 uGaze; uniform vec4 uEyes; uniform sampler2D uPortrait; attribute vec2 aUv;
          attribute vec3 aOrigin; attribute float aAlpha; attribute float aSeed;
          varying vec3 vColor; varying float vAlpha; varying float vY; varying float vX; varying float vClothing;
          void main(){
            float t=clamp(uFormation*1.3-aSeed*0.3,0.0,1.0); float ease=1.0-pow(1.0-t,3.0);
            vec3 target=position;
            if(target.y < -1.38)target.y=-1.38+(target.y+1.38)*uTorsoStretch;
            // Turn only the head, blending through the neck into fixed shoulders.
            float headWeight=smoothstep(-1.65,-1.20,position.y);
            float angle=uHeadYaw*headWeight;
            float headDepth=.38*sqrt(max(0.0,1.0-pow(clamp(position.x/1.35,-1.0,1.0),2.0)));
            target.x=position.x*cos(angle)+headDepth*sin(angle);
            target.z+=-position.x*sin(angle)+headDepth*(cos(angle)-1.0);
            // The waving-side shoulder lifts through a broad soft mask into the upper torso.
            float shoulderSide=smoothstep(.35,1.45,position.x);
            float belowNeck=1.0-smoothstep(-1.85,-1.45,position.y);
            float shoulderBand=exp(-pow((position.y+2.25)/.95,2.0));
            float shoulderWeight=shoulderSide*belowNeck*shoulderBand;
            target.y+=uWaveShoulder*.075*shoulderWeight;
            target.x+=uWaveShoulder*.012*shoulderWeight;

            vec3 p=mix(aOrigin,target,ease);
            p.z+=sin(uTime*0.8+aSeed*6.28)*0.012*ease*(1.0-ease);
            // Warp the sampled eye region, keeping the particle positions and eyelids stable.
            vec2 eyeRadius = vec2(0.080, 0.040) * uFaceScale;
            float leftEye = length((aUv - uEyes.xy) / eyeRadius);
            float rightEye = length((aUv - uEyes.zw) / eyeRadius);
            // A broad uniform center carries the entire iris and pupil together.
            // Feather only outside that region, toward the stationary eyelids.
            float eyeMask = 1.0 - smoothstep(0.72, 1.0, min(leftEye, rightEye));
            vec2 eyeUv = aUv - uGaze * vec2(0.010, 0.006) * uFaceScale * eyeMask * ease;
            // Each brow follows its own facial signal; camera gaze alone must
            // not lift the other brow when a person raises just one.
            bool leftBrow=abs(aUv.x-uEyes.x)<abs(aUv.x-uEyes.z);
            vec2 browCenter=leftBrow?uEyes.xy:uEyes.zw;
            float browExpression=leftBrow?uBrows.x:uBrows.y;
            float mouseLift=(1.0-uCameraActive)*smoothstep(.12,.90,uGaze.y)*.008;
            float browLift=(mouseLift+browExpression*.015)*ease*uFaceScale.y;
            float browX=abs(aUv.x-browCenter.x)/uFaceScale.x;
            float originalBrowY=browCenter.y+.070*uFaceScale.y;
            float relativeBrowY=(aUv.y-originalBrowY)/uFaceScale.y;
            float browAcross=1.0-smoothstep(.055,.105,browX);
            float lift=browLift/uFaceScale.y*browAcross;
            // Invert a continuous skin deformation. Its lower boundary is fixed
            // above the eyelid, so no eyelash is copied into the brow's old position.
            // The brow moves as one region and the adjacent skin stretches smoothly.
            if(lift>.00001&&relativeBrowY>-.040&&relativeBrowY<.120) {
              float low=relativeBrowY-lift,high=relativeBrowY;
              for(int iteration=0;iteration<9;iteration++) {
                float sourceY=(low+high)*.5;
                float influence=smoothstep(-.040,-.020,sourceY)
                               *(1.0-smoothstep(.035,.120,sourceY));
                if(sourceY+lift*influence<relativeBrowY)low=sourceY;
                else high=sourceY;
              }
              eyeUv.y=originalBrowY+(low+high)*.5*uFaceScale.y;
            }
            vec3 eyeColor=texture2D(uPortrait,eyeUv).rgb;
            // Warp the portrait for a smile while keeping particle spacing uniform.
            // Moving individual particles produced visible density rings around the lips.
            vec2 mouthDelta = (aUv - uMouth) / uFaceScale;
            float smileBand = (1.0 - smoothstep(0.018, 0.10, abs(mouthDelta.y)))
                            * (1.0 - smoothstep(0.11, 0.18, abs(mouthDelta.x)));
            float corners = smoothstep(0.025, 0.10, abs(mouthDelta.x));
            vec2 smileOffset = vec2(sign(mouthDelta.x) * 0.0015, 0.006)
                             * corners * smileBand * uSmile * ease;
            // Lift the original upper lip and ease the lower lip downward.
            // Resample the portrait rather than separating particles into gaps.
            float smileX=mouthDelta.x/.108;
            float openingShape=pow(max(0.0,1.0-smileX*smileX),.65);
            float lipOpening=uTeeth*ease;
            float mouthSeam=-.004+.010*smileX*smileX;
            float upperOpening=.010*openingShape*lipOpening;
            float lowerOpening=.004*openingShape*lipOpening;
            float aboveSeam=mouthDelta.y-mouthSeam;
            float skinFalloff=1.0-smoothstep(.025,.095,abs(aboveSeam));
            vec2 smileUv=aUv-smileOffset*uFaceScale;
            smileUv.y-=(aboveSeam>=0.0?upperOpening:-lowerOpening)*skinFalloff*uFaceScale.y;
            vec3 smileColor = texture2D(uPortrait, smileUv).rgb;
            float lipRegion = exp(-pow(mouthDelta.x / 0.125, 4.0) - pow(mouthDelta.y / 0.05, 2.0));
            // Articulate upper and lower lips separately, with a softer jaw falloff.
            float lowerLip = 1.0 - smoothstep(-0.012, 0.006, mouthDelta.y);
            float upperLip = smoothstep(0.002, 0.025, mouthDelta.y);
            float centerWeight = 1.0 - smoothstep(0.065, 0.14, abs(mouthDelta.x));
            p.y -= lowerLip * uSpeak * lipRegion * centerWeight * 0.09 * ease;
            p.y += upperLip * uSpeak * lipRegion * centerWeight * 0.026 * ease;
            p.x -= mouthDelta.x * 3.45 * uRound * lipRegion * 0.20 * ease;
            // Close just the eye on the viewer's right, then reopen it.
            bool viewerLeft = leftEye < rightEye;
            vec2 blinkingEye = viewerLeft ? uEyes.xy : uEyes.zw;
            float winkMask = 1.0 - smoothstep(0.75, 1.15, min(leftEye,rightEye));
            float eyeCenterY = uEyeWorldY;
            float winkAmount = (viewerLeft ? uWinkLeft : uWink) * winkMask * ease;
            // Draw the closed eyelid over the eye, instead of collapsing every
            // dark iris particle into a dense strip.
            vec2 lidUv = vec2(aUv.x, blinkingEye.y + 0.038 * uFaceScale.y);
            vec3 lidColor = texture2D(uPortrait, lidUv).rgb;
            lidColor = max(lidColor, vec3(0.035, 0.24, 0.32));
            float upperLid = step(blinkingEye.y, aUv.y);
            float lidCurve = eyeCenterY - 0.018 + 0.015 * pow(clamp((aUv.x - blinkingEye.x) / eyeRadius.x, -1.0, 1.0), 2.0);
            p.y = mix(p.y, lidCurve + (p.y - eyeCenterY) * 0.09, winkAmount * upperLid);
            // Do not blend the original iris back over the moved iris.
            vColor=mix(eyeColor, smileColor, smileBand * max(uSmile,uTeeth) * ease);
            // Pucker the lips through texture warping, keeping particle spacing stable.
            float kissMask=exp(-pow(mouthDelta.x/.16,4.0)-pow(mouthDelta.y/.075,4.0));
            vec2 kissDelta=mouthDelta*vec2(1.0+uKiss*.28*kissMask,1.0-uKiss*.06*kissMask);
            vec2 kissUv=uMouth+kissDelta*uFaceScale;
            vec3 kissColor=texture2D(uPortrait,kissUv).rgb;
            vColor=mix(vColor,kissColor,kissMask*uKiss*ease);
            // A thin blue inner-mouth crease makes the opening readable.
            float innerMouth = exp(-pow(mouthDelta.x / 0.075, 4.0) - pow((mouthDelta.y + 0.004) / 0.008, 2.0));
            vColor=mix(vColor, vec3(0.006, 0.035, 0.055), innerMouth * uSpeak * 0.55);
            // Reveal the mouth by opening its boundaries, not fading teeth
            // over the closed lips. The dental arch stays beneath the upper lip.
            float cavityTop=mouthSeam+upperOpening;
            float cavityBottom=mouthSeam-lowerOpening;
            float edgeSoftness=.0015;
            float cavity=smoothstep(cavityBottom-edgeSoftness,cavityBottom+edgeSoftness,mouthDelta.y)
                        *(1.0-smoothstep(cavityTop-edgeSoftness,cavityTop+edgeSoftness,mouthDelta.y));
            float openingVisible=smoothstep(.0005,.003,upperOpening+lowerOpening);
            cavity*=openingVisible;
            float dentalBottom=cavityTop-.007*openingShape;
            float teeth=smoothstep(dentalBottom-.0015,dentalBottom+.0015,mouthDelta.y)*cavity;
            float dentalShade=1.0-.22*abs(clamp(smileX,-1.0,1.0));
            vColor=mix(vColor,vec3(.006,.035,.052),cavity);
            vColor=mix(vColor,vec3(.59,.88,.94)*dentalShade,teeth);
            vColor=mix(vColor, lidColor * 1.12, winkAmount);
            // Fade the lower lid and iris so they do not stack on the crease.
            vAlpha=aAlpha * (1.0 - winkAmount * (1.0 - upperLid) * 0.96);
            vY=position.y;
            vX=position.x;
            // Restrict illumination to the uniform below the original neck.
            vClothing=smoothstep(1.35,1.65,-position.y)*ease;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
            gl_PointSize=1.8*uPixelRatio;
          }`,
        fragmentShader:`uniform float uTime; varying vec3 vColor; varying float vAlpha; varying float vY; varying float vX; varying float vClothing;
          void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5)discard;
            float coverage=exp(-d*d*9.0)*(1.0-smoothstep(0.35,0.5,d));
            // Only the existing bright cyan traces become pulsing lights.
            float brightTrace=smoothstep(0.28,0.72,max(vColor.g,vColor.b))
                             *smoothstep(0.12,0.48,vColor.g)*vClothing;
            float pulse=smoothstep(0.12,0.88,0.5+0.5*sin(uTime*1.65-vY*2.2+sin(vX*3.0)*0.8));
            vec3 illuminated=vColor*1.1*mix(1.0,0.30+1.65*pulse,brightTrace);
            illuminated+=vec3(0.015,0.10,0.14)*brightTrace*pulse;
            gl_FragColor=vec4(illuminated,vAlpha*coverage);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const portrait=new THREE.Points(geometry,material); portrait.frustumCulled=false; faceGroup.add(portrait);
    };
    image.onload=shoulders.onload=loadPortrait;
    image.onerror=shoulders.onerror=()=>{if(!disposed)setFailed(true);}; image.src=faceUrl; shoulders.src=shouldersUrl;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start:number|undefined;
    let previous = performance.now();
    let kissStartedAt=-10000;
    let mirroredBrowLeft=0,mirroredBrowRight=0;
    let headYaw=0;
    let mirroredTeeth=0,teethHoldUntil=0,teethPeak=0;
    let mirroredSmile=0,mirroredBlinkLeft=0,mirroredBlinkRight=0,holdLeftUntil=0,holdRightUntil=0;
    let lastWaveAt=tracking.current.waveAt,lastKissAt=tracking.current.kissAt,cameraWasActive=false;
    const render=(now:number)=>{
      if(disposed)return;
      const delta = Math.min(0.1, (now - previous) / 1000); previous = now;
      const cameraSignal=tracking.current;
      const faceVisible=cameraSignal.active&&cameraSignal.found&&now-cameraSignal.updatedAt<500;
      headYaw+=((faceVisible?cameraSignal.headYaw:0)-headYaw)*(1-Math.exp(-delta*10));
      mirroredBrowLeft+=((faceVisible?cameraSignal.browLeft:0)-mirroredBrowLeft)*(1-Math.exp(-delta*7));
      mirroredBrowRight+=((faceVisible?cameraSignal.browRight:0)-mirroredBrowRight)*(1-Math.exp(-delta*7));
      if(faceVisible&&cameraSignal.blinkLeft>.55)holdLeftUntil=now+140;
      if(faceVisible&&cameraSignal.blinkRight>.55)holdRightUntil=now+140;
      const blinkLeftTarget=faceVisible?Math.max(cameraSignal.blinkLeft,now<holdLeftUntil?1:0):0;
      const blinkRightTarget=faceVisible?Math.max(cameraSignal.blinkRight,now<holdRightUntil?1:0):0;
      mirroredBlinkLeft+=(blinkLeftTarget-mirroredBlinkLeft)*(1-Math.exp(-delta*24));
      mirroredBlinkRight+=(blinkRightTarget-mirroredBlinkRight)*(1-Math.exp(-delta*24));
      const smileTarget=cameraSignal.active&&cameraSignal.found&&now-cameraSignal.updatedAt<500?cameraSignal.smile:0;
      mirroredSmile+=(smileTarget-mirroredSmile)*(1-Math.exp(-delta*7));
      const teethSignal=faceVisible?cameraSignal.smileTeeth:0;
      if(teethSignal>.25){teethHoldUntil=now+160;teethPeak=teethSignal;}
      const teethTarget=faceVisible&&now<teethHoldUntil?Math.max(teethSignal,teethPeak):teethSignal;
      mirroredTeeth+=(teethTarget-mirroredTeeth)*(1-Math.exp(-delta*7));
      if(cameraSignal.active) {
        const visible=cameraSignal.found&&now-cameraSignal.updatedAt<500;
        gazeTarget.set(visible?cameraSignal.x:0,visible?cameraSignal.y:0);
        if(cameraSignal.waveAt>lastWaveAt){lastWaveAt=cameraSignal.waveAt;particleHand.trigger(now);}
      } else if(cameraWasActive)gazeTarget.set(0,0);
      if(cameraSignal.kissAt>lastKissAt){lastKissAt=cameraSignal.kissAt;kissStartedAt=now;}
      const shoulderWave=particleHand.update(now,camera.bottom,camera.right);
      if(material)material.uniforms.uWaveShoulder.value=reduced?0:shoulderWave;
      cameraWasActive=cameraSignal.active;
      gaze.lerp(gazeTarget, 1 - Math.exp(-delta * 8));
      // The body stays fixed; head turning is applied locally in the shader.
      faceGroup.rotation.set(0,0,0);
      const elapsedSpeech = (now - speechStarted) / 1000;
      if (speaking && elapsedSpeech > Math.max(60,estimatedDuration*3)) { speechSynthesis.cancel(); finishSpeech(); }
      if (speaking && !utterance && elapsedSpeech > estimatedDuration) finishSpeech();
      const letterDuration = estimatedDuration / normalizedText.length;
      const letterPosition = boundaryIndex >= 0
        ? Math.min(boundaryEnd, boundaryIndex + (now - boundaryTime) / 1000 / letterDuration)
        : elapsedSpeech / letterDuration;
      let opening = 0, rounding = 0;
      // Follow the vowels throughout the welcome sentence, using word events
      // from the browser when the selected voice provides them.
      if (speaking) for (let i = Math.max(0,Math.floor(letterPosition)-3); i < Math.min(normalizedText.length,Math.ceil(letterPosition)+4); i++) {
        const vowel = normalizedText[i];
        if (!'aeiou'.includes(vowel)) continue;
        const envelope = Math.exp(-Math.pow((letterPosition - i - 0.5) / 0.58, 2));
        const amount = vowel === 'a' ? 0.70 : vowel === 'e' ? 0.43 : vowel === 'i' ? 0.28 : 0.48;
        opening += envelope * amount;
        rounding += envelope * (vowel === 'o' || vowel === 'u' ? 0.9 : 0.04);
      }
      opening = Math.min(opening, 0.8);
      rounding = Math.min(rounding, 1);
      const smoothing = 1 - Math.exp(-delta * 18);
      mouthOpen += (opening - mouthOpen) * smoothing;
      mouthRound += (rounding - mouthRound) * smoothing;


      if(material){
        start??=now;
        material.uniforms.uFormation.value=reduced?1:Math.min(1,(now-start)/2200);
        material.uniforms.uTime.value=reduced?0:(now-start)/1000;
        const reactionTime = (now - reactionStart) / 1000;
        const rise = THREE.MathUtils.smoothstep(reactionTime, 0, 0.3);
        const fade = 1 - THREE.MathUtils.smoothstep(reactionTime, 1.65, 2.30);
        material.uniforms.uBrows.value.set(mirroredBrowRight,mirroredBrowLeft);
        material.uniforms.uCameraActive.value=cameraSignal.active?1:0;
        material.uniforms.uHeadYaw.value=reduced?0:(cameraSignal.active?headYaw:gaze.x*.085);
        material.uniforms.uSpeak.value = mouthOpen;
        material.uniforms.uRound.value = mouthRound;
        const kissTime=(now-kissStartedAt)/1000;
        const kissAmount=THREE.MathUtils.smoothstep(kissTime,0,.32)*(1-THREE.MathUtils.smoothstep(kissTime,.80,1.40));
        material.uniforms.uKiss.value=speaking?0:kissAmount;
        material.uniforms.uSmile.value = speaking ? 0 : Math.max(rise * fade,mirroredSmile)*(1-kissAmount);
        material.uniforms.uTeeth.value=speaking?0:mirroredTeeth*(1-kissAmount);
        const closeEye = THREE.MathUtils.smoothstep(reactionTime, 0.22, 0.4);
        const openEye = 1 - THREE.MathUtils.smoothstep(reactionTime, 0.75, 1.05);
        material.uniforms.uWink.value = Math.max(closeEye * openEye,mirroredBlinkLeft);
        material.uniforms.uWinkLeft.value = mirroredBlinkRight;
      }
      const viewport=container.getBoundingClientRect();
      const pixelsPerUnit=viewport.width/(camera.right-camera.left);
      handCamera.left=camera.left-viewport.left/pixelsPerUnit;
      handCamera.right=handCamera.left+window.innerWidth/pixelsPerUnit;
      handCamera.top=camera.top+viewport.top/pixelsPerUnit;
      handCamera.bottom=handCamera.top-window.innerHeight/pixelsPerUnit;
      handCamera.updateProjectionMatrix();
      renderer.setScissorTest(false);renderer.clear();
      renderer.setViewport(viewport.left,window.innerHeight-viewport.bottom,viewport.width,viewport.height);
      renderer.setScissor(viewport.left,window.innerHeight-viewport.bottom,viewport.width,viewport.height);
      renderer.setScissorTest(true);renderer.render(scene,camera);
      renderer.setScissorTest(false);renderer.clearDepth();
      renderer.setViewport(0,0,window.innerWidth,window.innerHeight);
      renderer.render(handScene,handCamera);
      frame=requestAnimationFrame(render);
    };
    frame=requestAnimationFrame(render);
    return()=>{window.removeEventListener('aria-greeting-wave',greetingWave);stopSpeech();window.removeEventListener('aria-audio-start',audioStart);window.removeEventListener('aria-audio-end',audioEnd);window.removeEventListener('aria-speak',externalSpeech);window.removeEventListener('aria-stop',stopSpeech);done?.();disposed=true; window.clearTimeout(clickTimer); if (utterance) { utterance.onstart = null; utterance.onboundary = null; utterance.onend = null; utterance.onerror = null; if (speaking || pendingSpeech) speechSynthesis.cancel(); } cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize',resize); container.removeEventListener('pointerdown',pointerDown); container.removeEventListener('pointerup',pointerUp); reactToClick.current=()=>{}; window.removeEventListener('pointermove',followPointer); document.documentElement.removeEventListener('pointerleave',resetGaze); window.removeEventListener('blur',resetGaze); particleHand.dispose(); portraitTexture?.dispose(); image.onload=null; image.onerror=null; shoulders.onload=null; shoulders.onerror=null; geometry?.dispose(); material?.dispose(); renderer.dispose(); renderer.domElement.remove();};
  },[]);
  return <div ref={host} className="face-hologram-view" role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reactToClick.current(); } }} aria-label="Clique para sorrir e piscar; dois cliques rápidos para dar boas-vindas ao Observatório das Indústrias da Paraíba">{speechMessage && <p className="absolute bottom-4 left-0 right-0 text-center text-cyan-200" role="status">{speechMessage}</p>}{failed&&<p className="particle-fallback">Não foi possível exibir o holograma neste navegador.</p>}</div>;
}

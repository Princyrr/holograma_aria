import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import faceUrl from '../assets/hologram-face-reference.png';

export default function HologramFace() {
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
    const scene = new THREE.Scene();
    const faceGroup = new THREE.Group(); scene.add(faceGroup);
    let reactionStart = -10000;
    let speaking = false, speechStarted = -10000, mouthOpen = 0, mouthRound = 0;
    let clickTimer = 0, lastClick = -10000;
    let utterance: SpeechSynthesisUtterance | null = null;
    let pendingSpeech = false;
    const welcomeText = 'Bem-vindos ao Observatório das Indústrias da Paraíba';
    const normalizedText = welcomeText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let estimatedDuration = 6.8;
    let boundaryIndex = -1, boundaryTime = 0, boundaryEnd = 0;
    const finishSpeech = () => {
      if (speaking) estimatedDuration = THREE.MathUtils.clamp((performance.now() - speechStarted) / 1000, 2, 20);
      speaking = false; pendingSpeech = false;
      setSpeechMessage('');
    };
    const sayObservatorio = () => {
      if (speaking || pendingSpeech) return;
      reactionStart = -10000;
      if (!('speechSynthesis' in window)) {
        speechStarted = performance.now(); speaking = true;
        setSpeechMessage('A voz não está disponível neste navegador.');
        return;
      }
      utterance = new SpeechSynthesisUtterance(welcomeText);
      utterance.lang = 'pt-BR'; utterance.rate = 0.85; utterance.pitch = 1.05;
      const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('pt'));
      const voice = voices.find((item) => /luciana|francisca|female/i.test(item.name)) ?? voices.find((item) => item.lang.toLowerCase() === 'pt-br') ?? voices[0];
      if (voice) utterance.voice = voice;
      pendingSpeech = true;
      utterance.onstart = () => { pendingSpeech = false; speaking = true; speechStarted = performance.now(); boundaryIndex = -1; setSpeechMessage(welcomeText); };
      utterance.onboundary = (event) => {
        if (event.name !== 'word') return;
        boundaryIndex = event.charIndex;
        boundaryTime = performance.now();
        const word = welcomeText.slice(boundaryIndex).match(/^\S+/)?.[0] ?? '';
        boundaryEnd = boundaryIndex + word.length;
      };
      utterance.onend = finishSpeech;
      utterance.onerror = () => { speaking = false; pendingSpeech = false; setSpeechMessage('Não foi possível reproduzir a voz.'); };
      speechSynthesis.speak(utterance);
    };
    reactToClick.current = () => {
      const now = performance.now();
      if (now - lastClick < 330) {
        window.clearTimeout(clickTimer); lastClick = -10000; sayObservatorio();
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
      if (event.pointerType === 'touch') return;
      const rect = container.getBoundingClientRect();
      gazeTarget.set(
        THREE.MathUtils.clamp((event.clientX - rect.left - rect.width / 2) / (rect.width * 0.4), -1, 1),
        THREE.MathUtils.clamp((rect.top + rect.height / 2 - event.clientY) / (rect.height * 0.35), -1, 1),
      );
    };
    const resetGaze = () => gazeTarget.set(0, 0);
    window.addEventListener('pointermove', followPointer);
    document.documentElement.addEventListener('pointerleave', resetGaze);
    window.addEventListener('blur', resetGaze);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 4; controls.maxDistance = 10;
    controls.minAzimuthAngle = -0.25; controls.maxAzimuthAngle = 0.25;
    controls.minPolarAngle = 1.35; controls.maxPolarAngle = 1.8;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.ShaderMaterial | undefined;
    let portraitTexture: THREE.CanvasTexture | undefined;
    let frame = 0, disposed = false;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      renderer.setSize(bounds.width,bounds.height);
      camera.aspect=bounds.width/Math.max(bounds.height,1); camera.updateProjectionMatrix();
    };
    const bounds = container.getBoundingClientRect();
    camera.position.set(0,0,bounds.width/Math.max(bounds.height,1)<0.7?7:6.1);
    controls.update();
    const observer=new ResizeObserver(resize); observer.observe(container); resize();
    const image=new Image();
    image.onload=() => {
      if(disposed)return;
      // Crop transparent margins so the face fills the view, preserving alpha.
      const original=document.createElement('canvas'); original.width=image.naturalWidth; original.height=image.naturalHeight;
      const originalContext=original.getContext('2d')!; originalContext.drawImage(image,0,0);
      const originalPixels=originalContext.getImageData(0,0,original.width,original.height).data;
      let left=original.width,top=original.height,right=0,bottom=0;
      for(let y=0;y<original.height;y+=2) for(let x=0;x<original.width;x+=2) {
        if(originalPixels[(y*original.width+x)*4+3]<40)continue;
        left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      }
      if(right<=left||bottom<=top){setFailed(true);return;}
      const cropWidth=right-left+1,cropHeight=bottom-top+1;
      const sample=document.createElement('canvas'); sample.width=380; sample.height=Math.round(380*cropHeight/cropWidth);
      const ctx=sample.getContext('2d')!; ctx.drawImage(image,left,top,cropWidth,cropHeight,0,0,sample.width,sample.height);
      const pixels=ctx.getImageData(0,0,sample.width,sample.height).data;
      portraitTexture = new THREE.CanvasTexture(sample);
      portraitTexture.colorSpace = THREE.SRGBColorSpace;
      const mouth = new THREE.Vector2((848-left)/cropWidth,1-(640-top)/cropHeight);
      const eyes = new THREE.Vector4((741-left)/cropWidth,1-(426-top)/cropHeight,(944-left)/cropWidth,1-(426-top)/cropHeight);
      const positions:number[]=[],colors:number[]=[],origins:number[]=[],alphas:number[]=[],seeds:number[]=[],uvs:number[]=[];
      const scale=3.45/sample.height;
      for(let y=0;y<sample.height;y+=2) for(let x=0;x<sample.width;x+=2) {
        const i=(y*sample.width+x)*4;
        if(pixels[i+3]<30)continue;
        positions.push((x-sample.width/2)*scale,(sample.height/2-y)*scale,0);
        const color=new THREE.Color(pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255).convertSRGBToLinear();
        uvs.push(x / sample.width, 1 - y / sample.height);
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
        uniforms:{uTime:{value:0},uFormation:{value:0},uPixelRatio:{value:renderer.getPixelRatio()},uGaze:{value:gaze},uEyes:{value:eyes},uPortrait:{value:portraitTexture},uRound:{value:0},uSpeak:{value:0},uSmile:{value:0},uWink:{value:0},uMouth:{value:mouth}},
        vertexShader:`uniform float uTime; uniform float uFormation; uniform float uPixelRatio;
          uniform float uRound; uniform float uSpeak; uniform float uSmile; uniform float uWink; uniform vec2 uMouth; uniform vec2 uGaze; uniform vec4 uEyes; uniform sampler2D uPortrait; attribute vec2 aUv;
          attribute vec3 aOrigin; attribute float aAlpha; attribute float aSeed;
          varying vec3 vColor; varying float vAlpha; varying float vY;
          void main(){
            float t=clamp(uFormation*1.3-aSeed*0.3,0.0,1.0); float ease=1.0-pow(1.0-t,3.0);
            vec3 p=mix(aOrigin,position,ease);
            p.z+=sin(uTime*0.8+aSeed*6.28)*0.012*ease;
            // Warp the sampled eye region, keeping the particle positions and eyelids stable.
            vec2 eyeRadius = vec2(0.068, 0.039);
            float leftEye = length((aUv - uEyes.xy) / eyeRadius);
            float rightEye = length((aUv - uEyes.zw) / eyeRadius);
            float eyeMask = 1.0 - smoothstep(0.28, 1.0, min(leftEye, rightEye));
            vec2 eyeUv = aUv - uGaze * vec2(0.017, 0.011) * eyeMask * ease;
            vec3 eyeColor = texture2D(uPortrait, eyeUv).rgb;
            // Lift the lip corners gently, preserving the original face texture.
            vec2 mouthDelta = aUv - uMouth;
            float mouthMask = exp(-pow(mouthDelta.x / 0.14, 4.0) - pow(mouthDelta.y / 0.055, 2.0));
            float corners = smoothstep(0.025, 0.11, abs(mouthDelta.x));
            p.y += uSmile * mouthMask * corners * 0.045 * ease;
            p.x += sign(mouthDelta.x) * uSmile * mouthMask * corners * 0.012 * ease;
            float lipRegion = exp(-pow(mouthDelta.x / 0.125, 4.0) - pow(mouthDelta.y / 0.05, 2.0));
            // Articulate upper and lower lips separately, with a softer jaw falloff.
            float lowerLip = 1.0 - smoothstep(-0.012, 0.006, mouthDelta.y);
            float upperLip = smoothstep(0.002, 0.025, mouthDelta.y);
            float centerWeight = 1.0 - smoothstep(0.065, 0.14, abs(mouthDelta.x));
            p.y -= lowerLip * uSpeak * lipRegion * centerWeight * 0.09 * ease;
            p.y += upperLip * uSpeak * lipRegion * centerWeight * 0.026 * ease;
            p.x -= mouthDelta.x * 3.45 * uRound * lipRegion * 0.20 * ease;
            // Close just the eye on the viewer's right, then reopen it.
            float winkMask = 1.0 - smoothstep(0.75, 1.15, rightEye);
            float eyeCenterY = (uEyes.w - 0.5) * 3.45;
            float winkAmount = uWink * winkMask * ease;
            // Draw the closed eyelid over the eye, instead of collapsing every
            // dark iris particle into a dense strip.
            vec2 lidUv = vec2(aUv.x, uEyes.w + 0.038);
            vec3 lidColor = texture2D(uPortrait, lidUv).rgb;
            lidColor = max(lidColor, vec3(0.035, 0.24, 0.32));
            float upperLid = step(uEyes.w, aUv.y);
            float lidCurve = eyeCenterY - 0.018 + 0.015 * pow(clamp((aUv.x - uEyes.z) / eyeRadius.x, -1.0, 1.0), 2.0);
            p.y = mix(p.y, lidCurve + (p.y - eyeCenterY) * 0.09, winkAmount * upperLid);
            vColor=mix(color, eyeColor, eyeMask);
            // A thin blue inner-mouth crease makes the opening readable.
            float innerMouth = exp(-pow(mouthDelta.x / 0.075, 4.0) - pow((mouthDelta.y + 0.004) / 0.008, 2.0));
            vColor=mix(vColor, vec3(0.006, 0.035, 0.055), innerMouth * uSpeak * 0.55);
            vColor=mix(vColor, lidColor * 1.12, winkAmount);
            // Fade the lower lid and iris so they do not stack on the crease.
            vAlpha=aAlpha * (1.0 - winkAmount * (1.0 - upperLid) * 0.96);
            vY=position.y;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
            gl_PointSize=2.7*uPixelRatio;
          }`,
        fragmentShader:`uniform float uTime; varying vec3 vColor; varying float vAlpha; varying float vY;
          void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5)discard;
            float scan=0.87+0.13*sin(vY*65.0-uTime*2.0);
            gl_FragColor=vec4(vColor*1.1,vAlpha*scan*(1.0-smoothstep(0.25,0.5,d)));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const portrait=new THREE.Points(geometry,material); portrait.frustumCulled=false; faceGroup.add(portrait);
    };
    image.onerror=()=>{if(!disposed)setFailed(true);}; image.src=faceUrl;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start:number|undefined;
    let previous = performance.now();
    const render=(now:number)=>{
      if(disposed)return;
      const delta = Math.min(0.1, (now - previous) / 1000); previous = now;
      gaze.lerp(gazeTarget, 1 - Math.exp(-delta * 8));
      const elapsedSpeech = (now - speechStarted) / 1000;
      if (speaking && elapsedSpeech > 30) finishSpeech();
      if (speaking && !utterance && elapsedSpeech > estimatedDuration) finishSpeech();
      const letterDuration = estimatedDuration / normalizedText.length;
      const letterPosition = boundaryIndex >= 0
        ? Math.min(boundaryEnd, boundaryIndex + (now - boundaryTime) / 1000 / letterDuration)
        : elapsedSpeech / letterDuration;
      let opening = 0, rounding = 0;
      // Follow the vowels throughout the welcome sentence, using word events
      // from the browser when the selected voice provides them.
      if (speaking) for (let i = 0; i < normalizedText.length; i++) {
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
      faceGroup.rotation.y = reduced ? 0 : gaze.x * 0.065;
      faceGroup.rotation.x = reduced ? 0 : -gaze.y * 0.04;
      if(material){
        start??=now;
        material.uniforms.uFormation.value=reduced?1:Math.min(1,(now-start)/2200);
        material.uniforms.uTime.value=reduced?0:(now-start)/1000;
        const reactionTime = (now - reactionStart) / 1000;
        const rise = THREE.MathUtils.smoothstep(reactionTime, 0, 0.3);
        const fade = 1 - THREE.MathUtils.smoothstep(reactionTime, 1.25, 1.85);
        material.uniforms.uSpeak.value = mouthOpen;
        material.uniforms.uRound.value = mouthRound;
        material.uniforms.uSmile.value = speaking ? 0 : rise * fade;
        const closeEye = THREE.MathUtils.smoothstep(reactionTime, 0.22, 0.4);
        const openEye = 1 - THREE.MathUtils.smoothstep(reactionTime, 0.55, 0.8);
        material.uniforms.uWink.value = closeEye * openEye;
      }
      controls.update(); renderer.render(scene,camera); frame=requestAnimationFrame(render);
    };
    frame=requestAnimationFrame(render);
    return()=>{disposed=true; window.clearTimeout(clickTimer); if (utterance) { utterance.onstart = null; utterance.onboundary = null; utterance.onend = null; utterance.onerror = null; if (speaking || pendingSpeech) speechSynthesis.cancel(); } cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); container.removeEventListener('pointerdown',pointerDown); container.removeEventListener('pointerup',pointerUp); reactToClick.current=()=>{}; window.removeEventListener('pointermove',followPointer); document.documentElement.removeEventListener('pointerleave',resetGaze); window.removeEventListener('blur',resetGaze); portraitTexture?.dispose(); image.onload=null; image.onerror=null; geometry?.dispose(); material?.dispose(); renderer.dispose(); renderer.domElement.remove();};
  },[]);
  return <div ref={host} className="face-hologram-view" role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reactToClick.current(); } }} aria-label="Clique para sorrir e piscar; dois cliques rápidos para dar boas-vindas ao Observatório das Indústrias da Paraíba">{speechMessage && <p className="absolute bottom-4 left-0 right-0 text-center text-cyan-200" role="status">{speechMessage}</p>}{failed&&<p className="particle-fallback">Não foi possível exibir o holograma neste navegador.</p>}</div>;
}

import * as THREE from 'three';
import handUrl from '../assets/hologram-wave-hand.png';

// The approved hand is rendered as particles, preserving its original anatomy.
export function createParticleHand(pixelRatio:number) {
  const group=new THREE.Group();group.visible=false;group.scale.setScalar(1.80);
  const geometry=new THREE.BufferGeometry();
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{uRatio:{value:pixelRatio},uOpacity:{value:1},uSleeveStretch:{value:1}},
    vertexShader:`uniform float uRatio;uniform float uSleeveStretch;varying vec3 vColor;varying float vAlpha;attribute float aAlpha;void main(){vColor=color;vAlpha=aAlpha;vec3 p=position;if(p.y<-.35)p.y=-.35+(p.y+.35)*uSleeveStretch;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);gl_PointSize=2.2*uRatio;}`,
    fragmentShader:`uniform float uOpacity;varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float coverage=exp(-d*d*8.)*(1.-smoothstep(.35,.5,d));gl_FragColor=vec4(vColor*1.12,coverage*vAlpha*uOpacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
  const hand=new THREE.Points(geometry,material);hand.renderOrder=3;hand.frustumCulled=false;group.add(hand);
  let started=-Infinity,loaded=false,disposed=false;
  let backingTexture:THREE.Texture|undefined,backingGeometry:THREE.PlaneGeometry|undefined,backingMaterial:THREE.ShaderMaterial|undefined;
  const image=new Image();
  image.onload=()=>{
    if(disposed)return;
    // An opaque alpha-cut surface prevents the face and uniform showing through.
    // A particle layer above it retains the holographic finish.
    backingTexture=new THREE.Texture(image);backingTexture.colorSpace=THREE.SRGBColorSpace;backingTexture.needsUpdate=true;
    const worldWidth=image.naturalWidth*1.65/780,worldHeight=image.naturalHeight*1.65/780;
    backingGeometry=new THREE.PlaneGeometry(worldWidth,worldHeight,1,80);
    backingGeometry.translate(-worldWidth*.02,0,-.003);
    backingMaterial=new THREE.ShaderMaterial({depthWrite:true,depthTest:true,transparent:false,uniforms:{uHand:{value:backingTexture},uSleeveStretch:material.uniforms.uSleeveStretch},
      vertexShader:`uniform float uSleeveStretch;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;if(p.y<-.35)p.y=-.35+(p.y+.35)*uSleeveStretch;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
      fragmentShader:`uniform sampler2D uHand;varying vec2 vUv;void main(){vec4 tex=texture2D(uHand,vUv);if(tex.a<.85)discard;gl_FragColor=vec4(tex.rgb*.16,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
    const backing=new THREE.Mesh(backingGeometry,backingMaterial);backing.renderOrder=2;backing.frustumCulled=false;group.add(backing);
    const canvas=document.createElement('canvas');canvas.width=560;canvas.height=Math.round(canvas.width*image.naturalHeight/image.naturalWidth);
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    const positions:number[]=[],colors:number[]=[],alphas:number[]=[];
    // Wrist pivot corresponds to the approved image, so only the hand sways;
    // the lower sleeve stays visually anchored below the page.
    const scale=1.65/(780/1536*canvas.height);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;if(pixels[i+3]<150)continue;
      const px=(x-canvas.width*0.52)*scale,py=(canvas.height*0.50-y)*scale;
      positions.push(px+(Math.random()-.5)*scale*.5,py+(Math.random()-.5)*scale*.5,0);
      const color=new THREE.Color(pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255).convertSRGBToLinear();
      colors.push(color.r,color.g,color.b);alphas.push(pixels[i+3]/255);
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('aAlpha',new THREE.Float32BufferAttribute(alphas,1));geometry.computeBoundingSphere();loaded=true;
  };
  image.src=handUrl;
  return {
    group,
    trigger(now:number){started=now;},
    update(now:number,bottom:number,right:number){
      const age=(now-started)/1000;
      if(!loaded||age<0||age>4.8){group.visible=false;return;}
      group.visible=true;
      const smooth=(t:number)=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
      const rise=1-Math.pow(1-THREE.MathUtils.clamp(age/1.0,0,1),3),lower=smooth((age-3.8)/1.0),lift=rise*(1-lower);
      // Right side of the viewer, next to the shoulder. Keep the fingers in frame.
      group.position.set(Math.min(2.35,Math.max(.45,right-.73)),THREE.MathUtils.lerp(bottom-2.8,-2.15,lift),.7);
      material.uniforms.uSleeveStretch.value=Math.max(1,(-.35-((bottom-group.position.y)/group.scale.y-.35))/1.27);
      const waving=smooth((age-.8)/.4)*(1-smooth((age-3.4)/.4));
      // Restore the original full waving arc; the hand is drawn above the container.
      group.rotation.z=.045+Math.sin((age-.8)*6.8)*.17*waving;
      group.rotation.y=0;
      material.uniforms.uOpacity.value=Math.min(1,lift*5);
    },
    dispose(){disposed=true;image.onload=null;geometry.dispose();material.dispose();backingTexture?.dispose();backingGeometry?.dispose();backingMaterial?.dispose();}
  };
}

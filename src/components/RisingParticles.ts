import * as THREE from 'three';

// Emit outside the silhouette, keeping the portrait clear.
export function createRisingParticles(source: number[], pixelRatio: number) {
  const count = 240;
  // Track both outer edges at every height, rather than emitting on the body.
  const bands = new Map<number, { y: number; left: number; right: number }>();
  for (let i = 0; i < source.length; i += 3) {
    const x = source[i], y = source[i + 1];
    const key = Math.round(y / 0.035);
    const band = bands.get(key);
    if (band) { band.left = Math.min(band.left, x); band.right = Math.max(band.right, x); }
    else bands.set(key, { y, left: x, right: x });
  }
  const edges = [...bands.values()].sort((a, b) => a.y - b.y);
  // Use the widest outline above each birth height as a safe rising corridor.
  // This keeps sparks beside the silhouette even as they pass the shoulders/head.
  const positions: number[] = [], seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    const edge = edges[Math.floor(Math.random() * edges.length)];
    const side = i % 2 === 0 ? -1 : 1;
    const above = edges.filter(band => band.y >= edge.y);
    const boundary = side < 0
      ? Math.min(...above.map(band => band.left))
      : Math.max(...above.map(band => band.right));
    positions.push(boundary + side * (0.025 + Math.random() * 0.035), edge.y, 0);
    seeds.push(Math.random(), Math.random(), Math.random());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uStretch: { value: 1 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 0 } },
    vertexShader: `
      attribute vec3 aSeed;
      uniform float uTime, uStretch, uPixelRatio, uOpacity;
      varying float vAlpha;
      varying float vFragment;
      varying vec3 vColor;
      void main() {
        float life = fract(aSeed.x + uTime / (5.0 + aSeed.y * 5.0));
        vec3 p = position;
        if (p.y < -1.38) p.y = -1.38 + (p.y + 1.38) * uStretch;
        float side = p.x < 0.0 ? -1.0 : 1.0;
        p.x += side * life * (0.06 + aSeed.z * 0.14)
             + sin(life * 7.0 + aSeed.y * 6.283) * life * 0.018;
        p.y += life * (1.6 + aSeed.z * 1.5);
        // All particles remain in the outer side corridors.
        vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life)) * uOpacity;
        vFragment = step(0.80, aSeed.z);
        float pulse = pow(0.5 + 0.5 * sin(uTime * (1.4 + aSeed.y * 1.2) + aSeed.x * 6.283), 5.0);
        vAlpha *= 0.55 + pulse * 0.75;
        vColor = mix(vec3(0.08, 0.65, 1.0), vec3(0.55, 1.0, 1.0), aSeed.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = mix(2.0 + aSeed.y * 3.0, 7.0 + aSeed.y * 3.0, vFragment) * uPixelRatio;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vFragment;
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float radius = length(uv);
        if (radius > 0.5) discard;
        float glow = exp(-radius * radius * 16.0) * (1.0 - smoothstep(0.3, 0.5, radius));
        // A minority of sparks become short vertical data fragments.
        float fragment = (1.0 - smoothstep(0.055, 0.14, abs(uv.x)))
                       * (1.0 - smoothstep(0.25, 0.46, abs(uv.y)));
        gl_FragColor = vec4(vColor, mix(glow, fragment, vFragment) * vAlpha * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  return {
    points,
    update(time: number, stretch: number, reduced: boolean) {
      material.uniforms.uTime.value = time;
      material.uniforms.uStretch.value = stretch;
      material.uniforms.uOpacity.value = reduced ? 0 : Math.min(1, time / 2.2);
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

import * as THREE from 'three';
import { NOISE, UTILS } from '../shaders/lib.js';

/**
 * water.js — the caustic surface.
 *
 * Used twice: once as the ceiling above the hero (you open the site *under*
 * something, looking up through it) and once as the wet ground of the garden.
 * Same shader, flipped and retuned. Ridged noise gives the caustic filaments;
 * a second, slower octave gives the swell underneath them.
 */

const VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;

${NOISE}

void main(){
  vUv = uv;
  vec3 p = position;
  float w = snoise(vec3(p.xy * 0.06, uTime * 0.12)) * 0.6
          + snoise(vec3(p.xy * 0.15, uTime * 0.2)) * 0.25;
  p.z += w * uAmp;
  vWave = w;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uTint;
uniform vec3  uDeep;
uniform float uOpacity;
uniform float uCaustic;
uniform float uFalloff;

varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;

${NOISE}
${UTILS}

/* ridged multifractal — the filament structure light makes on a surface */
float caustic(vec2 p, float t){
  float v = 0.0, a = 0.55, f = 1.0;
  for (int i = 0; i < 4; i++){
    float n = snoise(vec3(p * f, t * (0.3 + float(i) * 0.11)));
    n = 1.0 - abs(n);
    n *= n;
    v += n * a;
    f *= 1.9; a *= 0.55;
  }
  return v;
}

void main(){
  vec2 p = vWorld.xz * 0.16;
  float c = caustic(p, uTime * 0.5);
  c = pow(smoothstep(0.35, 1.15, c), 2.2);

  /* second pass, offset and slower — the light "swims" */
  float c2 = caustic(p * 0.6 + 13.0, uTime * 0.26);
  c2 = pow(smoothstep(0.45, 1.2, c2), 3.0);

  vec3 col = uDeep;
  col += uTint * (c * 0.75 + c2 * 0.45) * uCaustic;
  col += iridescence(c * 0.5 + uTime * 0.02) * c * 0.25;

  /* radial falloff so the plane never shows an edge */
  float d = length(vUv - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.35, 1.0, d);

  float a = clamp((0.02 + c * 0.32 + c2 * 0.16) * edge, 0.0, 1.0) * uOpacity * uFalloff;
  gl_FragColor = vec4(col, a);
}
`;

export class CausticSurface {
  constructor({
    size = 90, segments = 96, amp = 1.2,
    tint = 0x0af5c8, deep = 0x03141d,
    opacity = 1, caustic = 1,
  } = {}) {
    this.uniforms = {
      uTime:     { value: 0 },
      uAmp:      { value: amp },
      uTint:     { value: new THREE.Color(tint) },
      uDeep:     { value: new THREE.Color(deep) },
      uOpacity:  { value: opacity },
      uCaustic:  { value: caustic },
      uFalloff:  { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, segments, segments), mat);
    this.mesh.rotation.x = -Math.PI / 2;
  }

  setOpacity(o) {
    this.uniforms.uFalloff.value = o;
    this.mesh.visible = o > 0.004;
  }

  update(dt, t) {
    if (!this.mesh.visible) return;
    this.uniforms.uTime.value = t;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

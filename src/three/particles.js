import * as THREE from 'three';
import { GPGPU } from './gpgpu.js';
import { NOISE, CURL, UTILS } from '../shaders/lib.js';
import { sampleMark } from '../core/genome.js';

/**
 * particles.js — THE FIELD.
 *
 * One GPU-simulated particle system carries the entire site. It never gets
 * torn down or rebuilt; it *morphs*. Six formations live in the sim shader and
 * the scroll timeline crossfades between two of them at a time:
 *
 *   0 MARK    the SINA logo, in 3D, sampled from genome.js
 *   1 NEBULA  dispersion — the mark exhales into a shell of dust
 *   2 GRAPH   a neural graph: nodes with particles streaming along the edges
 *   3 CORE    the reactor's containment sphere, turbulent and power-driven
 *   4 STREAM  data panels — quantised bars and scanlines of floating telemetry
 *   5 GARDEN  bioluminescent blooms, the resting state at journey's end
 *
 * Integration is a spring toward the formation target plus divergence-free
 * curl noise, so particles swirl into place instead of marching in straight
 * lines. Nothing here is on the CPU except the uniforms.
 */

/** World anchors — the camera path in camera-path.js is built around these. */
export const ANCHORS = {
  MARK:   new THREE.Vector3(1.95, 0.35, 0),
  NEBULA: new THREE.Vector3(0, 0, -6),
  GRAPH:  new THREE.Vector3(0, 0, -18),
  CORE:   new THREE.Vector3(0, 0, -46),
  STREAM: new THREE.Vector3(0, 0, -70),
  GARDEN: new THREE.Vector3(0, -2.2, -120),
};

const FORMATIONS = /* glsl */ `

const vec3 A_NEBULA = vec3(0.0,  0.0,   -6.0);
const vec3 A_GRAPH  = vec3(0.0,  0.0,  -18.0);
const vec3 A_CORE   = vec3(0.0,  0.0,  -46.0);
const vec3 A_STREAM = vec3(0.0,  0.0,  -70.0);
const vec3 A_GARDEN = vec3(0.0, -2.2, -120.0);

vec3 nodePos(float i, float t){
  float a = hash11(i * 1.37) * 6.28318;
  float b = hash11(i * 3.11 + 5.0);
  float c = hash11(i * 7.53 + 9.0);
  vec3 p = vec3(cos(a) * (4.5 + b * 9.0), (c - 0.5) * 11.0, sin(a) * (3.0 + b * 8.0));
  p += vec3(sin(t * 0.31 + i), cos(t * 0.27 + i * 1.7), sin(t * 0.19 + i * 2.3)) * 0.55;
  return p;
}

vec3 panelCenter(float i){
  float a = (i - 2.0) * 1.15;
  return vec3(sin(a) * 7.5, cos(i * 2.3) * 2.4, -abs(cos(a)) * 4.0 + 2.0);
}

vec3 bloomCenter(float i){
  float a = hash11(i * 2.17) * 6.28318;
  float r = 2.0 + hash11(i * 5.31) * 7.0;
  return vec3(cos(a) * r, -1.6 + hash11(i * 8.9) * 0.5, sin(a) * r * 0.8 - 1.0);
}

/* ── 0 · the mark ───────────────────────────────────────────── */
vec3 fMark(vec2 uv, vec3 rnd){
  vec3 A_MARK = uMarkAnchor;   /* layout-driven: centred on portrait screens */
  vec3 t = texture2D(uTargetTex, uv).xyz * uMarkScale;
  /* a whisper of thickness so it reads as an object, not a decal */
  t += (rnd - 0.5) * 0.06;
  return A_MARK + t;
}

/* ── 1 · nebula ─────────────────────────────────────────────── */
vec3 fNebula(vec3 rnd, float t){
  /* a spiral disc, not a shell — a filled sphere of 262k points just reads
     as a grey ball, whereas arms give the eye something to travel along */
  float r  = 3.5 + pow(rnd.x, 0.75) * 17.0;
  float arm = floor(rnd.y * 3.0);
  float th = fract(rnd.y * 3.0) * 2.4 + arm * 2.0944 + r * 0.20 + t * 0.02;
  float thick = 0.35 + r * 0.16;
  vec3 p = vec3(cos(th) * r, (rnd.z - 0.5) * thick, sin(th) * r * 0.88);
  /* a loose halo so the disc is not a hard cut-out */
  float halo = step(0.88, hash11(rnd.z * 71.0));
  vec3 h = normalize(rnd - 0.5 + 1e-4) * (6.0 + rnd.x * 16.0);
  return A_NEBULA + mix(p, h, halo);
}

/* ── 2 · neural graph ───────────────────────────────────────── */
vec3 fGraph(vec3 rnd, float t){
  float N  = 26.0;
  float ia = floor(rnd.x * N);
  float ib = mod(ia + 1.0 + floor(hash11(ia * 4.4) * 5.0), N);
  vec3 A = nodePos(ia, t);
  vec3 B = nodePos(ib, t);

  float onEdge = step(0.30, rnd.z);   /* 70% travel the links */
  /* travelling packets: bunch particles into moving groups along each edge */
  float k = fract(rnd.y * 9.0 + t * 0.18 * (0.4 + hash11(ia) * 0.8));
  /* spread across the link's cross-section — a zero-width line of 150k
     points is a solid white beam, not a data stream */
  vec3 edge = mix(A, B, k) + (rnd - 0.5) * 0.55;
  vec3 node = A + normalize(rnd - 0.5 + 1e-4) * pow(hash11(rnd.y * 91.0), 0.4) * 1.05;
  return A_GRAPH + mix(node, edge, onEdge);
}

/* ── 3 · reactor core ───────────────────────────────────────── */
vec3 fCore(vec3 rnd, float t){
  float th = rnd.y * 6.28318;
  float ph = acos(clamp(rnd.z * 2.0 - 1.0, -1.0, 1.0));
  vec3 dir = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
  float r  = 2.35 * pow(rnd.x, 0.24);
  float turb = snoise(dir * 2.3 + vec3(0.0, 0.0, t * 0.5)) * 0.5;
  float pulse = sin(t * 1.1 - r * 1.4) * 0.16;
  return A_CORE + dir * (r + (turb + pulse) * (0.35 + uPower * 1.25));
}

/* ── 4 · data stream ────────────────────────────────────────── */
vec3 fStream(vec3 rnd, float t){
  float P = 5.0;
  float pi = floor(rnd.x * P);
  vec3 c = panelCenter(pi);

  vec2 g = vec2(fract(rnd.x * P), rnd.y) - 0.5;
  vec3 p = vec3(g.x * 5.4, g.y * 3.2, 0.0);

  /* quantise into bars, then let each bar scroll upward like a readout */
  float bar = floor((g.x + 0.5) * 12.0);
  float h = 0.35 + 0.65 * hash11(bar + pi * 17.0 + floor(t * 0.5));
  p.y = (fract(rnd.y * 31.0 + t * 0.22) - 0.5) * 3.2 * h;
  p.z += sin(bar * 1.3 + t) * 0.06;

  p = rotY(p, sin(pi * 2.1) * 0.7);
  p = rotX(p, cos(pi * 1.7) * 0.16);
  return A_STREAM + c + p;
}

/* ── 5 · bioluminescent garden ──────────────────────────────── */
vec3 fGarden(vec3 rnd, float t){
  float B = 9.0;
  float bi = floor(rnd.x * B);
  vec3 c = bloomCenter(bi);

  float s = fract(rnd.x * B);          /* 0 = base of stem, 1 = cap rim */
  float a = rnd.y * 6.28318;
  float capT = smoothstep(0.55, 1.0, s);
  float stemR = 0.055 + 0.03 * sin(s * 9.0);
  float capR  = capT * (0.7 + hash11(bi * 3.3) * 1.15);
  float rr = mix(stemR, capR, capT) * (0.55 + rnd.z * 0.7);

  float h = s * (1.9 + hash11(bi * 6.1) * 1.6);
  h -= pow(max(s - 0.55, 0.0), 2.0) * 1.5;      /* cap domes over */

  vec3 p = vec3(cos(a) * rr, h, sin(a) * rr);
  p.xz += vec2(sin(t * 0.32 + bi * 1.7), cos(t * 0.26 + bi * 2.3)) * 0.16 * s;

  /* a tenth of the field drifts free as spores */
  float spore = step(0.93, hash11(rnd.y * 57.0 + bi));
  vec3 free = vec3(cos(a) * (2.0 + rnd.z * 6.0), 0.4 + rnd.z * 4.5, sin(a) * (2.0 + rnd.z * 5.0));
  return A_GARDEN + mix(c + p, free, spore);
}

vec3 formation(float id, vec2 uv, vec3 rnd, float t){
  vec3 r = fGarden(rnd, t);
  if (id < 0.5)      r = fMark(uv, rnd);
  else if (id < 1.5) r = fNebula(rnd, t);
  else if (id < 2.5) r = fGraph(rnd, t);
  else if (id < 3.5) r = fCore(rnd, t);
  else if (id < 4.5) r = fStream(rnd, t);
  return r;
}
`;

const SHARED_UNIFORM_DECL = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D uTargetTex;
uniform float uTime;
uniform float uDt;
uniform float uFormA;
uniform float uFormB;
uniform float uMix;
uniform float uMarkScale;
uniform vec3  uMarkAnchor;
uniform float uPower;
uniform vec3  uMouse;
uniform float uRepel;
uniform float uStiff;
uniform float uTurb;
uniform float uDamp;
uniform float uBurst;
varying vec2 vUv;
`;

const VEL_FRAG = /* glsl */ `
precision highp float;
${SHARED_UNIFORM_DECL}
${NOISE}
${UTILS}
${CURL}
${FORMATIONS}

void main(){
  vec4 P = texture2D(tPos, vUv);
  vec4 V = texture2D(tVel, vUv);
  vec3 pos = P.xyz;
  vec3 vel = V.xyz;

  vec3 rnd = vec3(hash11(P.w * 1.13), hash11(P.w * 2.77 + 4.0), hash11(P.w * 5.19 + 9.0));

  vec3 tA = formation(uFormA, vUv, rnd, uTime);
  vec3 tB = formation(uFormB, vUv, rnd, uTime);
  vec3 target = mix(tA, tB, smoothstep(0.0, 1.0, uMix));

  /* spring — softened per particle so the formation lands unevenly, alive */
  float k = uStiff * (0.55 + rnd.x * 0.9);
  vel += (target - pos) * k * uDt;

  /* curl flow — the swirl that keeps it from ever looking like a mesh */
  vec3 flow = curlNoise(pos * 0.055 + vec3(0.0, 0.0, uTime * 0.03));
  vel += flow * uTurb * (0.5 + rnd.y) * uDt;

  /* cursor shockwave, in world space */
  vec3 d = pos - uMouse;
  float dl = length(d) + 1e-4;
  vel += (d / dl) * exp(-dl * dl * 0.16) * uRepel * uDt;

  /* console-triggered detonation */
  vel += normalize(pos - vec3(0.0, 0.0, pos.z) + 1e-4) * uBurst * (0.4 + rnd.z) * uDt;

  vel *= uDamp;

  /* nothing may outrun the scene — a stray burst must not empty the frame */
  float sp = length(vel);
  if (sp > 34.0) vel *= 34.0 / sp;

  gl_FragColor = vec4(vel, sp);
}
`;

const POS_FRAG = /* glsl */ `
precision highp float;
${SHARED_UNIFORM_DECL}
${NOISE}
${UTILS}

void main(){
  vec4 P = texture2D(tPos, vUv);
  vec4 V = texture2D(tVel, vUv);
  vec3 pos = P.xyz + V.xyz * uDt;
  /* .w is the immutable per-particle seed — carry it forward untouched */
  gl_FragColor = vec4(pos, P.w);
}
`;

const RENDER_VERT = /* glsl */ `
precision highp float;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uSize;
uniform float uTime;
uniform float uPixelRatio;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;
uniform vec3  uColHot;
uniform float uOpacity;
uniform float uFade;

attribute vec2 aRef;
attribute float aSeed;

varying vec3 vColor;
varying float vAlpha;

${UTILS}

void main(){
  vec4 P = texture2D(tPos, aRef);
  vec4 V = texture2D(tVel, aRef);
  vec3 pos = P.xyz;
  float speed = V.w;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float dist = -mv.z;

  /* Hue is mostly *spatial*: a per-particle random hue averages to white once
     a few hundred points stack up, which erases the brand palette exactly
     where the field is densest. A slow gradient across the world keeps the
     teal → blue → violet run readable at any density. */
  float grad = clamp(0.5 + pos.x * 0.055 + pos.y * 0.045 + sin(uTime * 0.06) * 0.08, 0.0, 1.0);
  float h = mix(grad, fract(aSeed * 0.61803 + uTime * 0.012), 0.34);
  vec3 base = mix(uColA, uColB, smoothstep(0.0, 0.55, h));
  base = mix(base, uColC, smoothstep(0.55, 1.0, h));

  float heat = smoothstep(0.15, 1.6, speed);
  vColor = mix(base, uColHot, heat * 0.42);

  /* Points stay small and sharp on purpose. A large sprite multiplied by a
     quarter-million instances is pure overdraw: the field turns to milk and
     every formation reads as fog. Small points + more alpha each = filaments. */
  float size = uSize * (0.55 + hash11(aSeed * 13.7) * 0.95) * (1.0 + heat * 0.7);
  gl_PointSize = clamp(size * uPixelRatio * (95.0 / max(dist, 0.8)), 0.6, 11.0);

  /* fog out the deep field so the corridor has depth */
  float depthFade = 1.0 - smoothstep(28.0, 78.0, dist);
  float nearFade  = smoothstep(0.35, 2.4, dist);
  /* one particle is a whisper; the image is built from a quarter-million of them */
  vAlpha = uOpacity * depthFade * nearFade * uFade * (0.055 + heat * 0.05);

  gl_Position = projectionMatrix * mv;
}
`;

const RENDER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;

void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;          /* squared, normalised to edge */
  if (d > 1.0) discard;

  float core = pow(1.0 - d, 2.6);      /* tight bright centre */
  float halo = pow(1.0 - d, 0.8) * 0.14; /* soft additive bloom feed */
  float a = (core + halo) * vAlpha;

  gl_FragColor = vec4(vColor * (0.7 + core * 1.1), a);
}
`;

export class ParticleField {
  constructor(renderer, { size = 512, markScale = 3.0 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.count = size * size;
    this.markScale = markScale;

    this.gpgpu = new GPGPU(renderer, size);

    /* ── mark target texture: the logo, sampled into one texel per particle ── */
    const pts = new Float32Array(this.count * 3);
    sampleMark(this.count, pts, { scale: 1, jitter: 0.02, depth: 1 });
    const targetData = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      targetData[i * 4 + 0] = pts[i * 3 + 0];
      targetData[i * 4 + 1] = pts[i * 3 + 1];
      targetData[i * 4 + 2] = pts[i * 3 + 2];
      targetData[i * 4 + 3] = 1;
    }
    this.targetTex = new THREE.DataTexture(targetData, size, size, THREE.RGBAFormat, THREE.FloatType);
    this.targetTex.needsUpdate = true;
    this.targetTex.minFilter = this.targetTex.magFilter = THREE.NearestFilter;

    /* ── seeds: born scattered far out, so load = a gathering ── */
    const posSeed = new Float32Array(this.count * 4);
    const velSeed = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      const r = 7 + Math.random() * 17;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      posSeed[i * 4 + 0] = Math.sin(ph) * Math.cos(th) * r;
      posSeed[i * 4 + 1] = Math.cos(ph) * r * 0.7;
      posSeed[i * 4 + 2] = Math.sin(ph) * Math.sin(th) * r * 0.6 + 4;
      posSeed[i * 4 + 3] = i * 0.0001 + Math.random() * 0.0001; // immutable seed
    }

    this.uniforms = {
      tPos:       { value: null },
      tVel:       { value: null },
      uTargetTex: { value: this.targetTex },
      uTime:      { value: 0 },
      uDt:        { value: 0.016 },
      uFormA:     { value: 0 },
      uFormB:     { value: 0 },
      uMix:       { value: 0 },
      uMarkScale: { value: markScale },
      uMarkAnchor: { value: ANCHORS.MARK.clone() },
      uPower:     { value: 0.55 },
      uMouse:     { value: new THREE.Vector3(999, 999, 999) },
      uRepel:     { value: 0 },
      uStiff:     { value: 22.0 },
      uTurb:      { value: 0.05 },
      uDamp:      { value: 0.86 },
      uBurst:     { value: 0 },
    };

    // both sim passes share one uniform object — one place to set state
    this.gpgpu.addVariable('vel', VEL_FRAG, this.uniforms, velSeed);
    this.gpgpu.addVariable('pos', POS_FRAG, this.uniforms, posSeed);

    /* ── render side ── */
    const geo = new THREE.BufferGeometry();
    const refs = new Float32Array(this.count * 2);
    const seeds = new Float32Array(this.count);
    const dummy = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      refs[i * 2 + 0] = ((i % size) + 0.5) / size;
      refs[i * 2 + 1] = (Math.floor(i / size) + 0.5) / size;
      seeds[i] = i;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
    geo.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -50), 400);

    this.renderUniforms = {
      tPos:        { value: null },
      tVel:        { value: null },
      uSize:       { value: 1.5 },
      uTime:       { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColA:       { value: new THREE.Color(0x0af5c8) },
      uColB:       { value: new THREE.Color(0x1a6cff) },
      uColC:       { value: new THREE.Color(0x8b5cf6) },
      uColHot:     { value: new THREE.Color(0xe8f4f8) },
      uOpacity:    { value: 1 },
      uFade:       { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.renderUniforms,
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  setPalette({ a, b, c, hot }) {
    if (a) this.renderUniforms.uColA.value.set(a);
    if (b) this.renderUniforms.uColB.value.set(b);
    if (c) this.renderUniforms.uColC.value.set(c);
    if (hot) this.renderUniforms.uColHot.value.set(hot);
  }

  /**
   * Formation blend driven by the scroll timeline.
   * `f` is a continuous position through the formation list (0..5).
   */
  setFormation(f) {
    const a = Math.floor(f);
    const b = Math.min(a + 1, 5);
    this.uniforms.uFormA.value = a;
    this.uniforms.uFormB.value = b;
    this.uniforms.uMix.value = f - a;
  }

  update(dt, time) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDt.value = dt;

    u.tPos.value = this.gpgpu.read('pos');
    u.tVel.value = this.gpgpu.read('vel');
    this.gpgpu.compute('vel');

    u.tVel.value = this.gpgpu.read('vel');
    this.gpgpu.compute('pos');

    this.renderUniforms.tPos.value = this.gpgpu.read('pos');
    this.renderUniforms.tVel.value = this.gpgpu.read('vel');
    this.renderUniforms.uTime.value = time;

    // burst decays on its own
    if (u.uBurst.value > 0.001) u.uBurst.value *= 0.9;
    else u.uBurst.value = 0;
  }

  burst(force = 26) { this.uniforms.uBurst.value = force; }

  dispose() {
    this.gpgpu.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
    this.targetTex.dispose();
  }
}

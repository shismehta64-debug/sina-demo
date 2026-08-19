import * as THREE from 'three';
import { NOISE, UTILS } from '../shaders/lib.js';
import { ANCHORS } from './particles.js';

/**
 * panels.js — the holographic telemetry slabs around the API section.
 *
 * Five thin glass panels tilted through space, each rendering a different
 * readout entirely in the fragment shader: bar histograms, a sweeping radar
 * ring, a token-stream matrix, a waveform, a loading spinner. No textures, no
 * DOM, no canvas — the "UI" on these screens is maths.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uKind;      /* 0 bars · 1 radar · 2 matrix · 3 wave · 4 spinner */
uniform vec3  uTint;
uniform vec3  uAccent;
uniform float uOpacity;
uniform float uSeed;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;

${NOISE}
${UTILS}

float bars(vec2 uv, float t){
  float n = 14.0;
  float i = floor(uv.x * n);
  float gap = smoothstep(0.06, 0.12, fract(uv.x * n)) * smoothstep(0.06, 0.12, 1.0 - fract(uv.x * n));
  float h = 0.12 + 0.8 * (0.5 + 0.5 * sin(t * 1.4 + i * 0.9 + uSeed * 6.0));
  float fill = step(uv.y, h) * gap;
  float cap = smoothstep(0.02, 0.0, abs(uv.y - h)) * gap;
  return fill * 0.35 + cap * 1.4;
}

float radar(vec2 uv, float t){
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float sweepA = mod(t * 1.3, 6.28318) - 3.14159;
  float d = abs(mod(a - sweepA + 9.42477, 6.28318) - 3.14159);
  float sweep = exp(-d * 2.6) * smoothstep(1.0, 0.1, r);
  float rings = smoothstep(0.012, 0.0, abs(fract(r * 4.0) - 0.5) * 0.5) * smoothstep(1.0, 0.2, r) * 0.5;
  float blips = 0.0;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    vec2 bp = vec2(cos(fi * 2.1 + uSeed) * (0.25 + fi * 0.16), sin(fi * 1.7 + uSeed) * (0.3 + fi * 0.12));
    blips += exp(-length(p - bp) * 34.0) * (0.6 + 0.4 * sin(t * 4.0 + fi));
  }
  return sweep * 0.9 + rings + blips * 1.6;
}

float matrix(vec2 uv, float t){
  float cols = 22.0;
  float i = floor(uv.x * cols);
  float speed = 0.35 + hash11(i + uSeed) * 0.9;
  float y = fract(uv.y + t * speed + hash11(i * 3.7));
  float glyph = step(0.5, hash11(floor(uv.y * 30.0) + i * 17.0 + floor(t * 6.0)));
  float head = exp(-y * 9.0);
  float trail = exp(-y * 2.2) * 0.3;
  return glyph * (head * 1.8 + trail);
}

float wave(vec2 uv, float t){
  float y = 0.5;
  y += sin(uv.x * 12.0 + t * 2.2) * 0.13;
  y += sin(uv.x * 27.0 - t * 3.1) * 0.06;
  y += snoise(vec3(uv.x * 6.0, t * 0.8, uSeed)) * 0.09;
  float line = smoothstep(0.016, 0.0, abs(uv.y - y));
  float fill = step(uv.y, y) * step(0.5, uv.y) * 0.12;
  return line * 1.6 + fill;
}

float spinner(vec2 uv, float t){
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.28318 + 0.5;
  float ring = smoothstep(0.05, 0.0, abs(r - 0.55));
  float arc = smoothstep(0.0, 0.35, fract(a - t * 0.4));
  float inner = smoothstep(0.03, 0.0, abs(r - 0.3)) * smoothstep(0.0, 0.5, fract(a + t * 0.7));
  float pct = step(uv.y, 0.06) * step(fract(uv.x * 18.0), 0.5) * 0.4;
  return ring * arc * 1.5 + inner * 1.1 + pct;
}

void main(){
  vec2 uv = vUv;

  /* chrome: frame, corner brackets, header rule */
  vec2 b = min(uv, 1.0 - uv);
  float frame = smoothstep(0.006, 0.0, min(b.x, b.y));
  float corner = 0.0;
  vec2 cq = min(uv, 1.0 - uv);
  corner += step(cq.x, 0.06) * step(cq.y, 0.006) + step(cq.y, 0.06) * step(cq.x, 0.006);
  float header = smoothstep(0.004, 0.0, abs(uv.y - 0.88));

  /* readout region */
  vec2 ruv = (uv - vec2(0.08, 0.10)) / vec2(0.84, 0.72);
  float inside = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);

  float v = 0.0;
  if (uKind < 0.5)      v = bars(ruv, uTime);
  else if (uKind < 1.5) v = radar(ruv, uTime);
  else if (uKind < 2.5) v = matrix(ruv, uTime);
  else if (uKind < 3.5) v = wave(ruv, uTime);
  else                  v = spinner(ruv, uTime);
  v *= inside;

  /* glass body + fresnel edge */
  float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 2.2);

  /* scan sweep across the whole panel */
  float scan = exp(-pow(fract(uTime * 0.22 + uSeed) - uv.y, 2.0) * 220.0) * 0.5;
  float lines = 0.5 + 0.5 * sin(uv.y * 420.0);

  vec3 col = vec3(0.0);
  col += uTint * v * (0.85 + lines * 0.25);
  col += uAccent * (frame * 0.7 + corner * 1.6 + header * 0.8);
  col += uTint * fres * 0.4;
  col += uTint * scan;
  col += uTint * 0.035;                 /* faint body tint so it reads as glass */

  float a = clamp(v * 0.8 + frame * 0.7 + corner + header * 0.6 + fres * 0.35 + 0.045, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export class HoloPanels {
  constructor({ quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(ANCHORS.STREAM);
    this.panels = [];

    const specs = [
      { kind: 0, w: 5.2, h: 3.2, pos: [-7.6,  1.4,  1.2], rot: [0.05,  0.62, -0.04] },
      { kind: 1, w: 3.4, h: 3.4, pos: [-3.4, -2.3,  3.4], rot: [-0.10, 0.34,  0.07] },
      { kind: 2, w: 4.0, h: 4.6, pos: [ 6.9,  0.4, -0.6], rot: [0.03, -0.58,  0.03] },
      { kind: 3, w: 5.8, h: 2.4, pos: [ 2.6,  3.3,  2.0], rot: [-0.16, -0.24, -0.02] },
      { kind: 4, w: 3.0, h: 3.0, pos: [ 0.4, -3.4, -2.2], rot: [0.12,  0.10,  0.05] },
    ];

    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const u = {
        uTime:    { value: 0 },
        uKind:    { value: s.kind },
        uTint:    { value: new THREE.Color([0x0af5c8, 0x23c9d9, 0x1a6cff, 0x0af5c8, 0x8b5cf6][i]) },
        uAccent:  { value: new THREE.Color(0x0af5c8) },
        uOpacity: { value: 1 },
        uSeed:    { value: i * 1.37 },
      };
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(s.w, s.h, 1, 1),
        new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, uniforms: u,
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.set(...s.pos);
      mesh.rotation.set(...s.rot);
      this.group.add(mesh);
      this.panels.push({ mesh, u, base: mesh.position.clone(), phase: i * 1.9 });
    }

    /* a slow wireframe armature tying the panels together */
    if (quality !== 'low') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(9.5, 0.012, 4, 128),
        new THREE.MeshBasicMaterial({
          color: 0x0af5c8, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2.3;
      this.group.add(ring);
      this.ring = ring;
    }

    this.setVisible(false);
  }

  setVisible(v) { this.group.visible = v; }

  setOpacity(o) {
    this.panels.forEach((p) => { p.u.uOpacity.value = o; });
    if (this.ring) this.ring.material.opacity = 0.16 * o;
  }

  update(dt, t) {
    if (!this.group.visible) return;
    this.panels.forEach((p) => {
      p.u.uTime.value = t;
      p.mesh.position.y = p.base.y + Math.sin(t * 0.42 + p.phase) * 0.28;
      p.mesh.position.x = p.base.x + Math.cos(t * 0.31 + p.phase) * 0.16;
      p.mesh.rotation.z = Math.sin(t * 0.25 + p.phase) * 0.03;
    });
    if (this.ring) this.ring.rotation.z = t * 0.06;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

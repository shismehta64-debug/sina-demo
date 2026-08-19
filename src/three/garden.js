import * as THREE from 'three';
import { NOISE, UTILS } from '../shaders/lib.js';
import { ANCHORS } from './particles.js';
import { glowTexture } from './mark.js';

/**
 * garden.js — where the journey lands.
 *
 * The blooms themselves are the particle field in its GARDEN formation. This
 * module supplies the room around them: shafts of light coming down through
 * water, a low bank of fog, and drifting spores. After nine sectors of
 * machinery it should feel like surfacing.
 */

const SHAFT_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uTint;
uniform float uOpacity;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vWorld;

${NOISE}

void main(){
  /* uv.y runs down the cone: bright at the source, gone at the floor */
  float fade = pow(1.0 - vUv.y, 1.8);
  float edge = sin(vUv.x * 3.14159);            /* soft cylindrical falloff */
  float dust = 0.55 + 0.45 * fbm(vec3(vUv * vec2(5.0, 2.2), uTime * 0.16 + uSeed));
  float flick = 0.85 + 0.15 * sin(uTime * 0.7 + uSeed * 4.0);

  float a = fade * edge * dust * flick * uOpacity * 0.11;
  gl_FragColor = vec4(uTint * (0.45 + dust * 0.4), a);
}
`;

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FOG_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uTint;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE}
void main(){
  float n = fbm(vec3(vWorld.xz * 0.09, uTime * 0.06));
  float band = smoothstep(0.0, 0.55, n) * smoothstep(1.0, 0.25, length(vUv - 0.5) * 2.0);
  gl_FragColor = vec4(uTint * (0.3 + n * 0.35), band * 0.09 * uOpacity);
}
`;

export class Garden {
  constructor({ quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(ANCHORS.GARDEN);
    this.shafts = [];
    this.uniforms = [];

    /* ── light shafts ─────────────────────────────────────────── */
    const count = quality === 'low' ? 3 : 7;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.7;
      const r = 3.0 + (i % 3) * 3.4;
      const u = {
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(i % 3 === 0 ? 0x0af5c8 : i % 3 === 1 ? 0x23c9d9 : 0x4a97d6) },
        uOpacity: { value: 1 },
        uSeed: { value: i * 2.3 },
      };
      const h = 16 + (i % 4) * 4;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35 + i * 0.12, 2.2 + i * 0.5, h, 16, 6, true),
        new THREE.ShaderMaterial({
          vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, uniforms: u,
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.set(Math.cos(a) * r, h / 2 - 2.2, Math.sin(a) * r * 0.8);
      mesh.rotation.z = Math.cos(a) * 0.1;
      mesh.rotation.x = Math.sin(a) * 0.08;
      this.group.add(mesh);
      this.shafts.push({ mesh, u, phase: i });
      this.uniforms.push(u);
    }

    /* ── ground fog bank ──────────────────────────────────────── */
    const fogU = { uTime: { value: 0 }, uTint: { value: new THREE.Color(0x0a6f8a) }, uOpacity: { value: 1 } };
    this.fog = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80, 1, 1),
      new THREE.ShaderMaterial({
        vertexShader: SHAFT_VERT, fragmentShader: FOG_FRAG, uniforms: fogU,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.fog.rotation.x = -Math.PI / 2;
    this.fog.position.y = -1.4;
    this.group.add(this.fog);
    this.uniforms.push(fogU);

    /* ── spores ───────────────────────────────────────────────── */
    const tex = glowTexture(64, 'rgba(255,255,255,1)', 'rgba(120,255,235,0.4)');
    this.spores = [];
    const sporeCount = quality === 'low' ? 14 : 40;
    for (let i = 0; i < sporeCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: [0x0af5c8, 0x8b5cf6, 0x23c9d9][i % 3],
        transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const sc = 0.12 + Math.random() * 0.4;
      s.scale.set(sc, sc, 1);
      s.position.set((Math.random() - 0.5) * 26, Math.random() * 9 - 1, (Math.random() - 0.5) * 20);
      s.userData = { phase: Math.random() * 9, speed: 0.1 + Math.random() * 0.3, base: s.position.clone() };
      this.group.add(s);
      this.spores.push(s);
    }

    /* ── soft key light so the blooms have a direction ────────── */
    this.key = new THREE.PointLight(0x0af5c8, 34, 40, 1.8);
    this.key.position.set(0, 6, 2);
    this.group.add(this.key);

    this.setVisible(false);
  }

  setVisible(v) { this.group.visible = v; }

  setOpacity(o) {
    this.uniforms.forEach((u) => { u.uOpacity.value = o; });
    this.spores.forEach((s) => { s.material.opacity = 0.28 * o; });
    this.key.intensity = 34 * o;
  }

  update(dt, t) {
    if (!this.group.visible) return;
    this.uniforms.forEach((u) => { u.uTime.value = t; });
    this.shafts.forEach((s) => { s.mesh.rotation.y = t * 0.05 + s.phase; });
    this.spores.forEach((s) => {
      const d = s.userData;
      s.position.y = d.base.y + Math.sin(t * d.speed + d.phase) * 1.4;
      s.position.x = d.base.x + Math.cos(t * d.speed * 0.7 + d.phase) * 0.9;
    });
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

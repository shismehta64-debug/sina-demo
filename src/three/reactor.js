import * as THREE from 'three';
import { NOISE, UTILS, HEX } from '../shaders/lib.js';
import { ANCHORS } from './particles.js';
import { glowTexture } from './mark.js';

/**
 * reactor.js — the containment rig at the middle of the journey.
 *
 * The glowing sphere inside is *not* built here: it is the main particle field
 * in its CORE formation. This module builds everything around it — gimbal
 * rings, a hex containment shell, drooping power cables, a scanning ring, and
 * a wet floor that catches the light. Output is driven by `power`, which the
 * visitor can actually turn up with the slider in the HUD panel.
 */

const SHELL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPower;
uniform float uFade;
uniform vec3  uTint;
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;

${UTILS}
${HEX}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

  /* hex containment lattice mapped over the sphere */
  vec4 h = hexCell(vUv * vec2(38.0, 19.0));
  float cell = smoothstep(0.018, 0.0, h.z);          /* the seams, kept hairline */
  float flicker = 0.6 + 0.4 * sin(uTime * 3.0 + h.w * 12.0);

  float energy = cell * flicker * (0.25 + uPower * 0.9);
  vec3 col = uTint * (energy * 0.55 + fres * 0.45);
  col += iridescence(fres + uTime * 0.05) * fres * 0.3;

  /* this sphere sits a few metres from the lens — it reads as an area light
     long before it reads as a shell, so its alpha stays deliberately low */
  float a = clamp(energy * 0.14 + fres * 0.16, 0.0, 1.0) * uFade;
  gl_FragColor = vec4(col, a);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FLOOR_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPower;
uniform vec3  uTint;
uniform float uFade;
uniform vec3  uCore;      /* world position of the reactor core */
varying vec3 vWorld;

${NOISE}
${UTILS}

void main(){
  vec2 p = vWorld.xz - uCore.xz;
  float d = length(p);

  /* fake wet reflection: the core smeared vertically into the floor, rippled */
  float ripple = fbm(vec3(p * 0.22, uTime * 0.16)) * 0.5 + 0.5;
  float pool = exp(-d * 0.10) * (0.55 + ripple * 0.85);
  pool *= 0.4 + uPower * 1.3;

  /* expanding shockwave rings, emitted on the core's pulse */
  float wave = 0.0;
  for (int i = 0; i < 3; i++){
    float ph = fract(uTime * 0.16 - float(i) * 0.333);
    float r = ph * 34.0;
    wave += exp(-pow((d - r) * 0.55, 2.0)) * (1.0 - ph) * 0.5;
  }

  /* survey grid, fading with distance */
  vec2 g = abs(fract(vWorld.xz * 0.25) - 0.5);
  float grid = smoothstep(0.48, 0.5, max(g.x, g.y)) * exp(-d * 0.045) * 0.16;

  float horizon = exp(-d * 0.028);
  vec3 col = uTint * (pool * 0.16 + wave * 0.22) + vec3(0.35, 0.8, 0.95) * grid * 0.5;
  col += uTint * 0.012 * horizon;

  float a = clamp(pool * 0.22 + wave * 0.18 + grid * 0.5 + horizon * 0.03, 0.0, 1.0);
  gl_FragColor = vec4(col, a * 0.75 * uFade);
}
`;

const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CABLE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPower;
uniform vec3  uTint;
uniform float uSeed;
uniform float uFade;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
${UTILS}
void main(){
  vec3 N = normalize(vNormal);
  float fres = pow(1.0 - clamp(dot(N, normalize(vView)), 0.0, 1.0), 2.0);
  /* charge running down the cable toward the floor */
  float t = fract(vUv.x * 1.0 - uTime * 0.5 + uSeed);
  float charge = exp(-pow((t - 0.5) * 7.0, 2.0)) * uPower;
  vec3 col = vec3(0.03, 0.07, 0.09) + uTint * (charge * 1.6 + fres * 0.25);
  gl_FragColor = vec4(col, (0.45 + fres * 0.4 + charge * 0.35) * uFade);
}
`;

const CABLE_VERT = /* glsl */ `
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

export class Reactor {
  constructor({ quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(ANCHORS.CORE);
    this.power = 0.55;
    this.uniforms = [];

    const teal = new THREE.Color(0x0af5c8);
    const seg = quality === 'low' ? 48 : 128;

    /* ── gimbal rings ─────────────────────────────────────────── */
    const metal = new THREE.MeshStandardMaterial({
      color: 0x0d1b24, roughness: 0.32, metalness: 0.94,
      emissive: new THREE.Color(0x031014), emissiveIntensity: 1,
    });

    this.gimbals = [];
    const ringSpecs = [
      { r: 4.2, t: 0.13, rx: Math.PI / 2, ry: 0,           spin: [0, 0.10, 0] },
      { r: 4.9, t: 0.10, rx: 0,           ry: 0,           spin: [0.07, 0, 0] },
      { r: 5.6, t: 0.08, rx: Math.PI / 3, ry: Math.PI / 5, spin: [0.03, 0.05, 0.02] },
    ];
    for (const s of ringSpecs) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(s.r, s.t, 12, seg), metal);
      m.rotation.set(s.rx, s.ry, 0);
      this.group.add(m);
      this.gimbals.push({ mesh: m, spin: s.spin });
    }

    /* struts joining the outer ring to the floor mounts */
    const strutMat = metal.clone();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = 6.4;
      const g = new THREE.CylinderGeometry(0.075, 0.14, h, 8);
      const m = new THREE.Mesh(g, strutMat);
      m.position.set(Math.cos(a) * 5.1, -h / 2 - 0.6, Math.sin(a) * 5.1);
      m.rotation.z = Math.cos(a) * 0.16;
      m.rotation.x = -Math.sin(a) * 0.16;
      this.group.add(m);
    }

    /* ── containment shell ────────────────────────────────────── */
    const shellU = {
      uTime: { value: 0 }, uPower: { value: 0.55 }, uTint: { value: teal.clone() },
      uFade: { value: 1 },
    };
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, uniforms: shellU,
        transparent: true, depthWrite: false, side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(this.shell);
    this.uniforms.push(shellU);
    this.shellU = shellU;

    /* ── cables ───────────────────────────────────────────────── */
    const cableCount = quality === 'low' ? 5 : 9;
    this.cables = [];
    for (let i = 0; i < cableCount; i++) {
      const a = (i / cableCount) * Math.PI * 2 + 0.3;
      const top = new THREE.Vector3(Math.cos(a) * 4.6, Math.sin(a * 2.1) * 2.2 + 1.0, Math.sin(a) * 4.6);
      const mid = new THREE.Vector3(Math.cos(a) * 7.4, -3.4 + Math.sin(a * 3.0) * 0.8, Math.sin(a) * 7.4);
      const end = new THREE.Vector3(Math.cos(a) * 9.6, -6.9, Math.sin(a) * 9.6);
      const curve = new THREE.CatmullRomCurve3([top, mid, end]);
      const u = {
        uTime: { value: 0 }, uPower: { value: 0.55 },
        uTint: { value: teal.clone() }, uSeed: { value: i * 0.17 },
        uFade: { value: 1 },
      };
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.055, 7, false),
        new THREE.ShaderMaterial({
          vertexShader: CABLE_VERT, fragmentShader: CABLE_FRAG, uniforms: u,
          transparent: true, depthWrite: false,
        }),
      );
      this.group.add(mesh);
      this.cables.push(mesh);
      this.uniforms.push(u);
    }

    /* ── scanning ring — sweeps the core, top to bottom ───────── */
    const scanU = { uTime: { value: 0 }, uPower: { value: 0.55 }, uTint: { value: teal.clone() } };
    this.scan = new THREE.Mesh(
      new THREE.TorusGeometry(3.9, 0.02, 6, 96),
      new THREE.MeshBasicMaterial({
        color: 0x0af5c8, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.scan.rotation.x = Math.PI / 2;
    this.group.add(this.scan);

    /* ── wet floor ────────────────────────────────────────────── */
    const floorU = {
      uTime: { value: 0 }, uPower: { value: 0.55 },
      uTint: { value: teal.clone() },
      uCore: { value: ANCHORS.CORE.clone() },
      uFade: { value: 1 },
    };
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220, 1, 1),
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, uniforms: floorU,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -7.0, 0);
    this.group.add(this.floor);
    this.uniforms.push(floorU);

    /* ── lights ───────────────────────────────────────────────── */
    this.keyA = new THREE.SpotLight(0x0af5c8, 260, 44, Math.PI / 7, 0.55, 1.4);
    this.keyA.position.set(-8, 13, 6);
    this.keyA.target.position.set(0, 0, 0);
    this.group.add(this.keyA, this.keyA.target);

    this.keyB = new THREE.SpotLight(0x1a6cff, 200, 46, Math.PI / 6, 0.6, 1.4);
    this.keyB.position.set(9, 11, -7);
    this.keyB.target.position.set(0, 0, 0);
    this.group.add(this.keyB, this.keyB.target);

    this.rim = new THREE.PointLight(0x8b5cf6, 90, 30, 1.6);
    this.rim.position.set(0, -2, 8);
    this.group.add(this.rim);

    this.fill = new THREE.AmbientLight(0x0a2230, 1.2);
    this.group.add(this.fill);

    /* ── volumetric haze ──────────────────────────────────────── */
    const haze = glowTexture(256, 'rgba(140,255,240,0.5)', 'rgba(20,110,255,0.16)');
    this.haze = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haze, color: 0x0af5c8, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const sc = 22 + i * 9;
      s.scale.set(sc, sc, 1);
      s.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, -2 - i * 2.5);
      this.group.add(s);
      this.haze.push(s);
    }

    this._fade = 1;
    this.setVisible(false);
  }

  setPower(p) {
    this.power = p;
    this.shellU.uPower.value = p;
    this.uniforms.forEach((u) => { if (u.uPower) u.uPower.value = p; });
    const f = this._fade ?? 1;
    this.keyA.intensity = (160 + p * 300) * f;
    this.keyB.intensity = (120 + p * 240) * f;
    this.rim.intensity = (50 + p * 160) * f;
  }

  setVisible(v) {
    if (this.group.visible === v) return;
    this.group.visible = v;
  }

  /** Fade the whole rig in and out rather than popping it on. */
  setFade(o) {
    this._fade = o;
    this.uniforms.forEach((u) => { if (u.uFade) u.uFade.value = o; });
    this.keyA.intensity = (160 + this.power * 300) * o;
    this.keyB.intensity = (120 + this.power * 240) * o;
    this.rim.intensity = (50 + this.power * 160) * o;
    this.fill.intensity = 1.2 * o;
    this.scan.material.opacity = (0.25 + this.power * 0.5) * o;
    this.haze.forEach((s) => { s.material.opacity *= o; });
  }

  update(dt, t) {
    if (!this.group.visible) return;
    this.gimbals.forEach((g) => {
      g.mesh.rotation.x += g.spin[0] * dt;
      g.mesh.rotation.y += g.spin[1] * dt;
      g.mesh.rotation.z += g.spin[2] * dt;
    });
    this.uniforms.forEach((u) => { if (u.uTime) u.uTime.value = t; });

    const sweep = (Math.sin(t * 0.55) * 0.5 + 0.5);
    this.scan.position.y = -3.4 + sweep * 6.8;
    const rr = Math.sqrt(Math.max(0.02, 1 - Math.pow((sweep - 0.5) * 2, 2))) * 3.9;
    this.scan.scale.setScalar(Math.max(0.06, rr / 3.9));
    this.scan.material.opacity = (0.25 + this.power * 0.5) * (this._fade ?? 1);

    this.haze.forEach((s, i) => {
      s.material.opacity = (0.028 + this.power * 0.05 + Math.sin(t * 0.6 + i) * 0.012) * (this._fade ?? 1);
      s.position.x += Math.sin(t * 0.2 + i) * dt * 0.3;
    });

    this.shell.rotation.y += dt * 0.06;
    this.shell.rotation.x = Math.sin(t * 0.2) * 0.12;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

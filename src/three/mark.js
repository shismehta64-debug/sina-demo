import * as THREE from 'three';
import { NODES, EDGES, edgeZ } from '../core/genome.js';
import { NOISE, UTILS } from '../shaders/lib.js';

/**
 * mark.js — the SINA logo as a physical object.
 *
 * Rings become tori, dots become spheres, the links become swept tubes, and
 * every piece is shaded as thin-film glass: dark in the body, iridescent at
 * grazing angles. The two links that actually touch the hub carry synaptic
 * pulses — packets of light that travel outward and fire the node they hit.
 */

const GLASS_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
varying vec3 vWorld;

void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GLASS_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uTint;
uniform vec3  uDeep;
uniform float uTime;
uniform float uGlow;
uniform float uFire;      /* 0..1 — this node just received a pulse */
uniform float uOpacity;

varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
varying vec3 vWorld;

${UTILS}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

  /* thin-film colour shifts with angle and a slow drift */
  vec3 irid = iridescence(fres * 0.8 + uTime * 0.035 + vWorld.y * 0.06);

  vec3 col = mix(uDeep, uTint, fres);
  col = mix(col, irid * uTint * 1.6, fres * 0.55);
  col += uTint * uGlow * 0.35;
  col += vec3(0.7, 1.0, 0.95) * uFire * 1.8;

  float a = (0.05 + fres * 0.55 + uFire * 0.35) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const TUBE_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uTint;
uniform vec3  uDeep;
uniform float uTime;
uniform float uPulse;     /* 0 = inert link, 1 = live link */
uniform float uSpeed;
uniform float uOpacity;
uniform float uOffset;

varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
varying vec3 vWorld;

${UTILS}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);

  vec3 col = mix(uDeep, uTint, fres * 0.9 + 0.1);

  /* travelling packet — a tight gaussian sliding along the tube's length */
  float t = fract(vUv.x - uTime * uSpeed + uOffset);
  float packet = exp(-pow((t - 0.5) * 9.0, 2.0));
  float trail  = exp(-pow((t - 0.42) * 3.2, 2.0)) * 0.35;
  float energy = (packet + trail) * uPulse;

  col += vec3(0.55, 1.0, 0.92) * energy * 2.4;
  col += iridescence(vUv.x * 0.5 + uTime * 0.04) * fres * 0.4;

  float a = (0.07 + fres * 0.45 + energy * 0.6) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

/** Soft radial sprite, generated — no texture files anywhere in this build. */
export function glowTexture(size = 128, inner = 'rgba(255,255,255,1)', mid = 'rgba(120,240,255,0.35)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, mid);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SinaMark {
  constructor({ scale = 3.0, tint = 0x0af5c8 } = {}) {
    this.group = new THREE.Group();
    this.scale = scale;
    this.nodes = [];
    this.tubes = [];
    this.time = 0;
    this._fire = new Map();

    const deep = new THREE.Color(0x03151f);

    /* ── nodes ───────────────────────────────────────────────── */
    for (const n of NODES) {
      const col = new THREE.Color(n.color);
      const uniforms = {
        uTint:    { value: col },
        uDeep:    { value: deep.clone() },
        uTime:    { value: 0 },
        uGlow:    { value: n.glow },
        uFire:    { value: 0 },
        uOpacity: { value: 1 },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });

      const geo = n.type === 'ring'
        ? new THREE.TorusGeometry(n.r * scale, n.r * scale * 0.3, 18, 72)
        : new THREE.SphereGeometry(n.r * scale * 1.05, 32, 24);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(n.x * scale, n.y * scale, n.z * scale);
      if (n.type === 'ring') mesh.rotation.z = Math.random() * Math.PI;
      this.group.add(mesh);

      /* every node gets a halo sprite so bloom has something to chew on */
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: SinaMark.sharedGlow ||= glowTexture(),
        color: col,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.18 * n.glow,
      }));
      const s = n.r * scale * (n.type === 'ring' ? 7.5 : 9.0);
      sprite.scale.set(s, s, 1);
      sprite.position.copy(mesh.position);
      this.group.add(sprite);

      this.nodes.push({ def: n, mesh, mat, sprite, uniforms });
    }

    /* ── links ───────────────────────────────────────────────── */
    EDGES.forEach((e, i) => {
      const pts = e.pts.map((p, k) => new THREE.Vector3(
        p[0] * scale,
        p[1] * scale,
        edgeZ(e, k / Math.max(e.pts.length - 1, 1)) * scale,
      ));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
      const geo = new THREE.TubeGeometry(curve, 64, 0.028 * scale, 10, false);

      const uniforms = {
        uTint:    { value: new THREE.Color(e.live ? 0x0af5c8 : 0x1a6cff) },
        uDeep:    { value: deep.clone() },
        uTime:    { value: 0 },
        uPulse:   { value: e.live ? 1 : 0.22 },
        uSpeed:   { value: e.live ? 0.34 : 0.11 },
        uOffset:  { value: i * 0.27 },
        uOpacity: { value: 1 },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: TUBE_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.group.add(mesh);
      this.tubes.push({ def: e, mesh, mat, uniforms });
    });

    /* ── hub core flare ──────────────────────────────────────── */
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SinaMark.sharedGlow,
      color: new THREE.Color(0x8fe9ff),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.30,
    }));
    this.core.scale.set(scale * 1.5, scale * 1.5, 1);
    this.group.add(this.core);
  }

  /** Fire a pulse into a node — used when a packet arrives, and on demand. */
  strike(id, amount = 1) {
    this._fire.set(id, Math.max(this._fire.get(id) || 0, amount));
  }

  setOpacity(o) {
    this.nodes.forEach((n) => {
      n.uniforms.uOpacity.value = o;
      n.sprite.material.opacity = 0.18 * n.def.glow * o;
    });
    this.tubes.forEach((t) => { t.uniforms.uOpacity.value = o; });
    this.core.material.opacity = 0.30 * o;
    this.group.visible = o > 0.005;
  }

  update(dt, t) {
    this.time = t;

    this.nodes.forEach((n, i) => {
      n.uniforms.uTime.value = t;

      // decay the fire, and let live links re-trigger their endpoint
      let f = (this._fire.get(n.def.id) || 0) * Math.pow(0.02, dt);
      if (f < 0.002) f = 0;
      this._fire.set(n.def.id, f);
      n.uniforms.uFire.value = f;

      // rings counter-rotate; the whole mark breathes
      if (n.def.type === 'ring') {
        n.mesh.rotation.y += dt * (0.12 + i * 0.035);
        n.mesh.rotation.x = Math.sin(t * 0.3 + i) * 0.22;
      }
      const breathe = 1 + Math.sin(t * 0.9 + i * 1.3) * 0.04;
      n.mesh.scale.setScalar(breathe);
      n.sprite.material.opacity = (0.18 * n.def.glow + f * 0.22) * (this.group.visible ? 1 : 0)
        * (0.85 + Math.sin(t * 1.4 + i) * 0.15);
    });

    this.tubes.forEach((tb) => {
      tb.uniforms.uTime.value = t;
      // when a packet reaches the far end of a live link, light that node up
      if (tb.def.live) {
        const phase = (t * tb.uniforms.uSpeed.value + tb.uniforms.uOffset.value) % 1;
        if (phase < dt * tb.uniforms.uSpeed.value * 2 + 0.02 && tb.def.to) {
          this.strike(tb.def.to, 1);
          this.strike('hub', 0.6);
        }
      }
    });

    this.core.material.opacity = 0.20 + Math.sin(t * 2.1) * 0.07;
    const cs = this.scale * (1.4 + Math.sin(t * 1.7) * 0.12);
    this.core.scale.set(cs, cs, 1);
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

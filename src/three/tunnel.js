import * as THREE from 'three';
import { NOISE, UTILS, HEX } from '../shaders/lib.js';
import { glowTexture } from './mark.js';

/**
 * tunnel.js — THE LAB.
 *
 * A hexagonal honeycomb barrel the camera flies straight down. The cells are
 * not geometry: the whole thing is one open cylinder shaded with a hex
 * distance field, which means 40,000 "cells" cost exactly one draw call and
 * each can breathe, shift hue and catch light independently.
 *
 * Three things sell the depth: per-cell extrusion faked with a bevel term,
 * an iridescent hue that rotates with view angle, and an energy wave that
 * travels the length of the barrel so the tunnel reads as *powered*.
 */

const TUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;

void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const TUNNEL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uDensity;
uniform vec3  uTeal;
uniform vec3  uBlue;
uniform vec3  uViolet;
uniform float uOpacity;
uniform float uEnergy;

varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vView;
varying float vDepth;

${NOISE}
${UTILS}
${HEX}

void main(){
  /* uv.x wraps the barrel, uv.y runs its length */
  vec2 p = vec2(vUv.x * uDensity, vUv.y * uDensity * 0.62);
  vec4 h = hexCell(p);

  float id = h.w;
  float rnd = fract(sin(id * 12.9898) * 43758.5453);

  /* each cell breathes on its own clock — the wave effect across the barrel */
  float breathe = 0.5 + 0.5 * sin(uTime * 1.6 + id * 0.35 + vUv.y * 9.0);

  /* energy pulse travelling down the tunnel */
  float wave = exp(-pow(fract(uTime * 0.12 - vUv.y * 0.8) - 0.5, 2.0) * 26.0);

  /* cell body vs seam: bevel gives each hex a lip that catches light */
  float seam  = smoothstep(0.02, 0.0, h.z);
  float bevel = smoothstep(0.02, 0.16, h.z);
  float body  = smoothstep(0.0, 0.09, h.z);

  float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 1.6);

  /* iridescent film: hue keyed on cell id, view angle and time */
  vec3 irid = iridescence(rnd * 0.8 + fres * 0.55 + uTime * 0.03 + vUv.y * 0.35);
  vec3 tone = mix(uBlue, uViolet, rnd);
  tone = mix(tone, uTeal, breathe * 0.55);
  tone = mix(tone, irid, 0.45);

  /* the far end of the barrel is a light source */
  float toEnd = smoothstep(0.0, 1.0, vUv.y);
  float mouth = pow(toEnd, 2.5);

  /* the cell faces stay near-black and the *seams* carry the light — a lit
     body turns the barrel into a lamp and the honeycomb disappears */
  vec3 col = vec3(0.0);
  col += tone * body * (0.035 + breathe * 0.05) * bevel;
  col += tone * seam * (0.16 + breathe * 0.26) * (0.5 + uEnergy);
  col += uTeal * wave * seam * 0.9 * uEnergy;
  col += vec3(0.55, 0.95, 1.0) * mouth * 0.13;
  col += tone * fres * 0.14;

  /* grime so it is not a perfect CG surface */
  col *= 0.75 + 0.45 * fbm(vec3(vWorld.xy * 0.35, uTime * 0.05));

  float a = clamp(body * 0.10 + seam * 0.55 + mouth * 0.22, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, a);
}
`;

export class HexTunnel {
  constructor({ z = -88, radius = 6.2, length = 30, density = 26, quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.group.position.set(0, 0, z);

    const seg = quality === 'low' ? 64 : 140;

    this.uniforms = {
      uTime:    { value: 0 },
      uDensity: { value: density },
      uTeal:    { value: new THREE.Color(0x0af5c8) },
      uBlue:    { value: new THREE.Color(0x1a6cff) },
      uViolet:  { value: new THREE.Color(0x8b5cf6) },
      uOpacity: { value: 1 },
      uEnergy:  { value: 1 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: TUNNEL_VERT,
      fragmentShader: TUNNEL_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const geo = new THREE.CylinderGeometry(radius, radius * 0.72, length, seg, 40, true);
    geo.rotateX(Math.PI / 2);              // barrel axis → world Z
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    /* a second, larger shell counter-rotating — parallax between layers */
    this.outer = new THREE.Mesh(geo.clone(), mat.clone());
    this.outer.material.uniforms = {
      ...this.uniforms,
      uDensity: { value: density * 0.55 },
      uOpacity: { value: 0.10 },
    };
    this.outer.scale.setScalar(1.55);
    this.group.add(this.outer);

    /* the light at the end of it */
    this.mouth = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(256, 'rgba(255,255,255,0.95)', 'rgba(90,230,255,0.4)'),
      color: 0x9ff2ff, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.mouth.scale.set(9, 9, 1);
    this.mouth.position.set(0, 0, -length / 2 - 1);
    this.group.add(this.mouth);

    this.light = new THREE.PointLight(0x5fe6ff, 90, 60, 1.5);
    this.light.position.copy(this.mouth.position);
    this.group.add(this.light);

    /* iris rings at the entrance — the "barrel" read from outside */
    this.iris = [];
    for (let i = 0; i < 4; i++) {
      const r = radius * (1.02 + i * 0.13);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.02 + i * 0.006, 6, 128),
        new THREE.MeshBasicMaterial({
          color: [0x0af5c8, 0x1a6cff, 0x8b5cf6, 0x23c9d9][i],
          transparent: true, opacity: 0.18 - i * 0.035,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      ring.position.z = length / 2 - i * 1.4;
      this.group.add(ring);
      this.iris.push(ring);
    }

    this.setVisible(false);
  }

  setVisible(v) { this.group.visible = v; }

  setEnergy(e) {
    this.uniforms.uEnergy.value = e;
    this.light.intensity = 40 + e * 90;
  }

  update(dt, t) {
    if (!this.group.visible) return;
    this.uniforms.uTime.value = t;
    if (this.outer.material.uniforms.uTime) this.outer.material.uniforms.uTime.value = t;
    this.mesh.rotation.z = t * 0.035;
    this.outer.rotation.z = -t * 0.021;
    this.iris.forEach((r, i) => {
      r.rotation.z = t * (0.1 + i * 0.05) * (i % 2 ? -1 : 1);
      r.material.opacity = (0.16 - i * 0.03) * (0.7 + Math.sin(t * 1.3 + i) * 0.3);
    });
    const s = 8.5 + Math.sin(t * 1.9) * 1.2;
    this.mouth.scale.set(s, s, 1);
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}

import * as THREE from 'three';
import { FS_VERT, UTILS } from '../shaders/lib.js';

/**
 * postprocessing.js — the lens.
 *
 * A hand-built composer rather than three's EffectComposer, because the stack
 * here is specific: an HDR scene buffer, a three-level bloom pyramid, and a
 * single composite pass that does tone mapping, chromatic aberration, barrel
 * distortion, vignette, grain and the glitch bus in one dependent-texture
 * read. One pass instead of five means one set of full-screen bandwidth.
 *
 * The glitch bus is driven from anywhere in the app (`post.glitch(0.8)`) and
 * decays on its own — section changes, filter clicks and console commands all
 * punch it.
 */

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uSoft;
varying vec2 vUv;

void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = uThreshold * uSoft + 1e-5;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float w = max(soft, l - uThreshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uDir;          /* texel-sized step, horizontal or vertical */
varying vec2 vUv;

void main(){
  /* 9-tap gaussian, linear-sampling weights */
  vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
  c += texture2D(tDiffuse, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tDiffuse, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tDiffuse, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(tDiffuse, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform vec2  uRes;
uniform float uTime;
uniform float uBloom;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uGlitch;
uniform float uBarrel;
uniform float uExposure;
uniform float uFade;        /* global fade-from-black, used by the preloader */
uniform vec3  uTintDeep;

varying vec2 vUv;

${UTILS}

/* ACES filmic, Narkowicz fit — cheap and keeps the teals from clipping */
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = vUv;
  vec2 cen = uv - 0.5;
  float r2 = dot(cen, cen);

  /* barrel distortion — the world sits behind a lens, not a window */
  uv = 0.5 + cen * (1.0 + uBarrel * r2);

  /* ── glitch: horizontal block tearing + channel desync ── */
  float g = uGlitch;
  if (g > 0.001){
    float band = floor(uv.y * 26.0);
    float n = rand(vec2(band, floor(uTime * 22.0)));
    float shift = (n - 0.5) * 0.16 * g * step(0.62, n);
    uv.x += shift;
    /* every so often, drop a whole slice */
    if (rand(vec2(band * 3.7, floor(uTime * 14.0))) > 0.985 - g * 0.06) uv.y += (n - 0.5) * 0.04 * g;
  }

  /* ── chromatic aberration: radial, stronger at the edges, glitch adds to it ── */
  vec2 dir = cen * (uAberration * (0.5 + r2 * 2.4) + g * 0.02);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir).b;

  /* ── bloom pyramid ── */
  vec3 b0 = texture2D(tBloom0, uv).rgb;
  vec3 b1 = texture2D(tBloom1, uv).rgb;
  vec3 b2 = texture2D(tBloom2, uv).rgb;
  /* weighted toward the tight level: a wide-only bloom eats fine structure */
  vec3 bloom = b0 * 0.62 + b1 * 0.26 + b2 * 0.13;
  col += bloom * uBloom;

  /* exposure + filmic curve */
  col = aces(col * uExposure);

  /* ── vignette ── */
  float vig = 1.0 - smoothstep(0.28, 0.92, length(cen) * 1.32);
  col *= mix(1.0, vig, uVignette);

  /* deep tint in the shadows so black is never dead black */
  col += uTintDeep * 0.06 * (1.0 - smoothstep(0.0, 0.35, dot(col, vec3(0.33))));

  /* ── grain ── */
  float grain = rand(uv * uRes * 0.5 + fract(uTime) * 91.7) - 0.5;
  col += grain * uGrain * (1.0 - dot(col, vec3(0.2, 0.6, 0.2)) * 0.6);

  /* glitch flash */
  col += vec3(0.05, 0.35, 0.3) * g * rand(vec2(uTime, uv.y)) * 0.5;

  col *= uFade;

  /* manual linear → sRGB (nothing else in this chain converts) */
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class PostFX {
  constructor(renderer, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = quality !== 'low';
    this._glitch = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtScene.depthTexture = null;

    const lightOpts = { ...rtOpts, depthBuffer: false };
    // three-level pyramid, each with an A/B pair for separable blur
    this.levels = [0, 1, 2].map(() => ({
      a: new THREE.WebGLRenderTarget(1, 1, lightOpts),
      b: new THREE.WebGLRenderTarget(1, 1, lightOpts),
    }));

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.55 }, uSoft: { value: 0.6 } },
      depthTest: false, depthWrite: false,
    });

    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });

    this.matComposite = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tDiffuse:    { value: null },
        tBloom0:     { value: null },
        tBloom1:     { value: null },
        tBloom2:     { value: null },
        uRes:        { value: new THREE.Vector2(1, 1) },
        uTime:       { value: 0 },
        uBloom:      { value: 0.42 },
        uAberration: { value: 0.0032 },
        uVignette:   { value: 0.62 },
        uGrain:      { value: 0.018 },
        uGlitch:     { value: 0 },
        uBarrel:     { value: 0.06 },
        uExposure:   { value: 0.92 },
        uFade:       { value: 1 },
        uTintDeep:   { value: new THREE.Color(0x02121a) },
      },
      depthTest: false, depthWrite: false,
    });
  }

  setSize(w, h, pixelRatio) {
    const dpr = pixelRatio;
    this.width = Math.max(1, Math.floor(w * dpr));
    this.height = Math.max(1, Math.floor(h * dpr));
    this.rtScene.setSize(this.width, this.height);
    this.matComposite.uniforms.uRes.value.set(this.width, this.height);

    const div = this.quality === 'high' ? 2 : 3;
    this.levels.forEach((lv, i) => {
      const s = Math.pow(2, i) * div;
      const lw = Math.max(1, Math.floor(this.width / s));
      const lh = Math.max(1, Math.floor(this.height / s));
      lv.a.setSize(lw, lh);
      lv.b.setSize(lw, lh);
      lv.w = lw; lv.h = lh;
    });
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target || null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /** Punch the glitch bus. Decays exponentially in update(). */
  glitch(amount = 0.6) { this._glitch = Math.min(1, Math.max(this._glitch, amount)); }

  update(dt) {
    if (this._glitch > 0.001) this._glitch *= Math.pow(0.0009, dt);
    else this._glitch = 0;
    this.matComposite.uniforms.uGlitch.value = this._glitch;
  }

  render(scene, camera, time) {
    const r = this.renderer;
    this.matComposite.uniforms.uTime.value = time;

    if (!this.enabled) {
      r.setRenderTarget(null);
      r.clear();
      r.render(scene, camera);
      return;
    }

    // 1 · scene → HDR buffer
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // 2 · bright pass → level 0
    this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
    this._pass(this.matBright, this.levels[0].a);

    // 3 · blur each level, feeding the next one down
    for (let i = 0; i < this.levels.length; i++) {
      const lv = this.levels[i];
      if (i > 0) {
        this.matBlur.uniforms.tDiffuse.value = this.levels[i - 1].a.texture;
        this.matBlur.uniforms.uDir.value.set(1 / lv.w, 0);
        this._pass(this.matBlur, lv.a);
      }
      this.matBlur.uniforms.tDiffuse.value = lv.a.texture;
      this.matBlur.uniforms.uDir.value.set(1 / lv.w, 0);
      this._pass(this.matBlur, lv.b);

      this.matBlur.uniforms.tDiffuse.value = lv.b.texture;
      this.matBlur.uniforms.uDir.value.set(0, 1 / lv.h);
      this._pass(this.matBlur, lv.a);
    }

    // 4 · composite to screen
    const u = this.matComposite.uniforms;
    u.tDiffuse.value = this.rtScene.texture;
    u.tBloom0.value = this.levels[0].a.texture;
    u.tBloom1.value = this.levels[1].a.texture;
    u.tBloom2.value = this.levels[2].a.texture;
    this._pass(this.matComposite, null);
  }

  dispose() {
    this.rtScene.dispose();
    this.levels.forEach((l) => { l.a.dispose(); l.b.dispose(); });
    this.matBright.dispose(); this.matBlur.dispose(); this.matComposite.dispose();
    this.quad.geometry.dispose();
  }
}

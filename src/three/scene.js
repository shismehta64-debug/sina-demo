import * as THREE from 'three';

/**
 * scene.js — renderer, camera, and the quality governor.
 *
 * One WebGL context for the entire site, created once and never replaced.
 * The governor watches a rolling frame time and walks the render scale (and,
 * as a last resort, post-processing) down until the page holds its target —
 * then carefully walks it back up if the machine turns out to have headroom.
 */

export const TIERS = {
  high: { sim: 512, dpr: 2.0,  post: true,  particleSize: 1.55 },
  mid:  { sim: 384, dpr: 1.5,  post: true,  particleSize: 1.75 },
  low:  { sim: 224, dpr: 1.0,  post: false, particleSize: 2.30 },
};

export function detectTier() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth < 768;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;

  if (mobile) return cores >= 6 && mem >= 4 ? 'mid' : 'low';

  // a throwaway context, purely to ask the GPU what it is
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const soft = /swiftshader|llvmpipe|software|basic render/i.test(name);
    if (soft) return 'low';
    if (maxTex < 8192 || cores <= 4) return 'mid';
    return 'high';
  } catch {
    return 'mid';
  }
}

export class Stage {
  constructor(canvas, tierName = detectTier()) {
    this.tierName = tierName;
    this.tier = { ...TIERS[tierName] };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // post handles edges; MSAA on an HDR target is not worth it
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x040a0f, 1);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;  // done manually in the composite
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    this.camera.position.set(0, 0.2, 6.5);

    this.dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    this.clock = new THREE.Clock();

    /* governor state */
    this._samples = [];
    this._lastAdjust = 0;
    this._scale = 1;
    this.onQualityChange = null;

    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const dpr = this.dpr * this._scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.onResize?.(w, h, dpr);
  }

  /** Feed frame times in; returns true when the tier changed. */
  governor(dt, time) {
    this._samples.push(dt);
    if (this._samples.length < 70) return false;

    const sorted = this._samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this._samples.length = 0;
    this.fps = 1 / median;

    if (time - this._lastAdjust < 3) return false;

    // struggling: drop render scale, then post, then give up gracefully
    if (this.fps < 42) {
      if (this._scale > 0.62) {
        this._scale = Math.max(0.62, this._scale - 0.18);
        this._lastAdjust = time;
        this.resize();
        return true;
      }
      if (this.tier.post) {
        this.tier.post = false;
        this._lastAdjust = time;
        this.onQualityChange?.(this.tier);
        return true;
      }
    } else if (this.fps > 57 && this._scale < 1) {
      this._scale = Math.min(1, this._scale + 0.12);
      this._lastAdjust = time;
      this.resize();
      return true;
    }
    return false;
  }

  get renderScale() { return this._scale; }
}

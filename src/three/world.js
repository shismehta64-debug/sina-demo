import * as THREE from 'three';
import { Stage, detectTier, TIERS } from './scene.js';
import { PostFX } from './postprocessing.js';
import { ParticleField, ANCHORS } from './particles.js';
import { SinaMark, glowTexture } from './mark.js';
import { Reactor } from './reactor.js';
import { HexTunnel } from './tunnel.js';
import { HoloPanels } from './panels.js';
import { Garden } from './garden.js';
import { CausticSurface } from './water.js';
import { CameraPath } from './camera-path.js';

/**
 * world.js — the single living scene.
 *
 * Everything the visitor scrolls through exists in one Three.js scene at all
 * times; progress 0→1 decides what is lit, what is faded, where the camera is
 * and what shape 262,144 particles are currently holding. There are no scene
 * swaps and no second renderer.
 */

/** Read the palette out of CSS so colour lives in exactly one place. */
function cssColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (n, fb) => {
    const v = s.getPropertyValue(n).trim();
    return v ? new THREE.Color(v) : new THREE.Color(fb);
  };
  return {
    teal: get('--teal', '#0af5c8'),
    blue: get('--blue', '#1a6cff'),
    violet: get('--violet', '#8b5cf6'),
    white: get('--white', '#e8f4f8'),
    bg: get('--bg', '#040a0f'),
  };
}

/** Piecewise-linear track: [[p, value], ...] → value at p. */
function track(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [pa, va] = keys[i], [pb, vb] = keys[i + 1];
    if (p >= pa && p <= pb) {
      const u = (p - pa) / (pb - pa || 1);
      return va + (vb - va) * (u * u * (3 - 2 * u));
    }
  }
  return last[1];
}

/** Same, but linear — used for the formation index so morphs stay even. */
function trackLinear(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (p >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [pa, va] = keys[i], [pb, vb] = keys[i + 1];
    if (p >= pa && p <= pb) return va + (vb - va) * ((p - pa) / (pb - pa || 1));
  }
  return last[1];
}

const FORM_TRACK = [
  [0.00, 0], [0.12, 0],    // the mark holds through the hero
  [0.22, 1],               // exhale into nebula
  [0.30, 2], [0.45, 2],    // neural graph, held across capabilities
  [0.55, 3], [0.70, 3],    // reactor core
  [0.76, 4], [0.83, 4],    // telemetry stream
  [0.93, 5], [1.00, 5],    // garden — reached before the tunnel exit, so the
                           // blooms are already waiting at the far mouth
];

export class World {
  constructor(canvas) {
    /* ?tier=low|mid|high forces a quality tier — for testing on machines that
       do not represent the visitor's, and for capturing reference frames. */
    const forced = new URLSearchParams(location.search).get('tier');
    this.tierName = TIERS[forced] ? forced : detectTier();
    this.stage = new Stage(canvas, this.tierName);
    this.colors = cssColors();

    const q = this.tierName;
    const tier = TIERS[q];

    this.post = new PostFX(this.stage.renderer, { quality: q });
    this.post.enabled = tier.post;

    this.field = new ParticleField(this.stage.renderer, { size: tier.sim, markScale: 3.0 });
    this.field.setPalette({
      a: this.colors.teal, b: this.colors.blue, c: this.colors.violet, hot: this.colors.white,
    });
    this.field.renderUniforms.uSize.value = tier.particleSize;
    this.stage.scene.add(this.field.points);

    /* ── hero: the mark, and the surface above it ── */
    this.mark = new SinaMark({ scale: 3.0 });
    this.mark.group.position.copy(ANCHORS.MARK);   // clear of the headline
    this.stage.scene.add(this.mark.group);

    this.water = new CausticSurface({ size: 120, segments: q === 'low' ? 40 : 110, amp: 1.4, opacity: 0.9 });
    this.water.mesh.position.set(0, 7.4, -2);
    this.water.mesh.rotation.x = Math.PI / 2;   // seen from below
    this.stage.scene.add(this.water.mesh);

    /* ── mid-journey props ── */
    this.reactor = new Reactor({ quality: q });
    this.stage.scene.add(this.reactor.group);

    this.panels = new HoloPanels({ quality: q });
    this.stage.scene.add(this.panels.group);

    this.tunnel = new HexTunnel({ z: -92, radius: 6.2, length: 30, density: 26, quality: q });
    this.stage.scene.add(this.tunnel.group);

    /* ── the end of the road ── */
    this.garden = new Garden({ quality: q });
    this.stage.scene.add(this.garden.group);

    this.pond = new CausticSurface({
      size: 90, segments: q === 'low' ? 36 : 90, amp: 0.5,
      tint: 0x0af5c8, deep: 0x02141c, caustic: 0.45,
    });
    this.pond.mesh.position.copy(ANCHORS.GARDEN).add(new THREE.Vector3(0, -1.9, 0));
    this.stage.scene.add(this.pond.mesh);

    /* the mark returns at the end, at rest */
    this.endMark = new SinaMark({ scale: 2.2 });
    this.endMark.group.position.copy(ANCHORS.GARDEN).add(new THREE.Vector3(0, 3.4, 1.5));
    this.stage.scene.add(this.endMark.group);

    this._buildStars(q === 'low' ? 1400 : 4200);

    /* ── camera ── */
    this.path = new CameraPath(this.stage.camera);

    /* ── pointer state ── */
    this.pointer = new THREE.Vector2(0, 0);
    this.pointerWorld = new THREE.Vector3(999, 999, 999);
    this.pointerActive = false;

    this.progress = 0;
    this.time = 0;
    this._power = 0.55;
    this._formation = 0;
    this._prevFormation = 0;
    /** When set (0-5) the console has pinned a formation; scroll no longer drives it. */
    this.formOverride = null;

    this.stage.onResize = (w, h, dpr) => {
      this.post.setSize(w, h, dpr);
      this.field.renderUniforms.uPixelRatio.value = dpr;
      this.layoutMark(w, h);
    };
    this.stage.onQualityChange = (t) => { this.post.enabled = t.post; };
    this.stage.onResize(this.stage.width, this.stage.height, this.stage.renderer.getPixelRatio());

    this._bindPointer();
  }

  /**
   * The hero mark sits to the right of the headline on wide screens; on a
   * portrait phone that puts most of it off the side of the frame, so it
   * recentres and lifts above the copy instead.
   */
  layoutMark(w, h) {
    const narrow = w / h < 1.05 || w < 820;
    const anchor = narrow
      ? new THREE.Vector3(0, 1.35, 0)
      : ANCHORS.MARK;
    this.field.uniforms.uMarkAnchor.value.copy(anchor);
    this.mark.group.position.copy(anchor);
  }

  _buildStars(count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const palette = [this.colors.teal, this.colors.blue, this.colors.violet, this.colors.white];
    for (let i = 0; i < count; i++) {
      // a long box wrapped around the whole corridor
      pos[i * 3 + 0] = (Math.random() - 0.5) * 190;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 2] = 30 - Math.random() * 220;
      const c = palette[(Math.random() * palette.length) | 0];
      const b = 0.25 + Math.random() * 0.75;
      col[i * 3 + 0] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
      size[i] = 0.5 + Math.random() * 2.2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.stage.renderer.getPixelRatio() }, uOpacity: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        uniform float uTime; uniform float uPixelRatio;
        varying vec3 vCol; varying float vTw;
        void main(){
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTw = 0.55 + 0.45 * sin(uTime * 1.6 + position.x * 0.7 + position.y * 0.4);
          gl_PointSize = aSize * uPixelRatio * (110.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vTw; uniform float uOpacity;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float a = pow(1.0 - d, 2.0) * vTw * uOpacity;
          gl_FragColor = vec4(vCol, a);
        }`,
      transparent: true, depthWrite: false, vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.stage.scene.add(this.stars);
  }

  _bindPointer() {
    const onMove = (x, y) => {
      this.pointer.set((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1));
      this.pointerActive = true;
      this.path.setParallax(this.pointer.x * 0.5, this.pointer.y * 0.35);
    };
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY), { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('mouseleave', () => { this.pointerActive = false; });
  }

  /** Called by the scroll rig, 0 → 1 across the whole document. */
  setProgress(p) {
    this.progress = Math.min(Math.max(p, 0), 1);
  }

  /** Reactor output, 0 → 1. Drives light, turbulence and core radius. */
  setPower(v) {
    this._power = v;
    this.reactor.setPower(v);
    this.field.uniforms.uPower.value = v;
  }

  burst(force = 26) {
    this.field.burst(force);
    this.post.glitch(0.75);
    this.path.punch(0.8);
    this.mark.strike('hub', 1);
  }

  update(dt, elapsed) {
    this.time = elapsed;
    const p = this.progress;

    /* ── formation ── */
    const f = this.formOverride != null ? this.formOverride : trackLinear(FORM_TRACK, p);
    const morphSpeed = Math.abs(f - this._prevFormation) / Math.max(dt, 1e-4);
    this._prevFormation = f;
    this.field.setFormation(f);

    const u = this.field.uniforms;
    // during a morph, loosen the spring and crank the swirl — the transit is the show
    const transit = Math.min(1, morphSpeed * 0.9);
    u.uStiff.value = 24.0 - transit * 11.0;
    /* curl has to stay well under the spring or the formation smears into fog;
       during a morph it is deliberately let off the leash */
    u.uTurb.value = 0.045 + transit * 0.5 + this._power * 0.04;
    u.uDamp.value = 0.87 - transit * 0.03;

    /* ── pointer → world-space repeller ── */
    if (this.pointerActive && this.tierName !== 'low') {
      const dist = 6 + p * 4;
      this.path.pointerWorld(this.pointer.x, this.pointer.y, dist, this.pointerWorld);
      u.uMouse.value.copy(this.pointerWorld);
      u.uRepel.value = 26;
    } else {
      u.uRepel.value = 0;
    }

    /* ── visibility / opacity tracks ── */
    const markO = track([[0.00, 1], [0.16, 1], [0.26, 0]], p);
    this.mark.setOpacity(markO);
    if (markO > 0.005) this.mark.update(dt, elapsed);

    this.water.setOpacity(track([[0.00, 1], [0.12, 0.85], [0.22, 0]], p));
    this.water.update(dt, elapsed);

    const reactorOn = p > 0.36 && p < 0.82;
    this.reactor.setVisible(reactorOn);
    if (reactorOn) {
      this.reactor.setFade(track([[0.36, 0], [0.46, 1], [0.70, 1], [0.82, 0]], p));
      this.reactor.update(dt, elapsed);
    }

    const panelsOn = p > 0.64 && p < 0.92;
    this.panels.setVisible(panelsOn);
    if (panelsOn) {
      this.panels.setOpacity(track([[0.64, 0], [0.72, 1], [0.86, 1], [0.92, 0]], p));
      this.panels.update(dt, elapsed);
    }

    const tunnelOn = p > 0.78 && p < 0.995;
    this.tunnel.setVisible(tunnelOn);
    if (tunnelOn) {
      this.tunnel.setEnergy(track([[0.78, 0.2], [0.90, 1], [0.99, 0.5]], p));
      this.tunnel.uniforms.uOpacity.value = track([[0.78, 0], [0.86, 1], [0.95, 0.85], [0.99, 0]], p);
      this.tunnel.update(dt, elapsed);
    }

    const gardenOn = p > 0.88;
    this.garden.setVisible(gardenOn);
    if (gardenOn) {
      const o = track([[0.88, 0], [0.96, 1]], p);
      this.garden.setOpacity(o);
      this.garden.update(dt, elapsed);
      this.pond.setOpacity(o);
      this.pond.update(dt, elapsed);
      this.endMark.setOpacity(o);
      this.endMark.update(dt, elapsed);
      this.endMark.group.rotation.y = elapsed * 0.12;
    } else {
      this.pond.setOpacity(0);
      this.endMark.setOpacity(0);
    }

    /* stars dim inside the tunnel, where they would read as noise */
    this.stars.material.uniforms.uTime.value = elapsed;
    this.stars.material.uniforms.uOpacity.value = track([[0.0, 0.9], [0.8, 0.9], [0.9, 0.15], [1.0, 0.5]], p);

    /* particle brightness rises as the field densifies into the core */
    this.field.renderUniforms.uFade.value = this._fade ?? 1;
    this.field.renderUniforms.uOpacity.value = 0.85 + this._power * 0.3;

    /* ── simulate + fly ── */
    this.field.update(Math.min(dt, 0.033), elapsed);
    this.path.update(p, dt, elapsed);

    /* ── draw ── */
    this.post.update(dt);
    this.post.render(this.stage.scene, this.stage.camera, elapsed);
  }

  /** 0 = black, 1 = fully lit. The preloader fades the world in through this. */
  setFade(v) {
    this._fade = v;
    this.post.matComposite.uniforms.uFade.value = v;
    if (!this.post.enabled) this.stage.renderer.setClearColor(0x040a0f, 1);
  }

  dispose() {
    this.field.dispose(); this.mark.dispose(); this.endMark.dispose();
    this.reactor.dispose(); this.tunnel.dispose(); this.panels.dispose();
    this.garden.dispose(); this.water.dispose(); this.pond.dispose();
    this.post.dispose();
    this.stars.geometry.dispose(); this.stars.material.dispose();
    this.stage.renderer.dispose();
  }
}

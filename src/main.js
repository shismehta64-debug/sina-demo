import './styles/base.css';
import './styles/typography.css';
import './styles/components.css';
import './styles/sections.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { World } from './three/world.js';
import { buildMarkSVG } from './core/genome.js';
import { runPreloader } from './animations/preloader.js';
import { initScroll, initHorizontal } from './animations/scroll.js';
import { initCursor } from './animations/cursor.js';
import { initConsole } from './animations/console.js';
import { scramble } from './animations/glitch.js';
import { initCapabilities } from './sections/capabilities.js';
import { initModels } from './sections/models.js';
import { initAPI } from './sections/api.js';
import { initReactor } from './sections/reactor.js';
import { initContact } from './sections/contact.js';

gsap.registerPlugin(ScrollTrigger);

/**
 * main.js — assembly.
 *
 * Order matters: the world comes up first so the preloader can detonate it,
 * DOM sections are injected before the scroll rig measures anything, and every
 * animated thing shares one ticker (Lenis → GSAP → render).
 */

/* ── procedural assets: nothing is loaded from disk ─────────────── */

function makeGrain() {
  const s = 180;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--grain-src', `url(${c.toDataURL()})`);
}

function makeFavicon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-1 -1 2 2');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  buildMarkSVG(svg, { stroke: 0.09, scale: 1.32 });
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const link = document.querySelector('link[rel=icon]') || document.createElement('link');
  link.rel = 'icon';
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
}

/* ── boot ───────────────────────────────────────────────────────── */

function boot() {
  makeGrain();
  makeFavicon();
  buildMarkSVG(document.getElementById('nav-mark-svg'), { stroke: 0.1, scale: 1.3 });

  const canvas = document.getElementById('bg-canvas');
  let world = null;

  try {
    world = new World(canvas);
  } catch (err) {
    // No WebGL, or a driver that refuses us: the page must still read.
    console.error('[sina] WebGL unavailable — falling back to flat mode', err);
    document.body.classList.add('no-webgl');
    canvas.style.display = 'none';
  }

  /* ── DOM sections first, so ScrollTrigger measures the real page ── */
  initCapabilities({ world });
  initModels({ world });

  const sectorEl = document.getElementById('hud-sector');
  const scrollRig = initScroll({
    world,
    onSector: (label) => {
      if (!sectorEl || sectorEl.textContent === label) return;
      scramble(sectorEl, label, { duration: 0.5, stagger: 0.3, className: '' });
      world?.post.glitch(0.22);
    },
  });

  const { lenis } = scrollRig;

  initHorizontal({ world });
  // horizontal pinning changes the document height — remeasure, then seed the
  // world with the current position so it is correct before the first scroll
  ScrollTrigger.refresh();
  scrollRig.buildJourneyMap();
  scrollRig.driveWorld({ scroll: window.scrollY, limit: lenis.limit });
  initAPI({ world });
  initReactor({ world });
  initContact({ world });
  initCursor({ onClick: () => world?.field.burst(6) });
  initConsole({ world, lenis });

  /* ── the render loop: one ticker for the whole page ── */
  const hudCam = document.getElementById('hud-cam');
  const hudFps = document.getElementById('hud-fps');
  const hudParts = document.getElementById('hud-parts');
  const hudTier = document.getElementById('hud-tier');
  if (world && hudParts) {
    hudParts.textContent = world.field.count.toLocaleString();
    hudTier.textContent = world.tierName.toUpperCase();
  }

  let last = performance.now();
  let hudClock = 0;

  gsap.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!world) return;

    const elapsed = now / 1000;
    world.update(dt, elapsed);
    world.stage.governor(dt, elapsed);

    hudClock += dt;
    if (hudClock > 0.25) {
      hudClock = 0;
      const p = world.stage.camera.position;
      if (hudCam) hudCam.textContent = `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`;
      if (hudFps) hudFps.textContent = world.stage.fps ? world.stage.fps.toFixed(0) : '—';
      if (hudTier) {
        hudTier.textContent = `${world.tierName.toUpperCase()}${world.stage.renderScale < 0.99 ? ` ×${world.stage.renderScale.toFixed(2)}` : ''}`;
      }
    }
  });

  /* ── preloader, then the hero entrance ── */
  runPreloader({
    world,
    onDone: () => {
      ScrollTrigger.refresh();

      const chars = window.__heroChars || [];
      const tl = gsap.timeline();
      tl.to(chars, {
        yPercent: 0, opacity: 1, rotateX: 0,
        duration: 1.15, stagger: 0.045, ease: 'power4.out',
      });

      const tag = document.getElementById('hero-tag');
      if (tag) {
        tl.call(() => scramble(tag, tag.dataset.text, { duration: 1.1, stagger: 0.6, className: '' }), null, '-=0.5');
      }

      // the mark fires its synapses on arrival
      tl.call(() => {
        ['a', 'c', 'b', 'd', 'e', 'f'].forEach((id, i) => {
          setTimeout(() => world?.mark.strike(id, 1), i * 140);
        });
      }, null, '-=0.8');
    },
  });

  /* ── housekeeping ── */
  window.addEventListener('resize', () => ScrollTrigger.refresh(), { passive: true });

  const rotate = document.getElementById('rotate-note');
  const checkOrientation = () => {
    if (!rotate) return;
    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 640;
    rotate.style.display = portrait ? 'block' : 'none';
  };
  checkOrientation();
  window.addEventListener('resize', checkOrientation, { passive: true });

  // pause the sim when the tab is hidden — no point burning a GPU in the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) gsap.ticker.sleep();
    else { last = performance.now(); gsap.ticker.wake(); }
  });

  window.SINA = { world, lenis, gsap, ScrollTrigger, scrollRig };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

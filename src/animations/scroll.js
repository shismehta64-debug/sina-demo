import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';
import { scramble, splitChars, wrapLine, hoverScramble } from './glitch.js';
import { magnetize } from './cursor.js';

gsap.registerPlugin(ScrollTrigger);

/**
 * scroll.js — the timeline that ties the document to the world.
 *
 * Lenis owns scrolling; its RAF drives the GSAP ticker, which drives
 * ScrollTrigger *and* the render loop, so there is exactly one clock in the
 * page. Document progress is handed straight to the camera path — the world
 * has no idea what a section is, and the DOM has no idea where the camera is.
 */

/**
 * The journey is keyed to *sections*, not to raw document percentage.
 * Section heights differ and the pinned models section injects thousands of
 * extra pixels, so a linear scroll→camera mapping drifts badly: the reactor
 * would arrive under the wrong copy. Each section instead claims a slice of
 * camera time, and the map is rebuilt from live geometry on every refresh.
 */
const JOURNEY = [
  ['hero',         0.000],
  ['about',        0.130],
  ['capabilities', 0.270],
  ['reactor',      0.440],
  ['api',          0.680],
  ['pricing',      0.755],
  ['models',       0.800],
  ['lab',          0.855],
  ['proof',        0.945],
  ['contact',      0.972],
];

let MAP = [];

function buildJourneyMap() {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  MAP = JOURNEY.map(([id, t]) => {
    const el = document.getElementById(id);
    const top = el ? el.getBoundingClientRect().top + window.scrollY : 0;
    return { p: Math.min(1, Math.max(0, top / max)), t };
  });
  for (let i = 1; i < MAP.length; i++) {
    if (MAP[i].p <= MAP[i - 1].p) MAP[i].p = MAP[i - 1].p + 1e-4;
  }
  MAP.push({ p: 1, t: 1 });
}

function journeyT(p) {
  if (!MAP.length) return p;
  if (p <= MAP[0].p) return MAP[0].t;
  for (let i = 0; i < MAP.length - 1; i++) {
    const a = MAP[i], b = MAP[i + 1];
    if (p <= b.p) {
      const u = (p - a.p) / (b.p - a.p || 1);
      return a.t + (b.t - a.t) * u;
    }
  }
  return 1;
}

export function initScroll({ world, onSector } = {}) {
  const lenis = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1.0,
    touchMultiplier: 1.7,
    infinite: false,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  /* ── master: document progress → the 3D journey ──
     Driven straight off Lenis rather than a ScrollTrigger. The pinned models
     section rewrites the document height after the triggers are built, and a
     trigger holding stale end values silently skews the whole camera journey —
     the reactor arrives under the wrong copy. Lenis reports scroll and limit
     from live geometry every frame, so this can never drift. */
  const driveWorld = ({ scroll, limit }) => {
    const docP = limit > 0 ? Math.min(1, Math.max(0, scroll / limit)) : 0;
    world?.setProgress(journeyT(docP));
    updateRail(docP);
    updateSector();
    if (docP > 0.02) hideHint();
  };
  buildJourneyMap();
  // the pin adds thousands of pixels of spacer after this first pass
  ScrollTrigger.addEventListener('refresh', buildJourneyMap);
  window.addEventListener('load', () => { ScrollTrigger.refresh(); buildJourneyMap(); });

  const progFill = document.getElementById('prog-fill');
  const progDot = document.getElementById('prog-dot');
  const progPct = document.getElementById('prog-pct');
  const hint = document.getElementById('hint');
  let hintGone = false;

  function updateRail(p) {
    progFill.style.height = `${p * 100}%`;
    progDot.style.top = `${p * 100}%`;
    progPct.textContent = String(Math.round(p * 100)).padStart(2, '0');
  }
  function hideHint() {
    if (hintGone) return;
    hintGone = true;
    gsap.to(hint, { opacity: 0, duration: 0.5 });
  }

  /* ── sector announcements ──
     Derived from position rather than enter/leave events: the pinned models
     section makes trigger boundaries fire out of order, so an event-driven
     readout ends up naming whichever section fired last instead of the one
     actually on screen. */
  const sections = [...document.querySelectorAll('.sec[data-sector]')];
  let lastSector = null;

  function updateSector() {
    const mid = window.scrollY + window.innerHeight * 0.5;
    let cur = sections[0];
    for (const sec of sections) {
      if (mid >= sec.getBoundingClientRect().top + window.scrollY) cur = sec;
    }
    if (cur && cur.dataset.sector !== lastSector) {
      lastSector = cur.dataset.sector;
      onSector?.(lastSector, cur.id);
    }
  }

  lenis.on('scroll', driveWorld);
  updateSector();

  /* ── headings resolve out of noise ── */
  document.querySelectorAll('[data-glitch]').forEach((el) => {
    el.dataset.text = el.textContent.trim();
    // hold the layout, but hide until its moment
    gsap.set(el, { opacity: 0 });
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        gsap.to(el, { opacity: 1, duration: 0.25 });
        scramble(el, el.dataset.text, { duration: 1.0, stagger: 0.5 });
        world?.post.glitch(0.28);
      },
    });
  });

  /* ── generic fade-ups ── */
  gsap.utils.toArray('.reveal-up').forEach((el) => {
    gsap.from(el, {
      y: 34, opacity: 0, duration: 1.0, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    });
  });

  /* ── masked display lines ── */
  gsap.utils.toArray('.mline').forEach((line, i) => {
    if (line.hasAttribute('data-glitch')) return;   // glitch owns those
    const inner = wrapLine(line);
    gsap.from(inner, {
      yPercent: 115, opacity: 0, duration: 1.15, ease: 'power4.out', delay: i * 0.06,
      scrollTrigger: { trigger: line, start: 'top 88%', once: true },
    });
  });

  /* ── hero title: per-character entrance ── */
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle) {
    const chars = splitChars(heroTitle);
    gsap.set(chars, { yPercent: 118, opacity: 0, rotateX: -70 });
    window.__heroChars = chars;   // preloader hand-off (see main.js)
  }

  const heroTag = document.getElementById('hero-tag');
  if (heroTag) heroTag.dataset.text = heroTag.textContent.trim();

  /* ── counters ── */
  gsap.utils.toArray('[data-count]').forEach((el) => {
    const end = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || '0', 10);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const isInt = el.dataset.format === 'int';
    const obj = { v: 0 };

    const render = () => {
      let s;
      if (isInt) s = Math.round(obj.v).toLocaleString('en-US');
      else s = obj.v.toFixed(dec);
      el.textContent = `${prefix}${s}${suffix}`;
    };
    render();

    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () => gsap.to(obj, {
        v: end, duration: 2.2, ease: 'power2.out', onUpdate: render,
      }),
    });
  });

  /* ── capability cards ── */
  ScrollTrigger.batch('.cap-grid .card', {
    start: 'top 90%',
    onEnter: (batch) => gsap.from(batch, {
      y: 70, opacity: 0, rotateX: -14, scale: 0.94,
      duration: 1.1, stagger: 0.09, ease: 'power3.out', overwrite: true,
    }),
    once: true,
  });

  /* ── pricing: three cards flying in from three directions ── */
  const plans = gsap.utils.toArray('.plan');
  plans.forEach((plan, i) => {
    const dir = i === 0 ? -1 : i === 2 ? 1 : 0;
    gsap.from(plan, {
      x: dir * 180,
      y: dir === 0 ? 140 : 40,
      z: -300,
      rotateY: dir * -26,
      opacity: 0,
      duration: 1.4,
      ease: 'power3.out',
      delay: i * 0.08,
      scrollTrigger: { trigger: '.price-row', start: 'top 82%', once: true },
    });
    magnetize(plan, { strength: 0.14, radius: 40, tilt: 5 });
  });

  /* ── quotes + stats ── */
  ScrollTrigger.batch('.q', {
    start: 'top 90%', once: true,
    onEnter: (b) => gsap.from(b, { y: 50, opacity: 0, duration: 1, stagger: 0.1, ease: 'power3.out' }),
  });
  ScrollTrigger.batch('.st', {
    start: 'top 92%', once: true,
    onEnter: (b) => gsap.from(b, { y: 30, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power2.out' }),
  });
  ScrollTrigger.batch('.ag', {
    start: 'top 92%', once: true,
    onEnter: (b) => gsap.from(b, { y: 26, opacity: 0, duration: 0.7, stagger: 0.07 }),
  });
  ScrollTrigger.batch('.lab-list li', {
    start: 'top 92%', once: true,
    onEnter: (b) => gsap.from(b, { x: -30, opacity: 0, duration: 0.7, stagger: 0.08 }),
  });

  /* ── nav + footer link hovers ── */
  document.querySelectorAll('.glitch-link').forEach(hoverScramble);

  /* ── smooth in-page anchors, routed through Lenis ── */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -20, duration: 1.9 });
      world?.post.glitch(0.4);
    });
  });

  return { lenis, ScrollTrigger, buildJourneyMap, journeyT, driveWorld, map: () => MAP };
}

/**
 * The horizontal models section. Built after its panels are injected so the
 * track width is real. Pins the viewport and converts vertical scroll
 * distance into horizontal travel.
 */
export function initHorizontal({ world } = {}) {
  const pin = document.getElementById('h-pin');
  const trackEl = document.getElementById('h-track');
  const rail = document.getElementById('h-rail-fill');
  if (!pin || !trackEl) return;

  const getDistance = () => Math.max(0, trackEl.scrollWidth - window.innerWidth + 80);

  const st = ScrollTrigger.create({
    trigger: '#models',
    start: 'top top',
    end: () => `+=${getDistance() * 1.15}`,
    pin: pin,
    scrub: 1.1,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    onUpdate: (self) => {
      const d = getDistance();
      gsap.set(trackEl, { x: -d * self.progress });
      if (rail) rail.style.width = `${self.progress * 100}%`;
    },
  });

  // panels bank as they cross the centre of the screen — a pinned section has
  // no vertical travel, so this is measured from live geometry each frame
  const panels = [...trackEl.querySelectorAll('.h-model')];
  const setters = panels.map((p) => ({
    ry: gsap.quickSetter(p, 'rotationY', 'deg'),
    sc: gsap.quickSetter(p, 'scale'),
    el: p,
  }));

  gsap.ticker.add(() => {
    if (!st.isActive) return;
    const mid = window.innerWidth / 2;
    for (const s of setters) {
      const r = s.el.getBoundingClientRect();
      if (r.right < -200 || r.left > window.innerWidth + 200) continue;
      const off = (r.left + r.width / 2 - mid) / mid;   // -1 … 1
      s.ry(-off * 13);
      s.sc(1 - Math.min(Math.abs(off), 1) * 0.07);
    }
  });

  return st;
}

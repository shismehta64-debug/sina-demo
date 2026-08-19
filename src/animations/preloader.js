import gsap from 'gsap';
import { buildMarkSVG } from '../core/genome.js';

/**
 * preloader.js — the boot sequence.
 *
 * The mark draws itself edge-by-edge, the readout counts up through a
 * plausible cold-start log, and then the whole thing implodes: the SVG
 * collapses to a point at the same instant the particle field detonates
 * behind it, so the logo appears to *become* the 3D world.
 */

const BOOT_LOG = [
  [0.00, 'COLD START'],
  [0.08, 'MOUNT /dev/neural0'],
  [0.18, 'LOAD WEIGHTS 7.0B'],
  [0.34, 'ALLOCATE KV CACHE'],
  [0.46, 'WARM ATTENTION HEADS'],
  [0.58, 'CALIBRATE INFERENCE'],
  [0.70, 'SPIN UP REACTOR'],
  [0.82, 'LINK SYNAPSE GRAPH'],
  [0.92, 'HANDSHAKE COMPLETE'],
  [1.00, 'ONLINE'],
];

export function runPreloader({ world, onDone } = {}) {
  const root = document.getElementById('preloader');
  const svg = document.getElementById('pre-mark');
  const fill = document.getElementById('pre-fill');
  const pct = document.getElementById('pre-pct');
  const log = document.getElementById('pre-log');
  const status = document.getElementById('pre-status');
  const readout = document.querySelector('.pre-readout');
  const corners = document.querySelectorAll('.pre-corner');

  document.body.classList.add('is-loading');

  const parts = buildMarkSVG(svg, { stroke: 0.05, scale: 1.2 });
  const edges = parts.filter((p) => p.dataset.kind === 'edge');
  const nodes = parts.filter((p) => p.dataset.kind === 'node');

  // prime every stroke for a draw-on
  [...edges, ...nodes].forEach((el) => {
    el.setAttribute('pathLength', '1');
    el.style.strokeDasharray = '1';
    el.style.strokeDashoffset = '1';
    el.style.opacity = '1';
    if (el.getAttribute('fill') !== 'none') el.style.fillOpacity = '0';
  });

  const state = { p: 0 };
  const tl = gsap.timeline();

  tl.from(corners, { scale: 0.4, opacity: 0, duration: 0.7, stagger: 0.06, ease: 'power3.out' }, 0);

  // links draw outward from the hub
  tl.to(edges, {
    strokeDashoffset: 0,
    duration: 0.85,
    stagger: 0.09,
    ease: 'power2.inOut',
  }, 0.15);

  // then each node rings in
  tl.to(nodes, {
    strokeDashoffset: 0,
    duration: 0.7,
    stagger: 0.07,
    ease: 'power2.out',
  }, 0.55);

  tl.to(nodes.filter((n) => n.getAttribute('fill') !== 'none'), {
    fillOpacity: 1, duration: 0.5, stagger: 0.06, ease: 'power2.out',
  }, 0.9);

  tl.to(readout, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 0.5);

  // the fake-but-honest progress run
  tl.to(state, {
    p: 1,
    duration: 2.3,
    ease: 'power1.inOut',
    onUpdate: () => {
      const v = state.p;
      fill.style.width = `${(v * 100).toFixed(1)}%`;
      pct.textContent = String(Math.round(v * 100)).padStart(3, '0');
      for (let i = BOOT_LOG.length - 1; i >= 0; i--) {
        if (v >= BOOT_LOG[i][0]) { log.textContent = BOOT_LOG[i][1]; break; }
      }
    },
  }, 0.6);

  tl.call(() => { status.textContent = 'NEURAL CORE READY'; });

  // ── the implosion ──
  tl.to(svg, {
    scale: 0.02,
    opacity: 0,
    duration: 0.62,
    ease: 'power3.in',
    transformOrigin: '50% 50%',
    onStart: () => {
      gsap.to(readout, { opacity: 0, duration: 0.35 });
      gsap.to(corners, { opacity: 0, scale: 1.8, duration: 0.6, stagger: 0.03 });
    },
  }, '+=0.15');

  // …and the detonation, timed to land on the last frame of the collapse
  tl.call(() => { world?.burst(46); });

  tl.to(root, {
    opacity: 0,
    duration: 0.9,
    ease: 'power2.inOut',
    onComplete: () => {
      root.style.display = 'none';
      document.body.classList.remove('is-loading');
      onDone?.();
    },
  }, '-=0.1');

  // the world fades up from black underneath
  if (world) {
    world.setFade(0);
    tl.to({ v: 0 }, {
      v: 1, duration: 1.5, ease: 'power2.out',
      onUpdate() { world.setFade(this.targets()[0].v); },
    }, '-=1.0');
  }

  // chrome arrives last
  tl.to(['#nav', '#hud', '#progress', '#hint'], {
    opacity: 1, y: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out',
  }, '-=0.7');

  return tl;
}

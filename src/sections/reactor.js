import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * reactor.js — the only control on the page that touches physics.
 *
 * The output slider is wired straight into the particle simulation's uPower
 * uniform and the reactor's lights. Push it and the containment sphere
 * genuinely swells, the floor pools brighter, the cables charge faster. The
 * telemetry column beside it is a live log, not a loop of canned strings.
 */

const EVENTS = [
  'attn.kv_cache: rebalanced across 8 shards',
  'router: expert 3 saturated, spilling to 7',
  'sched: batch 4096 → queue depth 2',
  'thermal: core 41.2C nominal',
  'io: 12.4 GB/s sustained from weight store',
  'guard: 0 refusals in last 10k requests',
  'quant: fp8 path active for layers 12-31',
  'net: p99 latency 11.8ms',
  'cache: prefix hit rate 68.4%',
  'ckpt: shard 04/16 verified',
  'tokens: 1.2M served this minute',
  'sync: gradient allreduce 3.1ms',
];

export function initReactor({ world } = {}) {
  const slider = document.getElementById('core-power');
  const label = document.getElementById('core-power-val');
  const readout = document.getElementById('reactor-readout');
  const section = document.getElementById('reactor');
  if (!slider || !section) return;

  /* ── power control ── */
  const apply = (v) => {
    const p = v / 100;
    label.textContent = `${v}%`;
    world?.setPower(0.12 + p * 1.05);
    label.style.color = v > 85 ? 'var(--amber)' : 'var(--teal)';
  };
  apply(parseInt(slider.value, 10));

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    apply(v);
    if (v > 92) {
      world?.post.glitch(0.35);
      world?.path.punch(0.25);
    }
  });

  // overdrive: hold it at 100 and the containment complains
  slider.addEventListener('change', () => {
    if (parseInt(slider.value, 10) >= 100) {
      world?.burst(34);
      log('!! containment stressed — output clamped', 'warn');
      gsap.to(slider, { value: 88, duration: 1.4, ease: 'power2.out', onUpdate: () => apply(parseInt(slider.value, 10)) });
    }
  });

  /* ── telemetry log ── */
  const lines = [];
  let timer = null;
  let t0 = Date.now();

  function log(text, kind) {
    const stamp = ((Date.now() - t0) / 1000).toFixed(2).padStart(7, '0');
    lines.push(`${stamp}  ${kind === 'warn' ? '!' : '·'} ${text}`);
    while (lines.length > 9) lines.shift();
    if (readout) readout.textContent = lines.join('\n');
  }

  function start() {
    if (timer) return;
    t0 = Date.now();
    lines.length = 0;
    log('reactor telemetry attached');
    timer = setInterval(() => {
      log(EVENTS[(Math.random() * EVENTS.length) | 0]);
    }, 900);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  ScrollTrigger.create({
    trigger: section,
    start: 'top 70%',
    end: 'bottom 30%',
    onEnter: start,
    onEnterBack: start,
    onLeave: stop,
    onLeaveBack: stop,
  });

  return { log };
}

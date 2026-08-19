import gsap from 'gsap';

/**
 * glitch.js — text that resolves out of noise.
 *
 * Driven off the GSAP ticker rather than setInterval so scrambles stay in
 * lockstep with the render loop and pause when the tab is hidden.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]{}#$%&*+=~^';
const active = new WeakMap();

/**
 * Resolve `el` to `finalText`, character by character, out of random glyphs.
 * Returns a promise so callers can chain.
 */
export function scramble(el, finalText = el.dataset.text || el.textContent, {
  duration = 0.9,
  stagger = 0.55,       // 0 = all at once, 1 = strictly sequential
  glyphs = GLYPHS,
  className = 'scrambling',
} = {}) {
  const text = finalText;
  const prev = active.get(el);
  if (prev) { gsap.ticker.remove(prev.tick); prev.resolve?.(); }

  el.dataset.text = text;
  if (className) el.classList.add(className);

  return new Promise((resolve) => {
    const n = text.length;
    // each character gets its own reveal moment, jittered
    const slots = Array.from({ length: n }, (_, i) => {
      const base = (i / Math.max(n - 1, 1)) * stagger;
      return base + Math.random() * (1 - stagger) * 0.9;
    });
    let t0 = null;

    // NOTE: gsap.ticker reports elapsed time in SECONDS, not milliseconds.
    const tick = (time) => {
      if (t0 === null) t0 = time;
      const p = Math.min((time - t0) / duration, 1);
      let out = '';
      for (let i = 0; i < n; i++) {
        const ch = text[i];
        if (ch === ' ' || ch === '\n') { out += ch; continue; }
        out += p >= slots[i] ? ch : glyphs[(Math.random() * glyphs.length) | 0];
      }
      el.textContent = out;
      if (p >= 1) {
        gsap.ticker.remove(tick);
        el.textContent = text;
        if (className) el.classList.remove(className);
        active.delete(el);
        resolve();
      }
    };

    active.set(el, { tick, resolve });
    gsap.ticker.add(tick);
  });
}

/** Short, sharp scramble used for hover states — keeps its own text intact. */
export function hoverScramble(el) {
  const text = el.dataset.text || el.textContent;
  el.dataset.text = text;
  el.addEventListener('mouseenter', () => {
    scramble(el, text, { duration: 0.42, stagger: 0.25, className: '' });
  });
}

/**
 * Split an element's text into per-character spans for staggered reveals.
 * Words are kept in wrappers so lines never break mid-word.
 */
export function splitChars(el) {
  const text = el.textContent.trim();
  el.textContent = '';
  const chars = [];
  const words = text.split(/(\s+)/);

  for (const w of words) {
    if (/^\s+$/.test(w)) {
      const s = document.createElement('span');
      s.className = 'char space';
      s.innerHTML = '&nbsp;';
      el.appendChild(s);
      chars.push(s);
      continue;
    }
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-block';
    wrap.style.whiteSpace = 'nowrap';
    for (const c of w) {
      const s = document.createElement('span');
      s.className = 'char';
      s.textContent = c;
      wrap.appendChild(s);
      chars.push(s);
    }
    el.appendChild(wrap);
  }
  return chars;
}

/** Wrap a block element's contents so it can be masked/slid as one line. */
export function wrapLine(el) {
  const inner = document.createElement('span');
  inner.className = 'mline-in';
  while (el.firstChild) inner.appendChild(el.firstChild);
  el.appendChild(inner);
  return inner;
}

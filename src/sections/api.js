import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * api.js — the terminal and the stream.
 *
 * The code block types itself in, syntax-highlighted by a small hand-rolled
 * tokeniser (no highlighter dependency for one snippet). The right panel then
 * streams a response token-by-token with live latency and throughput badges —
 * and every prompt you fire pushes the 3D field, so the page reacts to its own
 * demo.
 */

const CODE = `import Sina from '@sina-ai/sdk';

const sina = new Sina({
  apiKey: process.env.SINA_API_KEY,
});

// Stream a response from SINA-CORE-7B
const stream = await sina.messages.stream({
  model: 'sina-core-7b',
  max_tokens: 1024,
  messages: [
    {
      role: 'user',
      content: 'Explain quantum entanglement simply.'
    }
  ]
});

for await (const chunk of stream) {
  process.stdout.write(chunk.delta.text);
}`;

const KEYWORDS = new Set([
  'import', 'from', 'const', 'let', 'var', 'new', 'await', 'async', 'for', 'of',
  'in', 'return', 'function', 'if', 'else', 'class', 'export', 'default',
]);

const PROMPTS = [
  {
    q: 'Explain quantum entanglement simply.',
    a: 'Quantum entanglement is when two particles become linked — measuring one instantly affects the other, no matter the distance. Einstein called it "spooky action at a distance", and it is now the backbone of quantum networking.',
    lat: 12, tps: 198,
  },
  {
    q: 'Write a haiku about inference.',
    a: 'Weights hum in the dark —\na question falls like a stone,\nmeaning ripples out.',
    lat: 9, tps: 214,
  },
  {
    q: 'Why does my regex fail on nested groups?',
    a: 'Because classic regex is not recursive: it cannot count. /\\(([^()]*)\\)/ only matches one level deep. For arbitrary nesting you need a real parser — or a recursive engine like PCRE with (?R).',
    lat: 14, tps: 186,
  },
];

/* ── tokeniser ─────────────────────────────────────────────────── */

function tokenize(src) {
  const out = [];
  let i = 0;
  const push = (text, cls) => out.push({ text, cls });

  while (i < src.length) {
    const c = src[i];

    // line comment
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = src.length;
      push(src.slice(i, j), 't-com');
      i = j;
      continue;
    }

    // string
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      push(src.slice(i, Math.min(j + 1, src.length)), 't-str');
      i = j + 1;
      continue;
    }

    // number
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      push(src.slice(i, j), 't-num');
      i = j;
      continue;
    }

    // identifier
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const next = src.slice(j).match(/^\s*\(/);
      let cls = '';
      if (KEYWORDS.has(word)) cls = 't-key';
      else if (next) cls = 't-fun';
      else if (/^[A-Z]/.test(word)) cls = 't-fun';
      push(word, cls);
      i = j;
      continue;
    }

    // punctuation run
    if (/[{}()[\].,;:=><+\-*/%!&|?]/.test(c)) {
      let j = i;
      while (j < src.length && /[{}()[\].,;:=><+\-*/%!&|?]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '/')) j++;
      push(src.slice(i, j), 't-pun');
      i = j;
      continue;
    }

    push(c, '');
    i++;
  }
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Render the first `n` characters of the token stream, with line numbers. */
function renderUpTo(tokens, n) {
  let count = 0;
  let html = '<span class="ln">1</span>';
  let line = 1;

  for (const tk of tokens) {
    if (count >= n) break;
    const take = Math.min(tk.text.length, n - count);
    const slice = tk.text.slice(0, take);
    count += take;

    // split on newlines so each gets a gutter number
    const parts = slice.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        line++;
        html += `\n<span class="ln">${line}</span>`;
      }
      if (!parts[p]) continue;
      html += tk.cls ? `<span class="${tk.cls}">${esc(parts[p])}</span>` : esc(parts[p]);
    }
  }
  return html + '<span class="caret"></span>';
}

export function initAPI({ world } = {}) {
  const block = document.getElementById('code-block');
  const respBody = document.getElementById('resp-body');
  const bLat = document.getElementById('b-lat');
  const bTps = document.getElementById('b-tps');
  const buttons = [...document.querySelectorAll('.pbtn')];
  if (!block) return;

  const tokens = tokenize(CODE);
  const total = CODE.length;
  block.innerHTML = renderUpTo(tokens, 0);

  /* ── type the snippet in when it scrolls into view ── */
  let typed = false;
  ScrollTrigger.create({
    trigger: block,
    start: 'top 82%',
    once: true,
    onEnter: () => {
      typed = true;
      const o = { n: 0 };
      gsap.to(o, {
        n: total,
        duration: 3.4,
        ease: 'none',
        onUpdate: () => { block.innerHTML = renderUpTo(tokens, Math.floor(o.n)); },
        onComplete: () => {
          block.innerHTML = renderUpTo(tokens, total);
          stream(0);
        },
      });
    },
  });

  /* ── the response stream ── */
  let active = null;      // the tween currently writing tokens

  function stream(idx) {
    const p = PROMPTS[idx];
    if (!p) return;

    /* A new prompt interrupts the one in flight rather than being swallowed —
       waiting out someone else's answer before you can ask yours is not how a
       playground should behave. */
    if (active) { active.kill(); active = null; }
    buttons.forEach((b) => b.classList.remove('busy'));
    buttons[idx]?.classList.add('busy');

    world?.field.burst(9);
    world?.post.glitch(0.3);

    respBody.innerHTML = `<span style="color:var(--dim)">&gt; ${esc(p.q)}</span>\n\n`;
    const head = respBody.innerHTML;

    // badges settle on this prompt's numbers
    gsap.to({ v: parseFloat(bLat.textContent) }, {
      v: p.lat, duration: 0.8, onUpdate() { bLat.textContent = Math.round(this.targets()[0].v); },
    });
    gsap.to({ v: parseFloat(bTps.textContent) }, {
      v: p.tps, duration: 0.8, onUpdate() { bTps.textContent = Math.round(this.targets()[0].v); },
    });

    const o = { n: 0 };
    active = gsap.to(o, {
      n: p.a.length,
      duration: p.a.length / (p.tps * 0.55),   // roughly honest to the stated rate
      ease: 'none',
      delay: p.lat / 1000 + 0.35,
      onUpdate: () => {
        const cut = Math.floor(o.n);
        respBody.innerHTML = head + esc(p.a.slice(0, cut)).replace(/\n/g, '<br/>') + '<span class="caret"></span>';
      },
      onComplete: () => {
        respBody.innerHTML = head + esc(p.a).replace(/\n/g, '<br/>');
        active = null;
        buttons.forEach((b) => b.classList.remove('busy'));
      },
    });
  }

  buttons.forEach((b) => {
    b.addEventListener('click', () => stream(parseInt(b.dataset.prompt, 10)));
  });

  // if the visitor jumps straight here, still run it
  ScrollTrigger.create({
    trigger: '.resp',
    start: 'top 75%',
    once: true,
    onEnter: () => { if (!typed) setTimeout(() => stream(0), 400); },
  });

  return { stream };
}

import gsap from 'gsap';
import { magnetize } from '../animations/cursor.js';
import { scramble } from '../animations/glitch.js';

/**
 * capabilities.js — the model grid.
 *
 * Cards are injected rather than authored so the filter can rebuild the grid
 * without the markup and the data drifting apart. The last card is the Lab: a
 * 2D hex vortex drawn on its own canvas, a flat echo of the WebGL tunnel the
 * visitor will fly through eight sections later.
 */

const CARDS = [
  {
    id: 'core7b', name: 'SINA-CORE-7B', tag: 'LANGUAGE MODEL', filter: 'language',
    desc: 'General intelligence, reasoning and instruction following.',
    metric: 'MMLU', value: '78.4', pct: 78,
  },
  {
    id: 'vision4', name: 'SINA-VISION-4', tag: 'VISION MODEL', filter: 'vision',
    desc: 'Multimodal image understanding and generation.',
    metric: 'VQA-V2', value: '91.2', pct: 91,
  },
  {
    id: 'embed512', name: 'SINA-EMBED-512', tag: 'EMBEDDINGS', filter: 'embed',
    desc: 'Semantic search, RAG pipelines, vector similarity.',
    metric: 'MTEB', value: '68.9', pct: 69,
  },
  {
    id: 'turbo', name: 'SINA-TURBO', tag: 'FAST INFERENCE', filter: 'realtime',
    desc: '200 tok/s, ultra-low latency for production apps.',
    metric: 'THROUGHPUT', value: '200 T/S', pct: 96,
  },
  {
    id: 'fine', name: 'SINA-FINE', tag: 'FINE-TUNING API', filter: 'tune',
    desc: 'Custom model training on your proprietary data.',
    metric: 'TIME TO PROD', value: '4 HRS', pct: 88,
  },
  {
    id: 'lab', name: 'SINA-LAB', tag: 'THE LAB', filter: 'all', lab: true,
    desc: 'Our home for experimental models and prototypes.',
    metric: 'STATUS', value: 'OPEN', pct: 100,
  },
];

function cardHTML(c, i) {
  const idx = String(i + 1).padStart(2, '0');
  return `
    <article class="card glass${c.lab ? ' lab-card' : ''}" data-filter="${c.filter}" data-id="${c.id}" data-cursor="${c.lab ? 'ENTER' : 'INSPECT'}">
      ${c.lab ? '<canvas class="c-hex"></canvas>' : ''}
      <i class="scanline"></i>
      <div class="c-top">
        <span class="c-idx">${idx} / 06</span>
        <span class="c-tag">${c.tag}</span>
      </div>
      <h3>${c.name}${c.lab ? ' <i style="font-style:normal;color:var(--teal)">→</i>' : ''}</h3>
      <p>${c.desc}</p>
      <div class="c-metric">
        <div class="m-top"><span>${c.metric}</span><b>${c.value}</b></div>
        <div class="meter"><i style="width:0%" data-pct="${c.pct}"></i></div>
      </div>
    </article>`;
}

/** The flat hex vortex on the Lab card — concentric rings receding to a point. */
function hexVortex(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, raf = 0, t = 0, visible = false;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const hexPath = (cx, cy, r, rot) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };

  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (!visible) return;
    t += 0.006;
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5, cy = h * 0.5;
    const maxR = Math.hypot(w, h) * 0.62;
    const RINGS = 13;

    for (let ring = RINGS; ring >= 1; ring--) {
      // each ring drifts inward, looping — the vortex
      const k = ((ring / RINGS) + t) % 1;
      const r = Math.pow(k, 2.1) * maxR;
      if (r < 3) continue;
      const cells = Math.max(6, Math.round(6 * k * 3.2));
      const alpha = Math.pow(k, 1.4) * 0.5;
      const hue = 168 + Math.sin(ring * 0.7 + t * 6) * 34;

      for (let i = 0; i < cells; i++) {
        const a = (i / cells) * Math.PI * 2 + t * 1.6 + ring * 0.22;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.92;
        const cellR = (maxR / RINGS) * 0.52 * (0.5 + k);
        const breathe = 1 + Math.sin(t * 14 + ring * 0.9 + i) * 0.08;

        hexPath(x, y, cellR * breathe, a + Math.PI / 6);
        ctx.strokeStyle = `hsla(${hue}, 90%, ${45 + k * 25}%, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = `hsla(${hue}, 95%, 60%, ${alpha * 0.10})`;
        ctx.fill();
      }
    }

    // the light at the centre
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.34);
    g.addColorStop(0, 'rgba(160,255,245,0.5)');
    g.addColorStop(0.4, 'rgba(10,245,200,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 })
    .observe(canvas);
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

export function initCapabilities({ world } = {}) {
  const grid = document.getElementById('cap-grid');
  if (!grid) return;

  grid.innerHTML = CARDS.map(cardHTML).join('');

  const cards = [...grid.querySelectorAll('.card')];

  // meters fill when the card is on screen
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const bar = e.target.querySelector('.meter i');
      if (bar) gsap.to(bar, { width: `${bar.dataset.pct}%`, duration: 1.6, ease: 'power3.out' });
      io.unobserve(e.target);
    });
  }, { threshold: 0.35 });
  cards.forEach((c) => io.observe(c));

  // magnetic tilt on every card
  cards.forEach((c) => magnetize(c, { strength: 0.10, radius: 60, tilt: 6 }));

  // the Lab card's vortex
  const hexCanvas = grid.querySelector('.c-hex');
  if (hexCanvas) hexVortex(hexCanvas);

  /* ── filtering ── */
  const buttons = [...document.querySelectorAll('.filt')];
  let current = 'all';

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (f === current) return;
      current = f;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      scramble(btn, btn.dataset.text || btn.textContent.trim(), { duration: 0.4, stagger: 0.2, className: '' });
      world?.post.glitch(0.6);
      world?.field.burst(10);

      cards.forEach((card, i) => {
        const show = f === 'all' || card.dataset.filter === f || card.dataset.id === 'lab';
        gsap.killTweensOf(card);

        if (show) {
          card.style.display = '';
          gsap.fromTo(card,
            { opacity: 0, x: gsap.utils.random(-24, 24), filter: 'blur(6px)' },
            {
              opacity: 1, x: 0, filter: 'blur(0px)',
              duration: 0.5, delay: i * 0.04, ease: 'power2.out',
              clearProps: 'filter',
            });
          // the jitter that sells the switch
          gsap.fromTo(card, { skewX: gsap.utils.random(-8, 8) }, { skewX: 0, duration: 0.35, ease: 'power3.out' });
        } else {
          gsap.to(card, {
            opacity: 0, x: gsap.utils.random(-30, 30), filter: 'blur(8px)',
            duration: 0.24, ease: 'power2.in',
            onComplete: () => { card.style.display = 'none'; },
          });
        }
      });
    });
  });

  buttons.forEach((b) => { b.dataset.text = b.textContent.trim(); });
}

import gsap from 'gsap';

/**
 * models.js — the horizontal deep-dive.
 *
 * Each model gets a rotating wireframe solid. These are *not* extra WebGL
 * contexts: the site runs exactly one, so the glyphs are real 3D geometry
 * projected to SVG line coordinates on the ticker. Five solids, one shared
 * projector, and they pause the moment they leave the viewport.
 */

const MODELS = [
  {
    idx: '01', name: 'SINA-CORE-7B', params: '7B PARAMETERS', glyph: 'icosa',
    use: 'REASONING · CHAT · INSTRUCTION FOLLOWING',
    bench: [['MMLU', '78.4'], ['GSM8K', '82.1'], ['HUMANEVAL', '71.3']],
  },
  {
    idx: '02', name: 'SINA-CORE-70B', params: '70B PARAMETERS', glyph: 'sphere',
    use: 'COMPLEX REASONING · LONG-FORM · RESEARCH',
    bench: [['MMLU', '86.2'], ['GSM8K', '93.4'], ['HUMANEVAL', '84.0']],
  },
  {
    idx: '03', name: 'SINA-VISION-4', params: '14B PARAMETERS', glyph: 'cube',
    use: 'IMAGE UNDERSTANDING · OCR · VISUAL QA',
    bench: [['VQA-V2', '91.2'], ['DOCVQA', '88.7'], ['CHARTQA', '79.5']],
  },
  {
    idx: '04', name: 'SINA-EMBED-512', params: '512M PARAMETERS', glyph: 'torus',
    use: 'EMBEDDINGS · SEMANTIC SEARCH · RAG',
    bench: [['MTEB', '68.9'], ['BEIR', '54.2'], ['LATENCY', '4 MS']],
  },
  {
    idx: '05', name: 'SINA-TURBO', params: '3B PARAMETERS', glyph: 'octa',
    use: 'ULTRA-FAST · REAL-TIME APPLICATIONS',
    bench: [['TOK/SEC', '200'], ['TTFT', '12 MS'], ['MMLU', '62.7']],
  },
];

/* ── solids: [vertices, edges] in unit space ───────────────────── */

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => p.map((c) => c / 1.9));
  const e = [];
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]);
      if (d < 1.15) e.push([i, j]);
    }
  }
  return [v, e];
}

function cube() {
  const v = [];
  for (let i = 0; i < 8; i++) v.push([(i & 1 ? 1 : -1) * 0.62, (i & 2 ? 1 : -1) * 0.62, (i & 4 ? 1 : -1) * 0.62]);
  const e = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const diff = (i ^ j);
    if (diff === 1 || diff === 2 || diff === 4) e.push([i, j]);
  }
  return [v, e];
}

function octahedron() {
  const s = 0.92;
  const v = [[s, 0, 0], [-s, 0, 0], [0, s, 0], [0, -s, 0], [0, 0, s], [0, 0, -s]];
  const e = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    if (i + j !== 1 && i + j !== 5 && !(i === 2 && j === 3) && !(i === 4 && j === 5)) e.push([i, j]);
  }
  return [v, e];
}

function torus(seg = 16, ring = 8) {
  const v = [], e = [];
  const R = 0.62, r = 0.24;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    for (let j = 0; j < ring; j++) {
      const b = (j / ring) * Math.PI * 2;
      v.push([(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)]);
      const cur = i * ring + j;
      e.push([cur, i * ring + ((j + 1) % ring)]);
      e.push([cur, ((i + 1) % seg) * ring + j]);
    }
  }
  return [v, e];
}

function sphere(lat = 7, lon = 12) {
  const v = [], e = [];
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI;
    for (let j = 0; j < lon; j++) {
      const ph = (j / lon) * Math.PI * 2;
      v.push([Math.sin(th) * Math.cos(ph) * 0.88, Math.cos(th) * 0.88, Math.sin(th) * Math.sin(ph) * 0.88]);
      const cur = i * lon + j;
      if (j < lon) e.push([cur, i * lon + ((j + 1) % lon)]);
      if (i < lat) e.push([cur, (i + 1) * lon + j]);
    }
  }
  return [v, e];
}

const SOLIDS = { icosa: icosahedron, cube, octa: octahedron, torus, sphere };

/** Build an SVG wireframe and return its per-frame updater. */
function makeGlyph(kind, color) {
  const [verts, edges] = SOLIDS[kind]();
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-1.4 -1.4 2.8 2.8');
  svg.setAttribute('class', 'm-glyph');

  const g = document.createElementNS(NS, 'g');
  svg.appendChild(g);

  const lines = edges.map(() => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', '0.012');
    l.setAttribute('stroke-linecap', 'round');
    g.appendChild(l);
    return l;
  });

  const dots = verts.map(() => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', '0.026');
    c.setAttribute('fill', color);
    g.appendChild(c);
    return c;
  });

  const proj = new Array(verts.length);

  const update = (t) => {
    const ax = t * 0.32, ay = t * 0.47;
    const ca = Math.cos(ax), sa = Math.sin(ax);
    const cb = Math.cos(ay), sb = Math.sin(ay);

    for (let i = 0; i < verts.length; i++) {
      let [x, y, z] = verts[i];
      // rotate X then Y
      let y1 = y * ca - z * sa, z1 = y * sa + z * ca;
      let x2 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb;
      const persp = 2.6 / (2.6 + z2);
      proj[i] = [x2 * persp, y1 * persp, z2];
    }

    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = proj[a], pb = proj[b];
      const l = lines[i];
      l.setAttribute('x1', pa[0].toFixed(4));
      l.setAttribute('y1', pa[1].toFixed(4));
      l.setAttribute('x2', pb[0].toFixed(4));
      l.setAttribute('y2', pb[1].toFixed(4));
      // depth-cued opacity: the far side of the solid recedes
      const depth = (pa[2] + pb[2]) * 0.5;
      l.setAttribute('opacity', (0.22 + (1 - (depth + 1) / 2) * 0.78).toFixed(3));
    }
    for (let i = 0; i < dots.length; i++) {
      const p = proj[i];
      dots[i].setAttribute('cx', p[0].toFixed(4));
      dots[i].setAttribute('cy', p[1].toFixed(4));
      dots[i].setAttribute('opacity', (0.25 + (1 - (p[2] + 1) / 2) * 0.75).toFixed(3));
    }
  };

  return { svg, update };
}

export function initModels({ world } = {}) {
  const track = document.getElementById('h-track');
  if (!track) return;

  const glyphs = [];

  MODELS.forEach((m) => {
    const panel = document.createElement('div');
    panel.className = 'h-panel h-model glass';
    panel.dataset.cursor = 'TRY';
    panel.innerHTML = `
      <i class="scanline"></i>
      <div class="m-head">
        <span class="m-idx">${m.idx} / 05</span>
        <h3>${m.name}</h3>
        <span class="m-params">${m.params}</span>
      </div>
      <div class="m-mid"></div>
      <div class="m-foot">
        <div class="m-bench">
          ${m.bench.map(([k, v]) => `<div class="bh"><span>${k}</span><b>${v}</b></div>`).join('')}
        </div>
        <div class="m-use">${m.use}</div>
        <a href="#api" class="btn sm" data-cursor="RUN"><span>TRY IT</span><i>→</i></a>
      </div>`;

    const glyph = makeGlyph(m.glyph, '#0af5c8');
    panel.querySelector('.m-mid').appendChild(glyph.svg);
    track.appendChild(panel);
    glyphs.push({ ...glyph, panel, visible: false });
  });

  // only spin what is on screen
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const g = glyphs.find((x) => x.panel === e.target);
      if (g) g.visible = e.isIntersecting;
    });
  }, { threshold: 0.02 });
  glyphs.forEach((g) => io.observe(g.panel));

  gsap.ticker.add((time) => {
    for (const g of glyphs) if (g.visible) g.update(time);
  });

  return glyphs;
}

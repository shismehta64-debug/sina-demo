/**
 * genome.js — THE SINA MARK, AS DATA.
 *
 * The SINA logo is not a picture on this site. It is a data structure.
 * Everything downstream is generated from it:
 *   · the preloader SVG that draws itself
 *   · the 3D synapse object in the hero
 *   · the reactor's containment core
 *   · the attractor targets that 260k GPU particles morph into
 *   · the accent palette (read straight off the mark's own gradient)
 *
 * Space: unit-ish, y-up, hub at origin. Traced from SINA.png.
 */

/** Satellite + hub nodes. `ring` = hollow torus, `dot` = solid sphere. */
export const NODES = [
  { id: 'hub', x:  0.000, y:  0.000, z:  0.00, r: 0.070, type: 'dot',  color: 0x5b8fd0, glow: 1.00 },
  { id: 'a',   x:  0.000, y:  0.620, z:  0.10, r: 0.108, type: 'ring', color: 0x23c9d9, glow: 1.00 },
  { id: 'b',   x: -0.440, y:  0.380, z: -0.14, r: 0.104, type: 'ring', color: 0x1c9fc4, glow: 0.85 },
  { id: 'c',   x:  0.420, y:  0.390, z:  0.16, r: 0.104, type: 'ring', color: 0x4a97d6, glow: 0.85 },
  { id: 'd',   x:  0.440, y: -0.010, z: -0.08, r: 0.088, type: 'ring', color: 0x8b93dc, glow: 0.70 },
  { id: 'e',   x: -0.420, y:  0.000, z:  0.12, r: 0.052, type: 'dot',  color: 0x14468a, glow: 0.45 },
  { id: 'f',   x: -0.240, y: -0.270, z: -0.18, r: 0.052, type: 'dot',  color: 0x0d2e63, glow: 0.40 },
];

export const NODE = Object.fromEntries(NODES.map((n) => [n.id, n]));

/**
 * Edges as polylines. Note: only `a` and `c` actually reach the hub — in the
 * source mark the other three links stop short. That asymmetry is the whole
 * character of the logo, so we keep it. `live` edges carry synaptic pulses.
 */
export const EDGES = [
  { id: 'ha', live: true,  from: 'hub', to: 'a', pts: [[0.000, 0.075], [0.000, 0.508]] },
  { id: 'hc', live: true,  from: 'hub', to: 'c', pts: [[0.050, 0.048], [0.344, 0.314]] },
  { id: 'be', live: false, from: 'b',   to: null, pts: [[-0.366, 0.312], [-0.300, 0.222], [-0.110, 0.222]] },
  { id: 'de', live: false, from: 'd',   to: null, pts: [[0.352, -0.010], [0.180, -0.010]] },
  { id: 'ee', live: false, from: 'e',   to: null, pts: [[-0.420, 0.000], [-0.120, 0.000]] },
  { id: 'fe', live: false, from: 'f',   to: null, pts: [[-0.240, -0.270], [-0.120, -0.150]] },
];

/** Depth of an edge = lerp of its endpoints' z, so 3D tubes meet their nodes. */
export function edgeZ(edge, t) {
  const za = (NODE[edge.from] || NODE.hub).z;
  const zb = (NODE[edge.to] || NODE.hub).z;
  return za + (zb - za) * t;
}

/* ────────────────────────── palette (read off the mark) ───────────────────── */

export const PALETTE = {
  bg: 0x040a0f,
  teal: 0x0af5c8,
  cyan: 0x23c9d9,
  blue: 0x1a6cff,
  violet: 0x8b5cf6,
  amber: 0xf59e0b,
  white: 0xe8f4f8,
  deep: 0x0d2e63,
};

/* ────────────────────────── SVG construction ──────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

/**
 * Render the mark into an <svg viewBox="-1 -1 2 2">. Returns every stroked
 * path so the preloader can draw them in with stroke-dashoffset.
 * Note the y-flip: our data is y-up, SVG is y-down.
 */
export function buildMarkSVG(svg, { stroke = 0.055, scale = 1.25, gradient = true } = {}) {
  svg.innerHTML = '';
  const drawables = [];

  if (gradient) {
    const defs = el('defs', {});
    const grad = el('linearGradient', { id: `sina-g-${Math.random().toString(36).slice(2, 7)}`, x1: '0', y1: '1', x2: '1', y2: '0' });
    [['0%', '#0d2e63'], ['35%', '#1a6cff'], ['70%', '#23c9d9'], ['100%', '#0af5c8']].forEach(([o, c]) => {
      grad.appendChild(el('stop', { offset: o, 'stop-color': c }));
    });
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.dataset.grad = `url(#${grad.id})`;
  }

  const paint = svg.dataset.grad || 'currentColor';
  const g = el('g', { transform: `scale(${scale} ${-scale}) translate(0 -0.16)` });
  svg.appendChild(g);

  // edges first, so nodes sit on top
  for (const e of EDGES) {
    const d = e.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join(' ');
    const path = el('path', {
      d, fill: 'none', stroke: paint, 'stroke-width': stroke,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    path.dataset.kind = 'edge';
    g.appendChild(path);
    drawables.push(path);
  }

  for (const n of NODES) {
    let node;
    if (n.type === 'ring') {
      node = el('circle', { cx: n.x, cy: n.y, r: n.r, fill: 'none', stroke: paint, 'stroke-width': stroke });
    } else {
      node = el('circle', { cx: n.x, cy: n.y, r: n.r, fill: paint, stroke: paint, 'stroke-width': stroke * 0.5 });
    }
    node.dataset.kind = 'node';
    node.dataset.id = n.id;
    g.appendChild(node);
    drawables.push(node);
  }

  return drawables;
}

/* ────────────────────────── point sampling (for particles) ────────────────── */

function hash(i) {
  let x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Sample `count` points across the whole mark — rings, dots and edges — with
 * a little volumetric jitter so the formation reads as a solid object rather
 * than a flat decal. Written into `out` as xyz triples.
 *
 * Weighting is by "ink": rings by circumference, edges by length, dots by area.
 */
export function sampleMark(count, out, { scale = 1, jitter = 0.012, depth = 1 } = {}) {
  const pieces = [];
  let total = 0;

  for (const n of NODES) {
    const w = n.type === 'ring' ? 2 * Math.PI * n.r : Math.PI * n.r * n.r * 3.2;
    pieces.push({ kind: n.type, n, w });
    total += w;
  }
  for (const e of EDGES) {
    let len = 0;
    for (let i = 1; i < e.pts.length; i++) {
      const dx = e.pts[i][0] - e.pts[i - 1][0];
      const dy = e.pts[i][1] - e.pts[i - 1][1];
      len += Math.hypot(dx, dy);
    }
    pieces.push({ kind: 'edge', e, w: len * 0.9, len });
    total += len * 0.9;
  }

  let idx = 0;
  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    const share = p === pieces.length - 1 ? count - idx : Math.round((piece.w / total) * count);

    for (let k = 0; k < share && idx < count; k++, idx++) {
      const i3 = idx * 3;
      const r1 = hash(idx * 3.13 + p), r2 = hash(idx * 7.77 + p * 2.1), r3 = hash(idx * 1.37 + p * 5.5);
      let x, y, z;

      if (piece.kind === 'ring') {
        const n = piece.n;
        const a = r1 * Math.PI * 2;
        const rr = n.r + (r2 - 0.5) * 0.028;
        x = n.x + Math.cos(a) * rr;
        y = n.y + Math.sin(a) * rr;
        z = n.z * depth + (r3 - 0.5) * 0.05;
      } else if (piece.kind === 'dot') {
        const n = piece.n;
        const a = r1 * Math.PI * 2;
        const rr = Math.sqrt(r2) * n.r * 1.15;
        x = n.x + Math.cos(a) * rr;
        y = n.y + Math.sin(a) * rr;
        z = n.z * depth + (r3 - 0.5) * n.r * 1.6;
      } else {
        const e = piece.e;
        const t = r1;
        // walk the polyline to find the point at fraction t
        let want = t * piece.len, x0 = e.pts[0][0], y0 = e.pts[0][1];
        for (let i = 1; i < e.pts.length; i++) {
          const dx = e.pts[i][0] - e.pts[i - 1][0];
          const dy = e.pts[i][1] - e.pts[i - 1][1];
          const seg = Math.hypot(dx, dy);
          if (want <= seg || i === e.pts.length - 1) {
            const f = seg > 0 ? want / seg : 0;
            x0 = e.pts[i - 1][0] + dx * f;
            y0 = e.pts[i - 1][1] + dy * f;
            break;
          }
          want -= seg;
        }
        x = x0 + (r2 - 0.5) * 0.03;
        y = y0 + (r2 - 0.5) * 0.03;
        z = edgeZ(e, t) * depth + (r3 - 0.5) * 0.05;
      }

      out[i3 + 0] = (x + (hash(idx * 11.1) - 0.5) * jitter) * scale;
      out[i3 + 1] = (y + (hash(idx * 13.3) - 0.5) * jitter) * scale;
      out[i3 + 2] = (z + (hash(idx * 17.7) - 0.5) * jitter) * scale;
    }
  }

  // any remainder (rounding) → collapse onto the hub
  for (; idx < count; idx++) {
    const i3 = idx * 3;
    out[i3] = 0; out[i3 + 1] = 0; out[i3 + 2] = 0;
  }
  return out;
}

/** Colour for a sampled point, by nearest node — gives the formation the logo's gradient. */
export function markColorAt(x, y) {
  let best = NODES[0], bd = Infinity;
  for (const n of NODES) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best.color;
}

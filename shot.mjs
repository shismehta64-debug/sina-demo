import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

// capture by SECTION, so each frame answers "does the world match the copy?"
const SHOTS = [
  ['00-hero',         'hero',         0.35],
  ['01-manifesto',    'about',        0.45],
  ['02-capabilities', 'capabilities', 0.50],
  ['03-reactor',      'reactor',      0.45],
  ['04-api',          'api',          0.40],
  ['05-pricing',      'pricing',      0.40],
  ['06-models',       'models',       0.30],
  ['07-lab',          'lab',          0.45],
  ['08-proof',        'proof',        0.45],
  ['09-contact',      'contact',      0.35],
];

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1600,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  ! pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  ! console:', m.text()); });

const tier = process.argv[2] || 'high';
console.log('loading (tier=' + tier + ') ...');
await page.goto(`http://localhost:5173/?tier=${tier}`, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction('window.SINA && window.SINA.world', { timeout: 60000 });

const info = await page.evaluate(() => {
  const gl = SINA.world.stage.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a', tier: SINA.world.tierName, particles: SINA.world.field.count };
});
console.log('  gpu:', info.renderer);
console.log('  tier:', info.tier, '| particles:', info.particles.toLocaleString());

// skip the preloader; we are documenting the world, not the boot
await page.evaluate(() => {
  const pre = document.getElementById('preloader');
  if (pre) pre.style.display = 'none';
  document.body.classList.remove('is-loading');
  SINA.world.setFade(1);
  document.querySelectorAll('#nav,#hud,#progress').forEach(e => { e.style.opacity = 1; e.style.transform = 'none'; });
  SINA.gsap.globalTimeline.progress(1);   // land every entrance animation
});

for (const [name, id, frac] of SHOTS) {
  const t0 = Date.now();
  await page.evaluate((id, frac) => {
    const el = document.getElementById(id);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const into = Math.max(0, el.offsetHeight - innerHeight) * frac;
    SINA.lenis.scrollTo(top + into, { immediate: true, force: true });
    SINA.ScrollTrigger.update();
  }, id, frac);
  // let the simulation actually reach the formation
  await new Promise(r => setTimeout(r, 4500));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const st = await page.evaluate(() => ({
    doc: +(scrollY / (document.documentElement.scrollHeight - innerHeight)).toFixed(3),
    t: +SINA.world.progress.toFixed(3),
    sector: document.getElementById('hud-sector').textContent,
  }));
  console.log(`  ✓ ${name.padEnd(16)} doc=${st.doc}  journey=${st.t}  sector=${st.sector}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const fps = await page.evaluate(() => SINA.world.stage.fps || null);
console.log('fps in capture env:', fps);
await browser.close();
console.log('done →', OUT);

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
mkdirSync('shots', { recursive: true });
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await b.newPage();
await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1, hasTouch: true });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.SINA && window.SINA.world');
await new Promise(r => setTimeout(r, 7000));
const info = await page.evaluate(() => ({
  tier: SINA.world.tierName, particles: SINA.world.field.count,
  post: SINA.world.post.enabled, dpr: SINA.world.stage.renderer.getPixelRatio(),
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
  scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
  cursorHidden: getComputedStyle(document.getElementById('cursor-ring')).display === 'none',
  hudHidden: getComputedStyle(document.getElementById('hud')).display === 'none',
}));
console.log(JSON.stringify(info, null, 1));
for (const [name, id] of [['m-hero','hero'],['m-caps','capabilities'],['m-reactor','reactor'],['m-pricing','pricing'],['m-contact','contact']]) {
  await page.evaluate((id) => SINA.lenis.scrollTo(document.getElementById(id), { immediate: true }), id);
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: `shots/${name}.png` });
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();

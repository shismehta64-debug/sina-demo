import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
mkdirSync('shots', { recursive: true });

const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await b.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (n, v) => console.log(`  ${v === true ? '✓' : v ? '✓' : '✗'} ${n}${v === true ? '' : '  -> ' + JSON.stringify(v)}`);

console.log('\n-- PRELOADER (not skipped) --');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.SINA');
await wait(900);
ok('preloader visible early', await page.evaluate(() => getComputedStyle(document.getElementById('preloader')).display !== 'none'));
ok('mark strokes drawing', await page.evaluate(() => {
  const els = document.querySelectorAll('#pre-mark [data-kind]');
  return [...els].some((e) => parseFloat(e.style.strokeDashoffset) < 1);
}));
await page.screenshot({ path: 'shots/preloader.png' });
await wait(6500);
ok('preloader dismissed', await page.evaluate(() => getComputedStyle(document.getElementById('preloader')).display === 'none'));
ok('body scroll released', await page.evaluate(() => !document.body.classList.contains('is-loading')));
ok('hero chars revealed', await page.evaluate(() => {
  const c = window.__heroChars || [];
  return c.length > 0 && getComputedStyle(c[0]).opacity === '1';
}));
ok('hero tag resolved', await page.evaluate(() => document.getElementById('hero-tag').textContent.includes('CREATIVE')));
ok('world faded in', await page.evaluate(() => SINA.world.post.matComposite.uniforms.uFade.value > 0.98));

console.log('\n-- CAPABILITY FILTER --');
await page.evaluate(() => SINA.lenis.scrollTo(document.getElementById('capabilities'), { immediate: true }));
await wait(800);
const before = await page.evaluate(() => [...document.querySelectorAll('.cap-grid .card')].filter((c) => c.style.display !== 'none').length);
await page.click('.filt[data-filter="vision"]');
await wait(1000);
const after = await page.evaluate(() => [...document.querySelectorAll('.cap-grid .card')].filter((c) => c.style.display !== 'none').length);
ok('filter narrows ' + before + ' -> ' + after, before === 6 && after === 2);
ok('filter marked active', await page.evaluate(() => document.querySelector('.filt[data-filter="vision"]').classList.contains('active')));
await page.click('.filt[data-filter="all"]');
await wait(1000);
ok('filter restores all', await page.evaluate(() => [...document.querySelectorAll('.cap-grid .card')].filter((c) => c.style.display !== 'none').length === 6));

console.log('\n-- REACTOR SLIDER --');
await page.evaluate(() => SINA.lenis.scrollTo(document.getElementById('reactor'), { immediate: true }));
await wait(900);
const pw = await page.evaluate(() => {
  const s = document.getElementById('core-power');
  const p0 = SINA.world.field.uniforms.uPower.value;
  s.value = 95; s.dispatchEvent(new Event('input'));
  const p1 = SINA.world.field.uniforms.uPower.value;
  return { p0: +p0.toFixed(3), p1: +p1.toFixed(3), label: document.getElementById('core-power-val').textContent };
});
ok('slider drives simulation ' + JSON.stringify(pw), pw.p1 > pw.p0);
ok('telemetry log running', await page.evaluate(() => document.getElementById('reactor-readout').textContent.length > 20));

console.log('\n-- API STREAM --');
await page.evaluate(() => SINA.lenis.scrollTo(document.getElementById('api'), { immediate: true }));
await wait(5200);
ok('code typed in', await page.evaluate(() => document.getElementById('code-block').textContent.length > 400));
ok('syntax highlighted', await page.evaluate(() => document.querySelectorAll('#code-block .t-key').length > 3));
await page.click('.pbtn[data-prompt="1"]');
await wait(3500);
ok('second prompt streamed', await page.evaluate(() => document.getElementById('resp-body').textContent.includes('Weights')));

console.log('\n-- CONTACT FORM --');
await page.evaluate(() => SINA.lenis.scrollTo(document.getElementById('contact'), { immediate: true }));
await wait(900);
await page.click('#cform button[type=submit]');
await wait(500);
ok('rejects empty', await page.evaluate(() => document.getElementById('cf-out').textContent.startsWith('!')));
await page.type('#cform [name=email]', 'nope');
await page.click('#cform button[type=submit]');
await wait(400);
ok('rejects bad email', await page.evaluate(() => document.getElementById('cf-out').textContent.includes('INVALID')));
await page.evaluate(() => { document.querySelector('#cform [name=email]').value = 'a@b.co'; });
await page.type('#cform [name=usecase]', 'realtime inference for our app');
await page.click('#cform button[type=submit]');
await wait(3200);
ok('accepts valid, honest about backend', await page.evaluate(() => document.getElementById('cf-out').textContent));

console.log('\n-- CONSOLE --');
await page.keyboard.press('Backquote');
await wait(900);
ok('console opens', await page.evaluate(() => document.getElementById('console').getAttribute('aria-hidden') === 'false'));
const run = async (cmd) => {
  await page.focus('#con-input');
  await page.type('#con-input', cmd);
  await page.keyboard.press('Enter');
  await wait(500);
};
await run('help');
ok('help lists commands', await page.evaluate(() => document.getElementById('con-log').textContent.includes('turbo')));
await run('form garden');
ok('form pins formation', await page.evaluate(() => SINA.world.formOverride === 5));
await run('form auto');
ok('form auto releases', await page.evaluate(() => SINA.world.formOverride === null));
await run('power 80');
ok('power moves the real slider', await page.evaluate(() => document.getElementById('core-power').value === '80'));
await run('palette a #ff00aa');
ok('palette repaints field', await page.evaluate(() => SINA.world.field.renderUniforms.uColA.value.getHexString() === 'ff00aa'));
await run('reset');
ok('reset restores palette', await page.evaluate(() => SINA.world.field.renderUniforms.uColA.value.getHexString() === '0af5c8'));
await run('stats');
ok('stats reports live data', await page.evaluate(() => /particles\s+2/.test(document.getElementById('con-log').textContent)));
await run('bogus');
ok('unknown command handled', await page.evaluate(() => document.getElementById('con-log').textContent.includes('unknown command')));
await page.screenshot({ path: 'shots/console.png' });
await page.keyboard.press('Escape');
await wait(700);
ok('console closes', await page.evaluate(() => document.getElementById('console').getAttribute('aria-hidden') === 'true'));

console.log('\n-- ERRORS --');
console.log(errors.length ? errors.join('\n') : '  none');
await b.close();

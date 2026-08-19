import gsap from 'gsap';

/**
 * console.js — a real shell into the running world.
 *
 * Press ` or ~ anywhere on the page. Commands reach straight into the live
 * simulation: force a particle formation, overdrive the reactor, warp the
 * camera, repaint the field. It is an easter egg, but it is not a prop —
 * every command mutates the actual scene.
 */

const FORMS = ['mark', 'nebula', 'graph', 'core', 'stream', 'garden'];

const BANNER = [
  '   ▄▄▄  ▄  ▄   ▄  ▄▄▄ ',
  '  █     █  ██  █ █   █   SINA://SYSTEM-SHELL',
  '   ▀▀█  █  █ █ █ █▀▀▀█   neural core v4.2',
  '  ▄▄▄▀  ▀  ▀  ▀▀ ▀   ▀   type HELP for commands',
];

export function initConsole({ world, lenis } = {}) {
  const panel = document.getElementById('console');
  const logEl = document.getElementById('con-log');
  const input = document.getElementById('con-input');
  if (!panel) return;

  let open = false;
  const history = [];
  let histIdx = -1;

  const write = (text, cls = '') => {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  BANNER.forEach((l) => write(l, 'l-dim'));

  const toggle = (force) => {
    open = force ?? !open;
    gsap.to(panel, {
      y: open ? 0 : '105%',
      xPercent: -50,
      duration: 0.55,
      ease: open ? 'power3.out' : 'power3.in',
    });
    panel.setAttribute('aria-hidden', String(!open));
    if (open) {
      input.focus();
      lenis?.stop();
      world?.post.glitch(0.5);
    } else {
      input.blur();
      lenis?.start();
    }
  };

  window.addEventListener('keydown', (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName || '');
    if ((e.key === '`' || e.key === '~') && (!typing || document.activeElement === input)) {
      e.preventDefault();
      toggle();
      return;
    }
    if (e.key === 'Escape' && open) { e.preventDefault(); toggle(false); }
    if (open && document.activeElement === input) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        histIdx = Math.min(histIdx + 1, history.length - 1);
        input.value = history[history.length - 1 - histIdx] || '';
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        histIdx = Math.max(histIdx - 1, -1);
        input.value = histIdx < 0 ? '' : history[history.length - 1 - histIdx];
      }
    }
  });

  const COMMANDS = {
    help() {
      write('COMMANDS', 'l-ok');
      [
        'power <0-100>      reactor output — moves the real slider',
        'form <name|auto>   force a particle formation',
        '                   ' + FORMS.join(' · '),
        'burst [force]      detonate the field',
        'warp <section>     fly the camera to a sector',
        'glitch [0-1]       punch the glitch bus',
        'palette <a|b|c> #hex   repaint the field',
        'size <0.5-5>       particle size',
        'turbo              everything, at once',
        'stats              live render telemetry',
        'reset              back to defaults',
        'clear              wipe this log',
      ].forEach((l) => write('  ' + l, 'l-dim'));
    },

    power(arg) {
      const v = Math.max(0, Math.min(100, parseFloat(arg)));
      if (Number.isNaN(v)) return write('power: need a number 0-100', 'l-err');
      const slider = document.getElementById('core-power');
      if (slider) { slider.value = v; slider.dispatchEvent(new Event('input')); }
      else world?.setPower(0.12 + (v / 100) * 1.05);
      write(`reactor output → ${v}%`, 'l-ok');
    },

    form(arg) {
      if (!arg || arg === 'auto') {
        world.formOverride = null;
        return write('formation → scroll-driven', 'l-ok');
      }
      const i = FORMS.indexOf(arg.toLowerCase());
      if (i < 0) return write(`form: unknown "${arg}" — try ${FORMS.join(', ')}`, 'l-err');
      world.formOverride = i;
      world.post.glitch(0.6);
      write(`formation → ${FORMS[i].toUpperCase()} (locked; "form auto" to release)`, 'l-ok');
    },

    burst(arg) {
      const f = parseFloat(arg) || 30;
      world?.burst(f);
      write(`detonation @ ${f}`, 'l-ok');
    },

    warp(arg) {
      const id = (arg || '').replace('#', '');
      const el = document.getElementById(id);
      if (!el) return write(`warp: no sector "${arg}"`, 'l-err');
      world?.post.glitch(0.9);
      lenis?.start();
      lenis?.scrollTo(el, { duration: 2.4 });
      toggle(false);
      write(`warping → ${id}`, 'l-ok');
    },

    glitch(arg) {
      const v = arg ? parseFloat(arg) : 1;
      world?.post.glitch(Math.max(0, Math.min(1, v)));
      write(`glitch bus ← ${v}`, 'l-ok');
    },

    palette(slot, hex) {
      const map = { a: 'uColA', b: 'uColB', c: 'uColC', hot: 'uColHot' };
      const key = map[(slot || '').toLowerCase()];
      if (!key || !/^#?[0-9a-f]{6}$/i.test(hex || '')) {
        return write('palette: usage → palette a #0af5c8', 'l-err');
      }
      world.field.renderUniforms[key].value.set(hex.startsWith('#') ? hex : `#${hex}`);
      write(`palette ${slot} → ${hex}`, 'l-ok');
    },

    size(arg) {
      const v = Math.max(0.3, Math.min(6, parseFloat(arg)));
      if (Number.isNaN(v)) return write('size: need a number', 'l-err');
      world.field.renderUniforms.uSize.value = v;
      write(`particle size → ${v}`, 'l-ok');
    },

    turbo() {
      world.field.renderUniforms.uSize.value = 3.2;
      world.field.uniforms.uTurb.value = 4.5;
      world.setPower(1.3);
      world.post.matComposite.uniforms.uBloom.value = 2.4;
      world.burst(60);
      write('TURBO — the containment engineers did not approve this', 'l-ok');
    },

    stats() {
      const s = world.stage;
      write(`fps          ${(s.fps || 0).toFixed(1)}`, 'l-dim');
      write(`tier         ${world.tierName}`, 'l-dim');
      write(`render scale ${s.renderScale.toFixed(2)}`, 'l-dim');
      write(`particles    ${world.field.count.toLocaleString()}`, 'l-dim');
      write(`sim texture  ${world.field.size}²`, 'l-dim');
      write(`post         ${world.post.enabled ? 'on' : 'off'}`, 'l-dim');
      write(`progress     ${(world.progress * 100).toFixed(1)}%`, 'l-dim');
      write(`camera       ${world.stage.camera.position.toArray().map((n) => n.toFixed(1)).join(', ')}`, 'l-dim');
    },

    reset() {
      world.formOverride = null;
      world.field.renderUniforms.uSize.value = 1.55;
      world.post.matComposite.uniforms.uBloom.value = 1.15;
      world.field.setPalette({ a: '#0af5c8', b: '#1a6cff', c: '#8b5cf6', hot: '#e8f4f8' });
      const slider = document.getElementById('core-power');
      if (slider) { slider.value = 55; slider.dispatchEvent(new Event('input')); }
      write('defaults restored', 'l-ok');
    },

    clear() { logEl.innerHTML = ''; },

    sina() {
      BANNER.forEach((l) => write(l, 'l-ok'));
      write('  "we build models that do not just answer."', 'l-dim');
    },
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const raw = input.value.trim();
    input.value = '';
    if (!raw) return;
    history.push(raw);
    histIdx = -1;
    write(`> ${raw}`, 'l-in');

    const [cmd, ...args] = raw.split(/\s+/);
    const fn = COMMANDS[cmd.toLowerCase()];
    if (!fn) {
      write(`unknown command: ${cmd} — try HELP`, 'l-err');
      world?.post.glitch(0.4);
      return;
    }
    try { fn(...args); } catch (err) { write(String(err), 'l-err'); }
  });

  return { toggle, write };
}

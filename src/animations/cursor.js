import gsap from 'gsap';

/**
 * cursor.js — a two-body cursor.
 *
 * The dot tracks the pointer exactly; the ring chases it on a spring, so fast
 * movement stretches the pair apart and rest snaps them concentric. Hovering
 * anything interactive swells the ring and prints a verb inside it.
 */

export function initCursor({ onClick } = {}) {
  const ring = document.getElementById('cursor-ring');
  const dot = document.getElementById('cursor-dot');
  const label = document.getElementById('cursor-label');
  if (!ring || !dot) return null;
  if (window.matchMedia('(pointer: coarse)').matches) return null;

  const state = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const ringPos = { x: state.x, y: state.y };
  let scale = 1;
  let targetScale = 1;
  let shown = false;

  const setRing = gsap.quickSetter(ring, 'css');
  const setDot = gsap.quickSetter(dot, 'css');

  window.addEventListener('mousemove', (e) => {
    state.x = e.clientX;
    state.y = e.clientY;
    if (!shown) {
      shown = true;
      gsap.to([ring, dot], { opacity: 1, duration: 0.4 });
    }
  }, { passive: true });

  window.addEventListener('mousedown', () => { targetScale = 0.62; });
  window.addEventListener('mouseup', () => { targetScale = ring.classList.contains('hot') ? 1 : 1; });

  window.addEventListener('click', (e) => {
    onClick?.(e);
    // a ring that pulses out and dies
    const pulse = ring.cloneNode(true);
    pulse.removeAttribute('id');
    pulse.style.position = 'fixed';
    pulse.style.left = `${e.clientX}px`;
    pulse.style.top = `${e.clientY}px`;
    pulse.style.opacity = '1';
    pulse.style.pointerEvents = 'none';
    pulse.style.zIndex = '90';
    document.body.appendChild(pulse);
    gsap.to(pulse, {
      scale: 2.4, opacity: 0, duration: 0.7, ease: 'power2.out',
      onComplete: () => pulse.remove(),
    });
  });

  /* spring chase, on the shared ticker */
  gsap.ticker.add(() => {
    ringPos.x += (state.x - ringPos.x) * 0.16;
    ringPos.y += (state.y - ringPos.y) * 0.16;
    scale += (targetScale - scale) * 0.18;

    // stretch along the direction of travel — a little velocity smear
    const dx = state.x - ringPos.x;
    const dy = state.y - ringPos.y;
    const speed = Math.min(Math.hypot(dx, dy) / 90, 0.5);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    setRing({
      transform: `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) rotate(${angle}deg) scale(${scale * (1 + speed)}, ${scale * (1 - speed * 0.6)})`,
    });
    setDot({ transform: `translate3d(${state.x}px, ${state.y}px, 0)` });
  });

  /* hover targets — delegated, so injected cards work without rebinding */
  const HOT = 'a, button, input, textarea, .card, .plan, .h-model, [data-cursor]';
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.(HOT);
    if (!el) return;
    ring.classList.add('hot');
    targetScale = 1;
    const verb = el.dataset.cursor || (el.tagName === 'A' ? 'OPEN' : el.tagName === 'BUTTON' ? 'SELECT' : '');
    label.textContent = verb;
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest?.(HOT)) return;
    if (e.relatedTarget?.closest?.(HOT)) return;
    ring.classList.remove('hot');
    label.textContent = '';
  });

  return { ring, dot };
}

/**
 * Magnetic pull: elements drift toward the pointer when it comes close, and
 * tilt in 3D based on where inside them the pointer is.
 */
export function magnetize(el, { strength = 0.32, radius = 90, tilt = 8 } = {}) {
  const setX = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
  const setY = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
  const setRX = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
  const setRY = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });

  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const reach = Math.max(r.width, r.height) / 2 + radius;

    if (dist < reach) {
      const f = 1 - dist / reach;
      setX(dx * strength * f);
      setY(dy * strength * f);
      setRY((dx / r.width) * tilt);
      setRX(-(dy / r.height) * tilt);
    } else {
      setX(0); setY(0); setRX(0); setRY(0);
    }
  };

  window.addEventListener('mousemove', onMove, { passive: true });
  el.addEventListener('mouseleave', () => { setX(0); setY(0); setRX(0); setRY(0); });
  return () => window.removeEventListener('mousemove', onMove);
}

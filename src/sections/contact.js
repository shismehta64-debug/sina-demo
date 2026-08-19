import gsap from 'gsap';

/**
 * contact.js — the transmit terminal.
 *
 * Nothing here posts anywhere: there is no backend behind this build, so the
 * form validates properly, then plays an honest local "queued" acknowledgement
 * rather than pretending a message was delivered.
 */

export function initContact({ world } = {}) {
  const form = document.getElementById('cform');
  const out = document.getElementById('cf-out');
  if (!form) return;

  const email = form.querySelector('[name=email]');
  const usecase = form.querySelector('[name=usecase]');

  const mark = (field, ok) => {
    field.closest('.cf-line')?.classList.toggle('invalid', !ok);
  };

  [email, usecase].forEach((f) => {
    f.addEventListener('input', () => mark(f, true));
    f.addEventListener('focus', () => world?.post.glitch(0.12));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
    const useOk = usecase.value.trim().length > 3;
    mark(email, emailOk);
    mark(usecase, useOk);

    if (!emailOk || !useOk) {
      out.style.color = '#ff7a70';
      out.textContent = !emailOk ? '! INVALID ADDRESS — CHECK FORMAT' : '! DESCRIBE YOUR USE CASE FIRST';
      world?.post.glitch(0.7);
      gsap.fromTo(form, { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    out.style.color = 'var(--teal)';
    world?.burst(20);

    const steps = [
      'OPENING CHANNEL...',
      'ENCRYPTING PAYLOAD...',
      'QUEUED LOCALLY — NO SERVER ATTACHED TO THIS BUILD',
      '✓ WIRE A HANDLER TO /api/contact TO SEND FOR REAL',
    ];
    steps.forEach((s, i) => {
      setTimeout(() => {
        out.textContent = s;
        if (i === steps.length - 1) {
          out.style.color = 'var(--teal)';
          form.reset();
          btn.disabled = false;
        }
      }, i * 620);
    });
  });
}

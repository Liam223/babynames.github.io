// Pointer-event gesture handling (touch and mouse). Left = no, right = like, up = love.
const DIST = 100;        // px needed to commit
const SPEED = 0.55;      // px/ms flick speed that also commits
const FLICK_MIN = 60;    // a fast flick must still travel this far to count
const DEAD = 12;         // px of movement before any stamp or glow shows
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachSwipe(card, onDecide) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, active = false, done = false, id = null;
  const stamp = (cls) => card.querySelector('.stamp.' + cls);
  const glow = card.querySelector('.glow');
  const COLOUR = { like: 'like', no: 'nope', love: 'love' };

  function setFeedback(dir, amount) {           // dir: 'like' | 'no' | 'love' | null
    for (const [d, cls] of [['like', 'like'], ['no', 'nope'], ['love', 'love']]) stamp(cls).style.opacity = d === dir ? amount : 0;
    glow.style.borderColor = dir ? `var(--${COLOUR[dir]})` : 'transparent';
    glow.style.opacity = dir ? String(amount) : '0';
  }

  function paint() {
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const dist = horizontal ? Math.abs(dx) : -dy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DEAD || dist <= 0) return setFeedback(null, 0);
    setFeedback(horizontal ? (dx > 0 ? 'like' : 'no') : 'love', Math.min(1, dist / DIST));
  }

  function direction(vx, vy) {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      if (Math.abs(dx) > DIST || Math.abs(vx) > SPEED && Math.abs(dx) > FLICK_MIN) return dx > 0 ? 'like' : 'no';
    } else if (dy < 0 && (-dy > DIST || -vy > SPEED && -dy > FLICK_MIN)) return 'love';
    return null;
  }

  card.addEventListener('pointerdown', (e) => {
    if (done || (e.pointerType === 'mouse' && e.button !== 0)) return;
    active = true; id = e.pointerId; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now();
    card.classList.add('dragging');
    card.style.transition = 'none';
    card.setPointerCapture(id);
  });
  card.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== id) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    paint();
  });
  const end = (e) => {
    if (!active || e.pointerId !== id) return;
    active = false; card.classList.remove('dragging');
    const dt = Math.max(1, performance.now() - t0);
    const dir = e.type === 'pointerup' ? direction(dx / dt, dy / dt) : null;
    if (dir) fling(dir); else springBack();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  // Safety net: if the browser takes the touch away without telling us, never leave the card or glow stuck.
  card.addEventListener('lostpointercapture', () => {
    if (!active) return;
    active = false; card.classList.remove('dragging'); springBack();
  });

  function springBack() {
    if (!reduced()) card.style.transition = 'transform .28s cubic-bezier(.2,1.4,.4,1)';
    dx = dy = 0;
    card.style.transform = 'translate(0px, 0px) rotate(0deg)';
    setFeedback(null, 0);
  }

  function fling(dir) {
    if (done) return;
    done = true;
    const W = innerWidth, H = innerHeight;
    const tx = dir === 'like' ? W : dir === 'no' ? -W : dx;
    const ty = dir === 'love' ? -H : dy;
    setFeedback(dir, 1);
    const finish = () => onDecide(dir);
    if (reduced()) return finish();
    card.style.transition = 'transform .32s ease-in, opacity .32s ease-in';
    card.style.transform = `translate(${tx}px, ${ty}px) rotate(${dir === 'love' ? 0 : tx / 14}deg)`;
    card.style.opacity = '0';
    setTimeout(finish, 300);
  }

  return { fling: (dir) => { if (!active) { dx = dir === 'like' ? 1 : dir === 'no' ? -1 : 0; dy = 0; fling(dir); } } };
}

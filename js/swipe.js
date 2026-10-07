// Pointer-event gesture handling (touch and mouse). Left = no, right = like, up = love.
const DIST = 100;        // px needed to commit
const SPEED = 0.55;      // px/ms flick speed that also commits
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachSwipe(card, onDecide) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, active = false, done = false, id = null;
  const stamp = (cls) => card.querySelector('.stamp.' + cls);

  function paint() {
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const p = (v) => Math.max(0, Math.min(1, v / DIST));
    stamp('like').style.opacity = horizontal && dx > 0 ? p(dx) : 0;
    stamp('nope').style.opacity = horizontal && dx < 0 ? p(-dx) : 0;
    stamp('love').style.opacity = !horizontal && dy < 0 ? p(-dy) : 0;
    // coloured edge glow that grows as the swipe commits
    const dir = horizontal ? (dx > 0 ? 'like' : 'nope') : dy < 0 ? 'love' : null;
    const amount = horizontal ? p(Math.abs(dx)) : dy < 0 ? p(-dy) : 0;
    card.style.setProperty('--glow-c', dir ? `var(--${dir === 'nope' ? 'nope' : dir})` : 'transparent');
    card.style.setProperty('--glow-o', String(amount));
  }

  function direction(vx, vy) {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      if (Math.abs(dx) > DIST || Math.abs(vx) > SPEED && Math.abs(dx) > 30) return dx > 0 ? 'like' : 'no';
    } else if (dy < 0 && (-dy > DIST || -vy > SPEED && -dy > 30)) return 'love';
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
    const dir = e.type === 'pointercancel' ? null : direction(dx / dt, dy / dt);
    if (dir) fling(dir); else springBack();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);

  function springBack() {
    if (!reduced()) card.style.transition = 'transform .28s cubic-bezier(.2,1.4,.4,1)';
    dx = dy = 0; paint();
    for (const c of ['like', 'nope', 'love']) stamp(c).style.opacity = 0;
    card.style.setProperty('--glow-o', '0');
  }

  function fling(dir) {
    if (done) return;
    done = true;
    const W = innerWidth, H = innerHeight;
    const tx = dir === 'like' ? W : dir === 'no' ? -W : dx;
    const ty = dir === 'love' ? -H : dy;
    stamp(dir === 'no' ? 'nope' : dir).style.opacity = 1;
    card.style.setProperty('--glow-c', `var(--${dir === 'no' ? 'nope' : dir})`);
    card.style.setProperty('--glow-o', '1');
    const finish = () => onDecide(dir);
    if (reduced()) return finish();
    card.style.transition = 'transform .32s ease-in, opacity .32s ease-in';
    card.style.transform = `translate(${tx}px, ${ty}px) rotate(${dir === 'love' ? 0 : tx / 14}deg)`;
    card.style.opacity = '0';
    setTimeout(finish, 300);
  }

  return { fling: (dir) => { if (!active) { dx = dir === 'like' ? 1 : dir === 'no' ? -1 : 0; dy = 0; fling(dir); } } };
}

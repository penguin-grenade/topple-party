// Keeps the controller upright in the player's hand while they wave the phone around.
//
// - Android Chrome: on a tap, go full screen and lock the screen to portrait (browsers only allow
//   orientation locks in full screen).
// - Everywhere else (iPhone, or after leaving full screen): if the phone auto-rotates to landscape,
//   rotate the whole page back the other way so it still looks and works like portrait.

let rot = 0; // current CSS rotation of #app, in degrees
let locked = false;
let enabled = true;

function isPhone(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
}

export function layout() {
  const el = document.getElementById('app');
  if (!el) return;
  const w = window.innerWidth, h = window.innerHeight;
  let r = 0;
  if (enabled && !locked && w > h && isPhone()) {
    const so = (screen as any).orientation;
    const angle = so && typeof so.angle === 'number' ? so.angle : Number((window as any).orientation ?? 90);
    // phone turned counter-clockwise (angle 90) -> turn the page counter-clockwise too, and vice versa
    r = angle === 270 || angle === -90 ? 90 : -90;
  }
  rot = r;
  el.style.width = `${r ? h : w}px`;
  el.style.height = `${r ? w : h}px`;
  el.style.transform = `translate(-50%, -50%) rotate(${r}deg)`;
}

/** A pointer movement in screen pixels, expressed in the controller's own (upright) axes. */
export function toLocal(dx: number, dy: number): { x: number; y: number } {
  if (!rot) return { x: dx, y: dy };
  const a = (rot * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Must be called from a tap/click handler. */
export function lockUpright() {
  const so = (screen as any).orientation;
  if (!enabled || !isPhone() || !so || typeof so.lock !== 'function') return; // iOS: counter-rotation only
  const root = document.documentElement as any;
  let p: Promise<unknown> = Promise.resolve();
  try {
    if (!document.fullscreenElement && root.requestFullscreen) p = root.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* not allowed */
  }
  p.then(() => so.lock('portrait'))
    .then(() => {
      locked = true;
      layout();
    })
    .catch(() => {
      locked = false;
      layout();
    });
}

export function setUprightEnabled(on: boolean) {
  enabled = on;
  if (!on && locked) {
    locked = false;
    try {
      (screen as any).orientation?.unlock?.();
    } catch {
      /* ignore */
    }
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  layout();
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) locked = false; // leaving full screen drops the lock
  layout();
});
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 60));
(screen as any).orientation?.addEventListener?.('change', layout);
layout();

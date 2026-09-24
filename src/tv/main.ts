import { Game } from './game';
import { initPhysics } from './sim/sim';
import { LEVELS, PRACTICE, buildLevel } from './sim/levels';
import { TOWERS } from './sim/towers';

async function boot() {
  if ((window as any).__compatFail) return; // the inline check already explained what's missing
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const bootEl = document.getElementById('boot')!;
  try {
    // let the display font load so block numbers and UI render in it (don't wait long)
    await Promise.race([(document as any).fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    await initPhysics();
    const game = new Game(canvas);
    (window as any).__game = game;
    Object.assign(window as any, { __levels: [...LEVELS, PRACTICE, ...TOWERS], __towers: TOWERS, __buildLevel: buildLevel });
    game.begin();
    (window as any).__booted = true;
    keepAwake();
    const inApp = /TopplePartyTV/.test(navigator.userAgent);
    const hint = document.getElementById('soundHint')!;
    if (inApp) {
      game.sfx.unlock();
      hint.remove();
    } else {
      const unlock = () => {
        game.sfx.unlock();
        if (game.sfx.ready) hint.remove();
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      setTimeout(unlock, 50);
    }
    bootEl.classList.add('done');
    setTimeout(() => bootEl.remove(), 800);
    await game.start();
  } catch (e) {
    console.error(e);
    bootEl.innerHTML = `<div class="bootErr">Something went wrong starting the game.<br><small>${String((e as Error)?.message ?? e)}</small></div>`;
  }
}

/** Ask the TV not to start its screensaver while the game is open (browsers that support it). */
function keepAwake() {
  const nav = navigator as any;
  if (!nav.wakeLock) return;
  let lock: any = null;
  const req = () => {
    if (lock || document.visibilityState !== 'visible') return;
    nav.wakeLock
      .request('screen')
      .then((l: any) => {
        lock = l;
        l.addEventListener?.('release', () => (lock = null));
      })
      .catch(() => {});
  };
  req();
  document.addEventListener('visibilitychange', req);
  window.addEventListener('pointerdown', req);
  window.addEventListener('keydown', req);
}

boot();

import { Game } from './game';
import { initPhysics } from './sim/sim';
import { LEVELS, PRACTICE, TOWER, buildLevel } from './sim/levels';

async function boot() {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const bootEl = document.getElementById('boot')!;
  try {
    // let the display font load so block numbers and UI render in it (don't wait long)
    await Promise.race([(document as any).fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
    await initPhysics();
    const game = new Game(canvas);
    (window as any).__game = game;
    Object.assign(window as any, { __levels: [...LEVELS, PRACTICE, TOWER], __buildLevel: buildLevel });
    game.begin();
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

boot();

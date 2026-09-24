// Scratch space for trying out new Tower Pull towers. Anything listed here can be run by id with
// tests/towers-check.ts (e.g. `tsx tests/towers-check.ts mytower --survey --games 12`) without
// adding it to the game. When a design is good, move it into TOWERS in src/tv/sim/towers.ts.
import type { TowerDef } from '../src/tv/sim/towers';
// import { layer, piece, fill, span, crown, X, Z } from '../src/tv/sim/towers';

export const VARIANTS: TowerDef[] = [
  // {
  //   id: 'mytower', name: 'My Tower', blurb: '', modes: ['pull'], substeps: 1,
  //   build(b) {
  //     b.plinth(0, 0, 3.8, 3.8, 1);
  //     let y = 1;
  //     for (let i = 0; i < 16; i++) y = layer(b, y, { n: 3, len: 3, ang: i % 2 ? Z : X });
  //     crown(b, 0, y, 0);
  //   },
  // },
];

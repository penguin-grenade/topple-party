import type { ModeId } from '../../shared/protocol';
import type { BlockType } from './blocks';

export interface BlockSpec {
  type: BlockType;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  /** top of the stand this block belongs to; falling below it scores */
  baseY: number;
}
export interface PlinthSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotY: number;
}
export interface CamSpec {
  pos: [number, number, number];
  look: [number, number, number];
}
export interface LevelSpec {
  id: string;
  name: string;
  blurb: string;
  blocks: BlockSpec[];
  plinths: PlinthSpec[];
  cam: CamSpec;
  time: number;
}
export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  modes: ModeId[];
  time?: number;
  cam?: CamSpec;
  build(b: Builder, rnd: () => number): void;
}

export const DEFAULT_CAM: CamSpec = { pos: [0, 6.0, 17], look: [0, 3.0, 0] };
const GAP = 0.003;
const SIDE_GAP = 0.02;

export class Builder {
  blocks: BlockSpec[] = [];
  plinths: PlinthSpec[] = [];
  base = 0;

  plinth(x: number, z: number, w: number, d: number, h: number, rotY = 0): number {
    this.plinths.push({ x, z, w, d, h, rotY });
    this.base = h;
    return h;
  }
  /** Adds a block whose bottom face rests at `bottom`. Returns the height of its top face. */
  box(type: BlockType, x: number, bottom: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0): number {
    this.blocks.push({ type, x, y: bottom + GAP + sy / 2, z, sx, sy, sz, rotY, baseY: this.base });
    return bottom + GAP + sy;
  }
  /** Stack of cubes, bottom to top. */
  column(types: BlockType[], x: number, z: number, bottom = this.base, s = 1): number {
    let y = bottom;
    for (const t of types) y = this.box(t, x, y, z, s, s, s);
    return y;
  }
  /** A row of cubes along x centered on cx. */
  row(types: BlockType[], cx: number, z: number, bottom = this.base, s = 1): number {
    const n = types.length;
    let top = bottom;
    types.forEach((t, i) => {
      top = this.box(t, cx + (i - (n - 1) / 2) * (s + SIDE_GAP), bottom, z, s, s, s);
    });
    return top;
  }
  /** 2D pyramid: rows[0] is the bottom row; each row is centered so blocks straddle the two below. */
  pyramid(rows: BlockType[][], cx: number, z: number, bottom = this.base, s = 1): number {
    let y = bottom;
    for (const r of rows) y = this.row(r, cx, z, y, s);
    return y;
  }
  /** Square layers (n x n, then n-1 x n-1, ...). typeAt(layer, i, j) picks each block. */
  pyramid3d(n: number, cx: number, cz: number, typeAt: (layer: number, i: number, j: number) => BlockType, bottom = this.base, s = 1): number {
    let y = bottom;
    for (let layer = 0; n - layer > 0; layer++) {
      const m = n - layer;
      let top = y;
      for (let i = 0; i < m; i++)
        for (let j = 0; j < m; j++) {
          const x = cx + (i - (m - 1) / 2) * (s + SIDE_GAP);
          const z = cz + (j - (m - 1) / 2) * (s + SIDE_GAP);
          top = this.box(typeAt(layer, i, j), x, y, z, s, s, s);
        }
      y = top;
    }
    return y;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

// ---------------------------------------------------------------------------------------------
// Levels. Coordinates: x right, y up, z toward the camera. The island's grass is at y = 0.
// ---------------------------------------------------------------------------------------------

export const LEVELS: LevelDef[] = [
  {
    id: 'warmup',
    name: 'Warm Up',
    blurb: 'A friendly pyramid with a gem on top.',
    modes: ['blast', 'best'],
    build(b, rnd) {
      b.plinth(0, 0, 7.4, 1.7, 2);
      const mid = rnd() < 0.5;
      b.pyramid(
        [
          ['wood', 'wood', 'silver', 'wood', 'wood', 'wood'],
          ['wood', mid ? 'gold' : 'wood', 'wood', mid ? 'wood' : 'gold', 'wood'],
          ['silver', 'wood', 'wood', 'silver'],
          ['wood', 'gold', 'wood'],
          ['silver', 'silver'],
          ['gem'],
        ],
        0,
        0,
      );
    },
  },
  {
    id: 'twin',
    name: 'Twin Towers',
    blurb: 'Knock out a tower and the bridge treasure falls.',
    modes: ['blast', 'best'],
    build(b) {
      b.plinth(-3.6, 0, 2.8, 1.7, 2);
      b.plinth(3.6, 0, 2.8, 1.7, 2);
      let top = 2;
      for (const cx of [-3.6, 3.6]) {
        let y = 2;
        const col = ['stone', 'wood', 'wood', 'silver', 'wood'] as BlockType[];
        for (const t of col) {
          b.box(t, cx - 0.51, y, 0);
          y = b.box(t === 'silver' ? 'wood' : t, cx + 0.51, y, 0);
        }
        top = y;
      }
      const plankTop = b.box('plank', 0, top, 0, 8.6, 0.4, 1.1);
      b.box('gem', 0, plankTop, 0);
      b.box('gold', -2.2, plankTop, 0);
      b.box('gold', 2.2, plankTop, 0);
    },
  },
  {
    id: 'castle',
    name: 'Castle Crasher',
    blurb: 'Gold in the towers, a gem in the keep. Mind the skulls!',
    modes: ['blast', 'best'],
    time: 75,
    build(b) {
      b.plinth(0, 0, 9.6, 5.2, 1.5);
      const B = 1.5;
      for (const z of [1.7, -1.7]) {
        const front = z > 0;
        const top = b.row(['wood', 'wood', 'stone', 'wood', 'stone', 'wood', 'wood'], 0, z, B);
        const t2 = b.row(['wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood'], 0, z, top);
        if (front) {
          b.box('skull', -2.04, t2, z);
          b.box('skull', 2.04, t2, z);
        } else {
          b.box('silver', -1.02, t2, z);
          b.box('silver', 1.02, t2, z);
        }
      }
      for (const x of [-4.2, 4.2]) {
        for (const z of [1.7, -1.7]) b.column(['stone', 'wood', 'wood', 'gold'], x, z, B);
        b.column(['wood', 'wood'], x, -0.52, B);
        b.column(['wood', 'wood'], x, 0.52, B);
      }
      b.column(['wood', 'silver', 'gem'], 0, 0, B);
    },
  },
  {
    id: 'bombs',
    name: 'Bomb Squad',
    blurb: 'Red blocks explode when they hit something hard.',
    modes: ['blast', 'best'],
    build(b, rnd) {
      b.plinth(0, 0, 10.4, 1.7, 2);
      const tops: BlockType[] = ['gold', 'silver', 'gold'];
      [-3.6, 0, 3.6].forEach((cx, k) => {
        let y = 2;
        const bombLayer = 1 + Math.floor(rnd() * 3);
        for (let layer = 0; layer < 6; layer++) {
          const last = layer === 5;
          const l: BlockType = last ? tops[k] : layer === bombLayer ? 'bomb' : layer === 0 ? 'stone' : 'wood';
          const r: BlockType = last ? (k === 1 ? 'gem' : 'wood') : layer === bombLayer + 1 ? 'bomb' : layer === 0 ? 'stone' : 'wood';
          b.box(l, cx - 0.51, y, 0);
          y = b.box(r, cx + 0.51, y, 0);
        }
      });
    },
  },
  {
    id: 'chem',
    name: 'Chem Lab',
    blurb: 'Green blocks explode when they touch each other.',
    modes: ['blast', 'best'],
    build(b) {
      b.plinth(0, 0, 9.4, 1.8, 1.5);
      const B = 1.5;
      b.column(['stone', 'stone', 'stone'], -3.7, 0, B);
      b.column(['stone', 'stone', 'stone'], 3.7, 0, B);
      const pillarTop = b.column(['wood', 'wood', 'wood'], 0, 0, B);
      b.box('gold', -2.1, B, 0);
      b.box('silver', -1.05, B, 0);
      b.box('silver', 1.05, B, 0);
      b.box('gold', 2.1, B, 0);
      const shelf = b.box('plank', 0, pillarTop, 0, 8.8, 0.35, 1.2);
      b.box('chem', -3.4, shelf, 0);
      b.box('wood', -2.3, shelf, 0);
      b.box('chem', -1.2, shelf, 0);
      b.box('gem', 0, shelf, 0);
      b.box('chem', 1.2, shelf, 0);
      b.box('wood', 2.3, shelf, 0);
      b.box('chem', 3.4, shelf, 0);
      b.box('chem', 0, shelf + 1.003, 0);
    },
  },
  {
    id: 'skyline',
    name: 'Skyline',
    blurb: 'Five skinny towers. Pick them off one by one.',
    modes: ['blast', 'best'],
    cam: { pos: [0, 7.2, 21.5], look: [0, 3.2, 0] },
    build(b, rnd) {
      const spots: [number, number, number, number][] = [
        [-6.4, 0.6, 1, 5],
        [-3.2, -1.2, 2.2, 4],
        [0, 0.6, 1.4, 6],
        [3.2, -1.2, 2.2, 4],
        [6.4, 0.6, 1, 5],
      ];
      const prizes: BlockType[] = ['gold', 'silver', 'gem', 'silver', 'gold'];
      spots.forEach(([x, z, h, n], i) => {
        b.plinth(x, z, 1.5, 1.5, h);
        const col: BlockType[] = [];
        for (let k = 0; k < n - 1; k++) col.push(k === 0 ? 'stone' : rnd() < 0.2 ? 'silver' : 'wood');
        col.push(prizes[i]);
        b.column(col, x, z);
      });
    },
  },
  {
    id: 'dominoes',
    name: 'Domino Run',
    blurb: 'Tip the first domino and watch them fall.',
    modes: ['blast', 'best'],
    cam: { pos: [0, 7.8, 20], look: [0, 2.4, -0.6] },
    build(b) {
      const th = Math.atan2(4.6, 11); // line from front-left to back-right
      const dir = [Math.cos(th), -Math.sin(th)];
      const c = [-0.3, -0.4];
      b.plinth(c[0], c[1], 15.5, 2.4, 1.2, th);
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t = -6.4 + i * 1.25;
        b.box('plank', c[0] + dir[0] * t, 1.2, c[1] + dir[1] * t, 0.34, 2.4, 1.3, th);
      }
      const tEnd = 6.4;
      const ex = c[0] + dir[0] * tEnd, ez = c[1] + dir[1] * tEnd;
      b.column(['wood', 'gold', 'gem'], ex, ez, 1.2);
      // side treasure tower
      b.plinth(-3.5, -3, 1.6, 1.6, 2.4);
      b.column(['wood', 'wood', 'silver', 'gold'], -3.5, -3);
    },
  },
  {
    id: 'ice',
    name: 'Ice Palace',
    blurb: 'Slippery ice slides right off. Grab the gold!',
    modes: ['blast', 'best'],
    build(b, rnd) {
      b.plinth(0, 0, 8.2, 1.7, 2);
      const rows: BlockType[][] = [];
      const widths = [7, 6, 5, 4, 3, 2, 1];
      widths.forEach((w, r) => {
        const row: BlockType[] = [];
        for (let i = 0; i < w; i++) row.push('ice');
        if (r > 0 && r < 6) row[Math.floor(rnd() * w)] = r >= 4 ? 'gold' : 'silver';
        rows.push(row);
      });
      rows[6] = ['gem'];
      b.pyramid(rows, 0, 0);
    },
  },
  {
    id: 'ghosts',
    name: 'Ghost Wall',
    blurb: 'Ghost blocks vanish when a ball hits them.',
    modes: ['blast', 'best'],
    build(b) {
      b.plinth(0, 0, 8.4, 4.2, 1.5);
      b.column(['wood', 'silver', 'gold'], -2.2, -1.1);
      b.column(['stone', 'gold', 'gem'], 0, -1.1);
      b.column(['wood', 'silver', 'gold'], 2.2, -1.1);
      let y = 1.5;
      for (let layer = 0; layer < 3; layer++) y = b.row(['ghost', 'ghost', 'ghost', 'ghost', 'ghost', 'ghost', 'ghost'], 0, 1.2, y);
    },
  },
  {
    id: 'pyramid',
    name: 'The Big One',
    blurb: 'A real pyramid. Stone at the bottom, riches at the top.',
    modes: ['blast', 'best'],
    time: 75,
    cam: { pos: [0, 5.6, 14.5], look: [0, 2.4, 0] },
    build(b, rnd) {
      b.plinth(0, 0, 5.4, 5.4, 1);
      b.pyramid3d(4, 0, 0, (layer, i, j) => {
        if (layer === 3) return 'gem';
        if (layer === 2) return (i + j) % 2 ? 'gold' : 'silver';
        if (layer === 1) return rnd() < 0.3 ? 'silver' : 'wood';
        return (i === 0 || j === 0 || i === 3 || j === 3) && rnd() < 0.25 ? 'bomb' : 'stone';
      });
    },
  },
  {
    id: 'wobbly',
    name: 'Wobbly Tower',
    blurb: 'A tall stack of planks. It only wants a nudge.',
    modes: ['blast', 'best'],
    cam: { pos: [0, 7, 18.5], look: [0, 4.4, 0] },
    build(b) {
      b.plinth(0, 0, 3.4, 3.4, 1.2);
      let y = 1.2;
      for (let layer = 0; layer < 10; layer++) {
        const alongX = layer % 2 === 0;
        let top = y;
        for (const off of [-0.76, 0.76]) {
          top = alongX ? b.box('plank', 0, y, off, 2.6, 0.5, 1) : b.box('plank', off, y, 0, 1, 0.5, 2.6);
        }
        if (layer === 4) b.box('silver', 0, y, 0, 0.5, 0.5, 0.5);
        y = top;
      }
      b.box('gold', -0.55, y, 0);
      b.box('gold', 0.55, y, 0);
      b.box('gem', 0, y + 1.003, 0);
    },
  },
];

export const PRACTICE: LevelDef = {
  id: 'practice',
  name: 'Practice',
  blurb: 'Warm up while everyone joins!',
  modes: [],
  cam: { pos: [0, 5.0, 15.5], look: [0, 2.8, 0] },
  build(b) {
    b.plinth(0, 0, 5, 1.7, 1.6);
    b.pyramid(
      [
        ['wood', 'wood', 'wood', 'wood'],
        ['wood', 'silver', 'wood'],
        ['wood', 'wood'],
        ['gold'],
      ],
      0,
      0,
    );
  },
};

export const JENGA_LAYERS = 14;
export const JENGA_H = 0.6;

export const TOWER: LevelDef = {
  id: 'tower',
  name: 'Tower Pull',
  blurb: "Pull a block out. Don't let the crown fall!",
  modes: ['pull'],
  cam: { pos: [10.6, 10.2, 14.8], look: [0, 5.5, 0] },
  build(b) {
    b.plinth(0, 0, 3.8, 3.8, 1);
    let y = 1;
    for (let layer = 0; layer < JENGA_LAYERS; layer++) {
      const alongX = layer % 2 === 0;
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 1.02;
        // Every block is the same size and slides freely; the risk is what's left holding the tower up.
        const h = JENGA_H;
        if (alongX) b.box('jenga', 0, y, off, 3, h, 1);
        else b.box('jenga', off, y, 0, 1, h, 3);
      }
      y += JENGA_H + 0.003;
    }
    b.box('crown', 0, y, 0, 1, 1, 1);
  },
};

export function buildLevel(def: LevelDef, seed: number): LevelSpec {
  const b = new Builder();
  def.build(b, mulberry32(seed));
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    blocks: b.blocks,
    plinths: b.plinths,
    cam: def.cam ?? DEFAULT_CAM,
    time: def.time ?? 60,
  };
}

export function levelsFor(mode: ModeId): LevelDef[] {
  return LEVELS.filter((l) => l.modes.includes(mode));
}

export { pick };

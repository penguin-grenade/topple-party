// Tower Pull towers, from the classic stack up to the Colossus. Each tower is a LevelDef built from
// wooden pieces (type 'jenga', any length) plus crowns that must not fall.

import { type Builder, type CamSpec, type LevelDef, type LevelSpec } from './levels';

export const PIECE_H = 0.6;
const GAP = 0.003; // Builder.box() leaves this gap under every block
const PITCH = 1.02; // centre-to-centre spacing of side-by-side pieces (1 wide + 0.02 gap)
export const X = 0;
export const Z = Math.PI / 2;

export interface CamLimits {
  liftMin: number;
  liftMax: number;
  zoomMin: number;
  zoomMax: number;
}

/** Contact stiffness for every tower (see SimOptions.contactHz). */
export const TOWER_CONTACT_HZ = 60;

export interface TowerDef extends LevelDef {
  /** physics substeps per frame (tall stacks need more) */
  substeps: number;
  /** camera direction in degrees around the tower (0 = straight on from the front) */
  yaw?: number;
}

interface LayerOpts {
  /** number of side-by-side pieces */
  n: number;
  /** piece length */
  len: number;
  /** direction the pieces run: 0 = along x, PI/2 = along z, anything else for twisted towers */
  ang?: number;
  cx?: number;
  cz?: number;
  pitch?: number;
  /** slots (0..n-1) left empty */
  skip?: number[];
  /** slide pieces along their length (one value, or one per slot) */
  shift?: number | number[];
  /** slots made of gold (worth a bonus when pulled out) */
  gold?: number[];
}

/** One layer of parallel pieces with its bottom at `y`. Returns the layer's top. */
export function layer(b: Builder, y: number, o: LayerOpts): number {
  const ang = o.ang ?? X;
  // rotY = ang turns local +x into (cos, 0, -sin); local +z (the side-by-side direction) into (sin, 0, cos)
  const ax = Math.cos(ang), az = -Math.sin(ang);
  const px = Math.sin(ang), pz = Math.cos(ang);
  const pitch = o.pitch ?? PITCH;
  for (let k = 0; k < o.n; k++) {
    if (o.skip?.includes(k)) continue;
    const off = (k - (o.n - 1) / 2) * pitch;
    const sh = Array.isArray(o.shift) ? o.shift[k] ?? 0 : o.shift ?? 0;
    b.box(o.gold?.includes(k) ? 'jgold' : 'jenga', (o.cx ?? 0) + px * off + ax * sh, y, (o.cz ?? 0) + pz * off + az * sh, o.len, PIECE_H, 1, ang);
  }
  return y + GAP + PIECE_H;
}

/** Full-width span of n pieces side by side. */
export const span = (n: number) => n + (n - 1) * (PITCH - 1);

export function crown(b: Builder, x: number, y: number, z: number, s = 1): number {
  return b.box('crown', x, y, z, s, s, s);
}

/** The tower's footprint and height, from its built blocks. */
export function towerBounds(spec: LevelSpec) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = 0;
  for (const k of spec.blocks) {
    const c = Math.abs(Math.cos(k.rotY)), sn = Math.abs(Math.sin(k.rotY));
    const hx = (k.sx * c + k.sz * sn) / 2, hz = (k.sx * sn + k.sz * c) / 2;
    minX = Math.min(minX, k.x - hx);
    maxX = Math.max(maxX, k.x + hx);
    minZ = Math.min(minZ, k.z - hz);
    maxZ = Math.max(maxZ, k.z + hz);
    top = Math.max(top, k.y + k.sy / 2);
  }
  return { minX, maxX, minZ, maxZ, top };
}

/** A 3/4 camera that fits the whole tower on screen, plus how far players may move it. */
export function frameTower(spec: LevelSpec, yawDeg = 35.6): { cam: CamSpec; limits: CamLimits } {
  const b = towerBounds(spec);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const wide = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const H = b.top;
  const D = Math.max(1.95 * H, 1.15 * wide, 17);
  const lookY = H * 0.5;
  const yaw = (yawDeg * Math.PI) / 180, pitch = (14.5 * Math.PI) / 180;
  const cam: CamSpec = {
    pos: [cx + D * Math.cos(pitch) * Math.sin(yaw), lookY + D * Math.sin(pitch), cz + D * Math.cos(pitch) * Math.cos(yaw)],
    look: [cx, lookY, cz],
  };
  // zoomed all the way in, the camera sits about 10.5 units from the tower wherever the tower is
  return { cam, limits: { liftMin: -H * 0.46, liftMax: H * 0.46, zoomMin: Math.min(0.6, 10.5 / D), zoomMax: 1.2 } };
}

// ---------------------------------------------------------------------------------------------

const CLASSIC_LAYERS = 14;
const alt = (i: number) => (i % 2 ? Z : X);

/**
 * The towers, in order: each one a step more complicated than the last. Tuned with
 * tests/towers-check.ts (every piece must slide, every tower must stand on its own, and the bots'
 * game lengths should shrink as the towers get meaner).
 */
export const TOWERS: TowerDef[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Three across, fourteen high. Every piece slides.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 3.8, 3.8, 1);
      let y = 1;
      for (let i = 0; i < CLASSIC_LAYERS; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i) });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'square',
    name: 'Four Square',
    blurb: 'Four across and taller, with longer pieces. The gold one is worth 15 extra.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 4.8, 4.8, 1);
      let y = 1;
      for (let i = 0; i < 18; i++) y = layer(b, y, { n: 4, len: span(4), ang: alt(i), gold: i === 4 ? [1] : [] });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'ziggurat',
    name: 'Ziggurat',
    blurb: 'Steps of long, medium and short pieces: solid below, skinny on top.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 6, 6, 1);
      let y = 1;
      const plan = [5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 2];
      plan.forEach((n, i) => (y = layer(b, y, { n, len: span(n), ang: alt(i), gold: i === 10 ? [0] : [] })));
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    blurb: 'A skinny tower holding up a heavy gallery of extra-long pieces. Mind the overhangs.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 3.8, 3.8, 1);
      let y = 1;
      for (let i = 0; i < 13; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i) });
      // gallery: extra-long pieces sticking out past the tower on every side
      y = layer(b, y, { n: 3, len: span(6), ang: X });
      y = layer(b, y, { n: 6, len: span(6), ang: Z, gold: [0] });
      y = layer(b, y, { n: 6, len: span(6), ang: X });
      // lantern
      for (let i = 0; i < 4; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1) });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'twister',
    name: 'Twister',
    blurb: 'Every layer turns a little, so every piece slides a different way. Use the camera.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 4.4, 4.4, 1);
      let y = 1;
      for (let i = 0; i < 20; i++) y = layer(b, y, { n: 3, len: 3.3, ang: (i * Math.PI) / 6, gold: i === 7 ? [2] : i === 13 ? [0] : [] });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'lean',
    name: 'Leaning Tower',
    blurb: 'It leans hard. Long counterweights stick out the back; the low side holds it up.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0.6, 0, 5, 3.8, 1);
      let y = 1;
      const L = 20, lean = 0.11;
      for (let i = 0; i < L; i++) {
        const cx = i * lean - 0.3;
        // most layers running along the lean are long pieces pushed back uphill: counterweights
        if (i % 2 === 0 && i >= 4) y = layer(b, y, { n: 3, len: 4.2, ang: X, cx: cx - 0.6, gold: i === 12 ? [1] : [] });
        else y = layer(b, y, { n: 3, len: 3, ang: alt(i), cx, gold: i === 7 ? [2] : [] });
      }
      crown(b, (L - 1) * lean - 0.3, y, 0);
    },
  },
  {
    id: 'scales',
    name: 'The Scales',
    blurb: 'A see-saw on top with a crown on each pan. Take from one side and the other gets heavy.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 3.8, 3.8, 1);
      let y = 1;
      for (let i = 0; i < 14; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i) });
      // the see-saw balances on a single piece
      y = layer(b, y, { n: 1, len: 3, ang: X });
      y = layer(b, y, { n: 1, len: 10.2, ang: Z });
      // a pan of pieces on each end, crown on top
      for (const cz of [-3.6, 3.6]) {
        let py = y;
        for (let i = 0; i < 3; i++) py = layer(b, py, { n: 3, len: 3, ang: alt(i), cz, gold: i === 1 && cz > 0 ? [0] : [] });
        crown(b, 0, py, cz, 0.8);
      }
      crown(b, 0, y, 0, 0.8);
    },
  },
  {
    id: 'gate',
    name: 'The Gate',
    blurb: 'Two skinny legs that only stand because the bridges tie them together.',
    modes: ['pull'],
    substeps: 1,
    yaw: 16,
    build(b) {
      const cx = 2.2;
      b.plinth(-cx, 0, 2.8, 2.8, 1);
      b.plinth(cx, 0, 2.8, 2.8, 1);
      let y = 1;
      // legs two pieces wide (Z/X layers), bridges (B) of two long pieces across both
      [...'ZXZXZBZXZXZBZXZB'].forEach((c, i) => {
        if (c === 'B') y = layer(b, y, { n: 2, len: 2 * cx + span(2), ang: X });
        else {
          layer(b, y, { n: 2, len: span(2), ang: c === 'Z' ? Z : X, cx: -cx });
          y = layer(b, y, { n: 2, len: span(2), ang: c === 'Z' ? Z : X, cx, gold: i === 7 ? [0] : [] });
        }
      });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'arch',
    name: 'The Arch',
    blurb: 'Two towers leaning so far in that neither could stand alone. Watch their feet.',
    modes: ['pull'],
    substeps: 1,
    yaw: 16,
    build(b) {
      // the legs lean so far that each stands only because the other holds it up at the top
      const lean = 0.175, L = 15;
      const base = 1.5 + L * lean + 0.08;
      b.plinth(-base - 0.3, 0, 4.4, 3.8, 1);
      b.plinth(base + 0.3, 0, 4.4, 3.8, 1);
      let y = 1;
      for (let i = 0; i < L; i++) {
        const cx = base - i * lean;
        layer(b, y, { n: 3, len: 3, ang: alt(i), cx: -cx, gold: i === 4 ? [0] : [] });
        y = layer(b, y, { n: 3, len: 3, ang: alt(i), cx });
      }
      const cx = base - L * lean;
      y = layer(b, y, { n: 3, len: 2 * cx + 3, ang: X, gold: [1] });
      y = layer(b, y, { n: 3, len: 3, ang: Z });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'colossus',
    name: 'The Colossus',
    blurb: 'Enormous, crooked and barely standing, with two crowns to keep up. Good luck.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 6.2, 6.2, 1);
      let y = 1;
      let i = 0;
      const dir = () => alt(i++);
      // foundation and trunk
      for (let k = 0; k < 4; k++) y = layer(b, y, { n: 5, len: span(5), ang: dir() });
      for (let k = 0; k < 6; k++) y = layer(b, y, { n: 4, len: span(4), ang: dir(), gold: k === 3 ? [0] : [] });
      // waist, with a window right through it
      for (let k = 0; k < 4; k++) y = layer(b, y, { n: 3, len: 3, ang: dir(), skip: k === 1 || k === 2 ? [1] : [] });
      // crooked neck leaning out
      let cx = 0;
      for (let k = 0; k < 8; k++) {
        cx += 0.08;
        y = layer(b, y, { n: 3, len: 3, ang: dir(), cx, gold: k === 5 ? [2] : [] });
      }
      // balcony hanging out over the lean, with the second crown on its far end
      y = layer(b, y, { n: 3, len: span(5), ang: dir(), cx: cx + 0.9 });
      y = layer(b, y, { n: 4, len: span(4), ang: dir(), cx: cx + 0.9, gold: [3] });
      crown(b, cx + 2.55, y, 0, 0.7);
      // twisted spire leaning back the other way
      for (let k = 0; k < 10; k++) {
        cx -= 0.06;
        y = layer(b, y, { n: 3, len: 3.2, ang: (k * Math.PI) / 6, cx });
      }
      crown(b, cx, y, 0);
    },
  },
];

export const TOWER = TOWERS[0];

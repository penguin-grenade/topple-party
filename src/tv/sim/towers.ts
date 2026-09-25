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

/** A single piece centred at (x, z) with its bottom at `y`. Returns the top of its layer. */
export function piece(b: Builder, x: number, y: number, z: number, len: number, ang = X, gold = false): number {
  b.box(gold ? 'jgold' : 'jenga', x, y, z, len, PIECE_H, 1, ang);
  return y + GAP + PIECE_H;
}

/**
 * Pieces side by side, starting flush with `from` and adding more toward `to` while they fit.
 * X pieces (running along x) are laid out across z, centred on x = `at`; Z pieces across x, centred
 * on z = `at`. Returns how far the last piece reaches (its outer edge).
 */
export function fill(b: Builder, y: number, o: { ang: number; from: number; to: number; at: number; len: number; gold?: number[] }): number {
  const dir = Math.sign(o.to - o.from) || 1;
  let edge = o.from;
  for (let k = 0; ; k++) {
    const c = o.from + dir * (0.5 + k * PITCH);
    if ((c + dir * 0.5 - o.to) * dir > 0.011) break;
    const gold = o.gold?.includes(k) ?? false;
    if (o.ang === X) piece(b, o.at, y, c, o.len, X, gold);
    else piece(b, c, y, o.at, o.len, Z, gold);
    edge = c + dir * 0.5;
  }
  return edge;
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
  const D = Math.max(1.95 * H, 1.3 * wide, 17);
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
/** height of one layer */
const H = GAP + PIECE_H;

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
      y = layer(b, y, { n: 3, len: span(6), ang: Z });
      y = layer(b, y, { n: 6, len: span(6), ang: X, gold: [0] });
      y = layer(b, y, { n: 6, len: span(6), ang: Z });
      // lantern
      for (let i = 0; i < 4; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i) });
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
  // -------------------------------------------------------------------------------- blueprints
  {
    id: 'buttress',
    name: 'Flying Buttress',
    blurb: 'A spire propped up by two buttresses that lean too far to stand alone. They hold each other up.',
    modes: ['pull'],
    substeps: 1,
    yaw: 14,
    build(b) {
      const J = 8, lean = 0.4;
      const top = 3.35, base = top + (J - 1) * lean;
      b.plinth(0, 0, 3.8, 3.8, 1);
      b.plinth(-base - 0.4, 0, 4.4, 3.8, 1);
      b.plinth(base + 0.4, 0, 4.4, 3.8, 1);
      let y = 1;
      for (let i = 0; i < J; i++) {
        layer(b, y, { n: 3, len: 3, ang: alt(i) });
        for (const s of [-1, 1]) layer(b, y, { n: 3, len: 3, ang: alt(i), cx: s * (base - i * lean), gold: i === 3 && s > 0 ? [0] : [] });
        y += GAP + PIECE_H;
      }
      // tie course: long pieces through the spire and both buttress tops
      y = layer(b, y, { n: 3, len: 2 * (top + 1.5), ang: X });
      for (let i = 0; i < 8; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1), gold: i === 5 ? [2] : [] });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'corkscrew',
    name: 'Corkscrew',
    blurb: 'Every layer turns and every layer shifts, so the whole tower winds up like a spring.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 5.6, 5.6, 1);
      let y = 1;
      const L = 26, r = 0.55;
      let cx = 0, cz = 0;
      for (let i = 0; i < L; i++) {
        const orbit = (i * Math.PI) / 8;
        cx = r * Math.cos(orbit);
        cz = r * Math.sin(orbit);
        y = layer(b, y, { n: 3, len: 3.4, ang: (i * Math.PI) / 4, cx, cz, gold: i === 9 ? [0] : i === 17 ? [2] : [] });
      }
      crown(b, cx, y, cz);
    },
  },
  {
    id: 'pivot',
    name: 'Double Pivot',
    blurb: 'The top half balances on one piece, and the top of that on another. Keep it level.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 5, 5, 1);
      let y = 1;
      for (let i = 0; i < 3; i++) y = layer(b, y, { n: 4, len: span(4), ang: alt(i) });
      for (let i = 0; i < 7; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1) });
      // pivot 1: a single piece running along x, across the last layer...
      y = piece(b, 0, y, 0, 3, X);
      // ...under a wide deck that overhangs it both ways
      y = layer(b, y, { n: 3, len: span(5), ang: Z });
      y = layer(b, y, { n: 5, len: span(5), ang: X, gold: [0] });
      for (let i = 0; i < 4; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1) });
      // pivot 2, running along z this time
      y = piece(b, 0, y, 0, 3, Z);
      y = layer(b, y, { n: 3, len: span(5), ang: X });
      y = layer(b, y, { n: 5, len: span(5), ang: Z });
      for (let i = 0; i < 4; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i) });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'corbel',
    name: 'Corbel Arch',
    blurb: 'Two pillars step inward until they meet. Crowned balconies keep them from tipping in. Five crowns.',
    modes: ['pull'],
    substeps: 1,
    yaw: 12,
    build(b) {
      const P = 4.2, xo = P + 1.5;
      const REACH = 6.5; // balcony pieces: from the pillar's inside face out past its outside
      b.plinth(-P, 0, 3.8, 3.8, 1);
      b.plinth(P, 0, 3.8, 3.8, 1);
      let y = 1;
      for (let i = 0; i < 6; i++) {
        for (const s of [-1, 1]) {
          if (i === 4) {
            // balcony: the X layer pokes far out past the outside of the pillar...
            layer(b, y, { n: 3, len: REACH, ang: X, cx: s * (P - 1.5 + REACH / 2), gold: s > 0 ? [2] : [] });
          } else if (i === 5) {
            // ...and the Z layer above carries more pieces out on it, as counterweights, with a crown
            // perched on the far end
            layer(b, y, { n: 3, len: 3, ang: Z, cx: s * P });
            const tip = fill(b, y, { ang: Z, from: s * (P + 1.54), to: s * (P - 1.4 + REACH), at: 0, len: 3 });
            crown(b, tip - s * 0.5, y + GAP + PIECE_H, 0, 0.7);
          } else layer(b, y, { n: 3, len: 3, ang: alt(i), cx: s * P });
        }
        y += GAP + PIECE_H;
      }
      // corbels: every layer reaches a little further in than the one below
      const step = 2.2 / 6;
      for (let i = 6; i < 12; i++) {
        const xi = P - 1.5 - step * (i - 5);
        for (const s of [-1, 1]) {
          if (i % 2 === 0) layer(b, y, { n: 3, len: xo - xi, ang: X, cx: (s * (xo + xi)) / 2 });
          else fill(b, y, { ang: Z, from: s * xi, to: s * xo, at: 0, len: 3 });
        }
        y += GAP + PIECE_H;
      }
      // the keystone course: long pieces right across both pillars
      y = layer(b, y, { n: 3, len: 2 * xo, ang: X, gold: [1] });
      // turrets on the pillars and a spire in the middle, each with a crown
      let ty = y;
      for (let i = 0; i < 3; i++) {
        layer(b, ty, { n: 3, len: 3, ang: alt(i + 1), cx: -P });
        ty = layer(b, ty, { n: 3, len: 3, ang: alt(i + 1), cx: P });
      }
      crown(b, -P, ty, 0, 0.8);
      crown(b, P, ty, 0, 0.8);
      for (let i = 0; i < 6; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1) });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'trident',
    name: 'The Trident',
    blurb: "A hollow frame that's all tension, a wide deck, and three spires tied by bridges. Three crowns.",
    modes: ['pull'],
    substeps: 1,
    yaw: 6,
    build(b) {
      b.plinth(0, 0, 6, 6, 1);
      let y = 1;
      for (let i = 0; i < 3; i++) y = layer(b, y, { n: 5, len: span(5), ang: alt(i) });
      // the hollow: only the two outside pieces of each layer, a frame around empty space
      for (let i = 0; i < 4; i++) y = layer(b, y, { n: 5, len: span(5), ang: alt(i + 1), skip: [1, 2, 3] });
      // deck, widening to carry three spires
      y = layer(b, y, { n: 5, len: span(8), ang: Z });
      y = layer(b, y, { n: 8, len: span(8), ang: X, gold: [3] });
      // three spires, two pieces wide, the middle one tallest, tied by bridges across all three
      const xs = [-3, 0, 3];
      const tops = [y, y, y];
      for (let k = 0; k < 12; k++) {
        const ly = y + k * (GAP + PIECE_H);
        if (k === 3 || k === 7) {
          const t = layer(b, ly, { n: 2, len: 2 * 3 + span(2), ang: X, gold: k === 3 ? [0] : [] });
          tops[0] = tops[1] = tops[2] = t;
          continue;
        }
        for (let t = 0; t < 3; t++) {
          if (k > 7 && t !== 1) continue;
          tops[t] = layer(b, ly, { n: 2, len: span(2), ang: alt(k + 1), cx: xs[t] });
        }
      }
      for (let t = 0; t < 3; t++) crown(b, xs[t], tops[t], 0, 0.8);
    },
  },
  {
    id: 'j78d',
    name: 'J-78-D',
    blurb: 'Arches, a buttress, a crowned balcony and three spires, one on a single-piece pivot. Stability: 24%.',
    modes: ['pull'],
    substeps: 1,
    yaw: 10,
    build(b) {
      const P = 4.3, xo = P + 1.5, xin = P - 1.5;
      const H = GAP + PIECE_H;
      b.plinth(-P, 0, 3.8, 3.8, 1);
      b.plinth(P, 0, 3.8, 3.8, 1);
      // storeys (layer numbers): lower corbel arch 6-11, lintel 12, upper storey 13-16,
      // upper corbel 17-20, top lintel 21
      const LINTELS = [12, 21];
      const corbel = (i: number) => (i >= 6 && i <= 11 ? xin - (2.3 / 6) * (i - 5) : i >= 17 && i <= 20 ? xin - 0.4 * (i - 16) : null);
      // diagonal truss buttress leaning in on the right pillar's outside, tied in at layer BJ
      const BJ = 8, blean = 0.33, btop = xo + 0.35 + 1.5, bbase = btop + (BJ - 1) * blean;
      b.plinth(bbase + 0.3, 0, 4.2, 3.8, 1);
      // cantilevered balconies on the left pillar (the buttress's counterweight)
      const BALCONY = [BJ, 14];
      let y = 1;
      for (let i = 0; i <= 21; i++, y += H) {
        const ang = alt(i);
        if (LINTELS.includes(i)) {
          layer(b, y, { n: 3, len: 2 * xo, ang: X, gold: i === 12 ? [2] : [] });
          continue;
        }
        if (i < BJ) layer(b, y, { n: 3, len: 3, ang, cx: bbase - i * blean, gold: i === 2 ? [1] : [] });
        for (const s of [-1, 1]) {
          const ci = corbel(i);
          let out = xo;
          if (s > 0 && i === BJ) out = btop + 1.5;
          if (s < 0 && BALCONY.includes(i)) out = xo + 2.2;
          if (ci === null && out === xo) {
            layer(b, y, { n: 3, len: 3, ang, cx: s * P, gold: i === 15 && s > 0 ? [0] : [] });
            continue;
          }
          const inner = ci ?? xin;
          if (ang === X) layer(b, y, { n: 3, len: out - inner, ang: X, cx: (s * (out + inner)) / 2 });
          else fill(b, y, { ang: Z, from: s * inner, to: s * out, at: 0, len: 3 });
        }
        // weights standing out on each balcony, and a crown on the upper one
        if (BALCONY.includes(i - 1)) {
          const tip = fill(b, y, { ang: Z, from: -(xo + 0.04), to: -(xo + 2.2), at: 0, len: 3 });
          if (i - 1 === 14) crown(b, tip + 0.5, y + H, 0, 0.7);
        }
      }
      // three spires on the top lintel; the middle one balances on a single pivot piece
      let sy = y;
      for (let k = 0; k < 4; k++) {
        layer(b, sy, { n: 2, len: span(2), ang: alt(k + 1), cx: -P });
        sy = layer(b, sy, { n: 2, len: span(2), ang: alt(k + 1), cx: P, gold: k === 2 ? [1] : [] });
      }
      crown(b, -P, sy, 0, 0.8);
      crown(b, P, sy, 0, 0.8);
      y = piece(b, 0, y, 0, 3, Z);
      y = layer(b, y, { n: 3, len: span(4), ang: X });
      for (let k = 0; k < 6; k++) y = layer(b, y, { n: 3, len: 3, ang: alt(k + 1) });
      crown(b, 0, y, 0);
    },
  },
  // -------------------------------------------------------------------------------- megastructures
  {
    id: 'aqueduct',
    name: 'The Aqueduct',
    blurb: 'Two tiers of corbelled arches on skinny pillars, a deck of 26 pieces, six turrets, three crowns.',
    modes: ['pull'],
    substeps: 1,
    yaw: 24,
    build(b) {
      const N = 6, S = 6;
      const xs = Array.from({ length: N }, (_, k) => (k - (N - 1) / 2) * S);
      const W = span(2);
      for (const x of xs) b.plinth(x, 0, 2.8, 2.8, 1);
      let y = 1;
      const tier = (layers: number, first: number, goldAt: number) => {
        for (let i = 0; i < layers; i++, y += H) for (const x of xs) layer(b, y, { n: 2, len: W, ang: alt(i + first), cx: x, gold: i === goldAt && x === xs[2] ? [0] : [] });
        // corbels: X pieces reaching a little further out each step, with Z pieces packed between
        const reaches = [1.49, 1.97, 2.45, 2.93];
        reaches.forEach((r, j) => {
          for (const x of xs) layer(b, y, { n: 2, len: 2 * r, ang: X, cx: x, gold: j === 2 && x === xs[4] ? [1] : [] });
          y += H;
          if (j < reaches.length - 1) {
            for (const x of xs) fill(b, y, { ang: Z, from: x - r, to: x + r, at: 0, len: W });
            y += H;
          }
        });
        // deck: a course of short pieces right along the top, then long beams
        const edge = xs[N - 1] + 2.93;
        fill(b, y, { ang: Z, from: -edge, to: edge, at: 0, len: W });
        y += H;
        const beam = (2 * edge) / 3;
        for (let k = 0; k < 3; k++) layer(b, y, { n: 2, len: beam - 0.04, ang: X, cx: -edge + beam * (k + 0.5) });
        y += H;
      };
      tier(8, 0, 3); // ends on a Z layer so the corbels cross it
      tier(7, 1, 2);
      xs.forEach((x, k) => {
        let ty = y;
        for (let i = 0; i < 4; i++) ty = layer(b, ty, { n: 2, len: W, ang: alt(i + 1), cx: x, gold: i === 1 && k % 2 ? [1] : [] });
        if (k % 2 === 0) crown(b, x, ty, 0, 0.8);
      });
    },
  },
  {
    id: 'citadel',
    name: 'The Citadel',
    blurb: 'Four corner towers tied by two rings of walls, around a keep with a gallery. Nine crowns, four of them out on the walls.',
    modes: ['pull'],
    substeps: 1,
    yaw: 30,
    build(b) {
      const P = 5.5;
      b.plinth(0, 0, 16, 16, 1);
      const corners = [
        [-P, -P],
        [P, -P],
        [P, P],
        [-P, P],
      ];
      let y = 1;
      for (let i = 0; i < 20; i++, y += H) {
        // rings of walls: along the front and back, then along the sides on top of them
        if (i === 8 || i === 14) {
          for (const z of [-P, P]) layer(b, y, { n: 3, len: 2 * P + 3, ang: X, cz: z, gold: z > 0 && i === 8 ? [1] : [] });
          // crowns perched on the middle of the top ring's front and back walls
          if (i === 14) for (const z of [-P, P]) crown(b, 0, y + H, z, 0.8);
          continue;
        }
        if (i === 9 || i === 15) {
          for (const x of [-P, P]) layer(b, y, { n: 3, len: 2 * P + 3, ang: Z, cx: x });
          if (i === 9) for (const x of [-P, P]) crown(b, x, y + H, 0, 0.8);
          continue;
        }
        for (const [x, z] of corners) layer(b, y, { n: 3, len: 3, ang: alt(i), cx: x, cz: z, gold: i === 4 && x < 0 && z < 0 ? [2] : [] });
      }
      for (const [x, z] of corners) crown(b, x, y, z, 0.8);
      // the keep, with a gallery hanging out around its middle
      let ky = 1;
      for (let i = 0; i < 24; i++) {
        const wide = i >= 12 && i <= 14;
        ky = layer(b, ky, { n: i === 12 || i === 15 ? 4 : wide ? 6 : 4, len: wide ? span(6) : span(4), ang: alt(i), gold: i === 13 ? [0] : i === 19 ? [2] : [] });
      }
      crown(b, 0, ky, 0);
    },
  },
  {
    id: 'babel',
    name: 'Babel',
    blurb: 'A tapering tower with landings spiralling up its corners and two hollow bands. Four crowns.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 13.5, 13.5, 1);
      let y = 1;
      const plan = [12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3];
      const landings = [8, 18, 26];
      plan.forEach((n, i) => {
        const ang = alt(i);
        // the landing piece slides out past the footprint; which corner it's on walks round the tower
        // (the skinny top has no landings: a landing there would rob the layer above of its corner)
        const side = i % 4; // +x, +z, -x, -z
        const k = side === 0 || side === 3 ? n - 1 : 0;
        const OUT = n >= 8 ? 2.2 : n >= 5 ? 1.4 : 0;
        const shift = new Array(n).fill(0);
        shift[k] = side === 0 ? OUT : side === 1 ? -OUT : side === 2 ? -OUT : OUT;
        // two hollow bands: only the outer pieces, a frame around empty air
        const hollow = i >= 12 && i <= 15 ? [2, 3, 4, 5] : i >= 20 && i <= 23 ? [2, 3] : [];
        const gold = i === 6 ? [5] : i === 18 ? [3] : i === 30 ? [1] : [];
        layer(b, y, { n, len: span(n), ang, shift, skip: hollow, gold });
        if (landings.includes(i)) {
          // a crown perched on the tip of this landing
          const half = span(n) / 2, off = (k - (n - 1) / 2) * PITCH, t = half + OUT - 0.5;
          if (ang === X) crown(b, side === 0 ? t : -t, y + H, off, 0.7);
          else crown(b, off, y + H, side === 1 ? t : -t, 0.7);
        }
        y += H;
      });
      crown(b, 0, y, 0);
    },
  },
  {
    id: 'cathedral',
    name: 'The Cathedral',
    blurb: 'A long nave with flying buttresses down both sides, twin towers at the west end and a spire on a pivot. Three crowns.',
    modes: ['pull'],
    substeps: 1,
    yaw: 28,
    build(b) {
      const NL = 12, J = 7, lean = 0.35, TOP = 3.55, BASE = TOP + (J - 1) * lean;
      b.plinth(0, 0, 14.4, 4.4, 1);
      // twin towers side by side at the west end (so nave pieces can still slide out east)
      const TW: [number, number][] = [
        [-9.6, -2.2],
        [-9.6, 2.2],
      ];
      for (const [x, z] of TW) b.plinth(x, z, 3.8, 3.8, 1);
      const bx = [-4.2, 0, 4.2];
      for (const x of bx) for (const s of [-1, 1]) b.plinth(x, s * (BASE + 0.3), 3.8, 4.4, 1);
      // nave: X layers are two 7-long pieces end to end per row, Z layers are 13 short pieces
      let y = 1;
      for (let i = 0; i < NL; i++, y += H) {
        if (i % 2 === 0) {
          for (const z of [-1.53, -0.51, 0.51, 1.53]) for (const x of [-3.5, 3.5]) piece(b, x, y, z, 6.98, X, i === 4 && z === 0.51 && x < 0);
        } else if (i === J) {
          // the tie course: three pieces run right through the nave into both buttress tops
          for (let x = -6.63; x <= 6.63; x += PITCH) {
            const tie = bx.some((t) => Math.abs(x - t) < 0.4);
            piece(b, x, y, 0, tie ? 2 * (TOP + 1.5) : span(4), Z, false);
          }
        } else fill(b, y, { ang: Z, from: -7, to: 7, at: 0, len: span(4), gold: i === 9 ? [6] : [] });
      }
      // flying buttresses: lean in until they touch the nave at the tie course
      for (const x of bx)
        for (const s of [-1, 1]) {
          let by = 1;
          for (let i = 0; i < J; i++) by = layer(b, by, { n: 3, len: 3, ang: alt(i), cx: x, cz: s * (BASE - i * lean), gold: i === 2 && s > 0 && x === 0 ? [1] : [] });
        }
      // twin towers
      for (const [x, z] of TW) {
        let ty = 1;
        for (let i = 0; i < 24; i++) ty = layer(b, ty, { n: 3, len: 3, ang: alt(i), cx: x, cz: z, gold: i === 10 && z > 0 ? [0] : [] });
        crown(b, x, ty, z, 0.8);
      }
      // the spire, on a single pivot piece
      let sy = piece(b, 2, y, 0, 3, X);
      for (let i = 0; i < 12; i++) sy = layer(b, sy, { n: 3, len: 3, ang: alt(i + 1), cx: 2, gold: i === 5 ? [2] : [] });
      crown(b, 2, sy, 0);
    },
  },
  {
    id: 'metropolis',
    name: 'Metropolis',
    blurb: 'Eight towers of every height tied by sky-bridges, balconies off the tallest. Eight crowns, two of them mid-bridge.',
    modes: ['pull'],
    substeps: 1,
    yaw: 32,
    build(b) {
      b.plinth(0, 0, 22, 22, 1);
      interface Tw {
        x: number;
        z: number;
        n: number;
        layers: number;
        crown?: boolean;
      }
      // widths are all even so a two-piece bridge lines up with rows in both towers it joins
      const T: Tw[] = [
        { x: -7, z: -7, n: 4, layers: 32, crown: true },
        { x: 0, z: -7, n: 2, layers: 28 },
        { x: 7, z: -7, n: 4, layers: 38, crown: true },
        { x: 7, z: 0, n: 2, layers: 30 },
        { x: 7, z: 7, n: 4, layers: 24, crown: true },
        { x: 0, z: 7, n: 2, layers: 16 },
        { x: -7, z: 7, n: 4, layers: 20, crown: true },
        { x: -7, z: 0, n: 2, layers: 22 },
      ];
      // sky-bridges: [layer, from tower, to tower]; X bridges on even layers, Z on odd (so they cross what's below)
      const B: [number, number, number, boolean?][] = [
        [10, 0, 1],
        [16, 1, 2],
        [21, 2, 3, true],
        [15, 3, 4],
        [8, 4, 5],
        [12, 5, 6, true],
        [7, 6, 7],
        [19, 7, 0],
      ];
      // balconies (on X layers): the whole layer is longer and pushed out +x, a crown on the tip
      const balconies: [number, number, number][] = [
        [26, 2, 1.8],
        [24, 3, 1.2],
      ];
      const rowsOf = (t: Tw, ang: number) => Array.from({ length: t.n }, (_, k) => (ang === X ? t.z : t.x) + (k - (t.n - 1) / 2) * PITCH);
      const maxL = Math.max(...T.map((t) => t.layers));
      const tops = T.map(() => 1);
      let y = 1;
      for (let i = 0; i < maxL; i++, y += H) {
        const ang = alt(i);
        const skips = T.map(() => new Set<number>());
        for (const [li, a, c, crowned] of B) {
          if (li !== i) continue;
          const ta = T[a], tc = T[c];
          const n = Math.min(ta.n, tc.n);
          const rows = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * PITCH);
          // a crowned bridge carries a crown at its midpoint, resting on both of its pieces
          if (ang === X) {
            const x0 = Math.min(ta.x - span(ta.n) / 2, tc.x - span(tc.n) / 2), x1 = Math.max(ta.x + span(ta.n) / 2, tc.x + span(tc.n) / 2);
            for (const r of rows) piece(b, (x0 + x1) / 2, y, ta.z + r, x1 - x0, X, r === rows[0] && i === 16);
            if (crowned) crown(b, (ta.x + tc.x) / 2, y + H, ta.z, 0.8);
          } else {
            const z0 = Math.min(ta.z - span(ta.n) / 2, tc.z - span(tc.n) / 2), z1 = Math.max(ta.z + span(ta.n) / 2, tc.z + span(tc.n) / 2);
            for (const r of rows) piece(b, ta.x + r, y, (z0 + z1) / 2, z1 - z0, Z, r === rows[0] && i === 15);
            if (crowned) crown(b, ta.x, y + H, (ta.z + tc.z) / 2, 0.8);
          }
          // those rows are now covered in both towers
          for (const ti of [a, c]) {
            const t = T[ti];
            rowsOf(t, ang).forEach((rv, k) => {
              if (rows.some((r) => Math.abs(rv - ((ang === X ? t.z : t.x) + r)) < 0.01)) skips[ti].add(k);
            });
          }
        }
        T.forEach((t, ti) => {
          if (i >= t.layers) return;
          const bal = balconies.find(([li, tt]) => li === i && tt === ti);
          const ext = bal ? bal[2] : 0;
          tops[ti] = layer(b, y, { n: t.n, len: span(t.n) + ext, ang, cx: t.x, cz: t.z, skip: [...skips[ti]], shift: ext / 2, gold: i === 5 && ti === 0 ? [1] : i === 30 && ti === 2 ? [0] : [] });
          if (bal) crown(b, t.x + span(t.n) / 2 + ext - 0.4, tops[ti], t.z, 0.7);
        });
      }
      T.forEach((t, ti) => t.crown && crown(b, t.x, tops[ti], t.z, 0.8));
    },
  },
];

export const TOWER = TOWERS[0];

/** How many towers are built in (custom ones from tower files come after these). */
export const BUILTIN_TOWERS = TOWERS.length;

/** Add a tower loaded from a tower file (replacing a custom tower with the same id). Returns its index. */
export function addTower(def: TowerDef): number {
  const i = TOWERS.findIndex((t, k) => k >= BUILTIN_TOWERS && t.id === def.id);
  if (i >= 0) {
    TOWERS[i] = def;
    return i;
  }
  TOWERS.push(def);
  return TOWERS.length - 1;
}
export function removeCustomTowers() {
  TOWERS.length = BUILTIN_TOWERS;
}
export const isCustomTower = (i: number) => i >= BUILTIN_TOWERS;

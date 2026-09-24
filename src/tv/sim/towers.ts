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
  // -------------------------------------------------------------------------------- blueprints
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
    id: 'pivot',
    name: 'Double Pivot',
    blurb: 'The top half balances on one piece, and the top of that on another. Keep it level.',
    modes: ['pull'],
    substeps: 1,
    build(b) {
      b.plinth(0, 0, 5, 5, 1);
      let y = 1;
      for (let i = 0; i < 3; i++) y = layer(b, y, { n: 4, len: span(4), ang: alt(i) });
      for (let i = 0; i < 8; i++) y = layer(b, y, { n: 3, len: 3, ang: alt(i + 1) });
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
    blurb: 'Two pillars step inward layer by layer until they meet. Heavy balconies keep them from tipping in.',
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
          if (i === 3) {
            // balcony: the X layer pokes far out past the outside of the pillar...
            layer(b, y, { n: 3, len: REACH, ang: X, cx: s * (P - 1.5 + REACH / 2), gold: s > 0 ? [2] : [] });
          } else if (i === 4) {
            // ...and the Z layer above carries more pieces out on it, as counterweights
            layer(b, y, { n: 3, len: 3, ang: Z, cx: s * P });
            fill(b, y, { ang: Z, from: s * (P + 1.54), to: s * (P - 1.4 + REACH), at: 0, len: 3 });
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
    blurb: 'Arches, a flying buttress, balconies and three spires, one on a single-piece pivot. Stability: 24%.',
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
        // weights standing out on each balcony
        if (BALCONY.includes(i - 1)) fill(b, y, { ang: Z, from: -(xo + 0.04), to: -(xo + 2.2), at: 0, len: 3 });
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
];

export const TOWER = TOWERS[0];

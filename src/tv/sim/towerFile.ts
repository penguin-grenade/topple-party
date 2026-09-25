// Tower files: the JSON format a tower designer (or anyone) can write and the game can play.
//
// A file describes a Tower Pull tower as a flat list of pieces, so any tool can produce one; the
// game never needs to know how it was designed. See docs/tower-format.md for the human version.
//
// This module has no three.js or physics dependencies, so a design tool can import it as-is for
// validation and the structural checks in analyzeTower().

import { Builder, buildLevel, type LevelDef, type LevelSpec, type PlinthSpec } from './levels';

export const TOWER_FORMAT = 'topple-tower';
export const TOWER_FORMAT_VERSION = 1;

/** Standard piece: 1 wide, 0.6 high; layers sit 0.003 apart. */
export const PIECE_WIDTH = 1;
export const PIECE_HEIGHT = 0.6;
export const LAYER_GAP = 0.003;
/** centre-to-centre spacing of pieces laid side by side (1 wide plus a hair of air) */
export const PIECE_PITCH = 1.02;

export interface PieceJson {
  /** centre of the piece */
  x: number;
  z: number;
  /** bottom face height */
  y: number;
  /** length along its long side */
  len: number;
  /** direction it runs, in degrees: 0 = along x, 90 = along z */
  ang?: number;
  /** width (default 1) and height (default 0.6) */
  w?: number;
  h?: number;
  /** a gold piece pays a bonus when pulled */
  gold?: boolean;
}
export interface CrownJson {
  x: number;
  y: number;
  z: number;
  /** cube edge length (default 1) */
  size?: number;
}
export interface PlinthJson {
  x: number;
  z: number;
  /** footprint width (x) and depth (z), height (its top is at y = h) */
  w: number;
  d: number;
  h?: number;
  ang?: number;
}
export interface TowerJson {
  format: typeof TOWER_FORMAT;
  version: number;
  /** short unique id (letters, digits, dashes) */
  id: string;
  name: string;
  blurb?: string;
  /** camera direction in degrees around the tower (0 = straight on from the front) */
  yaw?: number;
  plinths: PlinthJson[];
  pieces: PieceJson[];
  crowns: CrownJson[];
  /** anything the design tool wants to keep (its own editable representation, notes, ...) */
  source?: unknown;
}

export interface TowerCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i;
const num = (v: unknown, lo = -1e6, hi = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Structural sanity: is this a well-formed tower file? Does not build it. */
export function validateTowerJson(t: unknown): TowerCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = t as Partial<TowerJson>;
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'], warnings };
  if (o.format !== TOWER_FORMAT) errors.push(`format must be "${TOWER_FORMAT}"`);
  if (o.version !== TOWER_FORMAT_VERSION) errors.push(`version must be ${TOWER_FORMAT_VERSION}`);
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) errors.push('id must be 1-40 letters, digits or dashes');
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 40) errors.push('name must be 1-40 characters');
  if (o.blurb !== undefined && (typeof o.blurb !== 'string' || o.blurb.length > 140)) errors.push('blurb must be a string of at most 140 characters');
  if (o.yaw !== undefined && !num(o.yaw, -3600, 3600)) errors.push('yaw must be a number of degrees');
  if (!Array.isArray(o.plinths)) errors.push('plinths must be an array');
  else
    o.plinths.forEach((p, i) => {
      if (!p || !num(p.x, -60, 60) || !num(p.z, -60, 60) || !num(p.w, 0.2, 60) || !num(p.d, 0.2, 60)) errors.push(`plinth ${i}: needs x, z, w, d`);
      if (p && p.h !== undefined && !num(p.h, 0.1, 10)) errors.push(`plinth ${i}: h must be 0.1-10`);
      if (p && p.ang !== undefined && !num(p.ang, -3600, 3600)) errors.push(`plinth ${i}: ang must be degrees`);
    });
  if (!Array.isArray(o.pieces)) errors.push('pieces must be an array');
  else {
    if (o.pieces.length === 0) errors.push('a tower needs at least one piece');
    if (o.pieces.length > 1500) errors.push('too many pieces (1500 max)');
    o.pieces.forEach((p, i) => {
      if (!p || !num(p.x, -60, 60) || !num(p.z, -60, 60) || !num(p.y, 0, 80) || !num(p.len, 0.5, 40)) errors.push(`piece ${i}: needs x, y, z, len`);
      if (p && p.ang !== undefined && !num(p.ang, -3600, 3600)) errors.push(`piece ${i}: ang must be degrees`);
      if (p && p.w !== undefined && !num(p.w, 0.3, 4)) errors.push(`piece ${i}: w must be 0.3-4`);
      if (p && p.h !== undefined && !num(p.h, 0.2, 2)) errors.push(`piece ${i}: h must be 0.2-2`);
    });
  }
  if (!Array.isArray(o.crowns)) errors.push('crowns must be an array');
  else {
    if (o.crowns.length === 0) warnings.push('no crowns: the tower can only end by being pulled apart');
    if (o.crowns.length > 24) errors.push('too many crowns (24 max)');
    o.crowns.forEach((c, i) => {
      if (!c || !num(c.x, -60, 60) || !num(c.z, -60, 60) || !num(c.y, 0, 80)) errors.push(`crown ${i}: needs x, y, z`);
      if (c && c.size !== undefined && !num(c.size, 0.4, 2)) errors.push(`crown ${i}: size must be 0.4-2`);
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

const rad = (deg = 0) => (deg * Math.PI) / 180;
/** radians -> degrees in (-180, 180], rounded to hundredths */
const deg = (r = 0) => {
  let d = ((r * 180) / Math.PI) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return Math.round(d * 100) / 100;
};
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** A playable tower from a (valid) tower file. */
export function towerFromJson(t: TowerJson): LevelDef & { substeps: number; yaw?: number } {
  return {
    id: t.id,
    name: t.name,
    blurb: t.blurb ?? '',
    modes: ['pull'],
    substeps: 1,
    yaw: t.yaw,
    build(b: Builder) {
      for (const p of t.plinths) b.plinth(p.x, p.z, p.w, p.d, p.h ?? 1, rad(p.ang));
      // pieces stand on whichever plinth is under them (that decides what counts as "fallen off")
      for (const p of t.pieces) {
        b.base = plinthUnder(t.plinths, p.x, p.z);
        b.box(p.gold ? 'jgold' : 'jenga', p.x, p.y, p.z, p.len, p.h ?? PIECE_HEIGHT, p.w ?? PIECE_WIDTH, rad(p.ang));
      }
      for (const c of t.crowns) {
        b.base = plinthUnder(t.plinths, c.x, c.z);
        b.box('crown', c.x, c.y, c.z, c.size ?? 1, c.size ?? 1, c.size ?? 1);
      }
    },
  };
}

/** Height of the plinth under (x, z), or of the nearest one for a block hanging out past every plinth. */
function plinthUnder(ps: PlinthJson[], x: number, z: number): number {
  let best = 0, bestDist = Infinity;
  for (const p of ps) {
    const c = Math.cos(rad(p.ang)), s = Math.sin(rad(p.ang));
    const dx = x - p.x, dz = z - p.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const dist = Math.hypot(Math.max(0, Math.abs(lx) - p.w / 2), Math.max(0, Math.abs(lz) - p.d / 2));
    if (dist < bestDist) {
      bestDist = dist;
      best = p.h ?? 1;
    }
  }
  return best;
}

/** Write a tower (any LevelDef, built) out as a tower file. */
export function towerToJson(def: LevelDef & { yaw?: number }, seed = 1): TowerJson {
  const spec = buildLevel(def, seed);
  return specToJson(spec, { id: def.id, name: def.name, blurb: def.blurb, yaw: def.yaw });
}

export function specToJson(spec: LevelSpec, meta: { id: string; name: string; blurb?: string; yaw?: number }): TowerJson {
  const pieces: PieceJson[] = [];
  const crowns: CrownJson[] = [];
  for (const k of spec.blocks) {
    const bottom = r4(k.y - k.sy / 2 - LAYER_GAP);
    if (k.type === 'crown') crowns.push({ x: r4(k.x), y: bottom, z: r4(k.z), ...(k.sx !== 1 ? { size: r4(k.sx) } : {}) });
    else if (k.type === 'jenga' || k.type === 'jgold') {
      const p: PieceJson = { x: r4(k.x), y: bottom, z: r4(k.z), len: r4(k.sx) };
      if (k.rotY) p.ang = deg(k.rotY);
      if (k.sz !== PIECE_WIDTH) p.w = r4(k.sz);
      if (k.sy !== PIECE_HEIGHT) p.h = r4(k.sy);
      if (k.type === 'jgold') p.gold = true;
      pieces.push(p);
    }
  }
  const plinths: PlinthJson[] = spec.plinths.map((p: PlinthSpec) => ({ x: r4(p.x), z: r4(p.z), w: r4(p.w), d: r4(p.d), ...(p.h !== 1 ? { h: r4(p.h) } : {}), ...(p.rotY ? { ang: deg(p.rotY) } : {}) }));
  return { format: TOWER_FORMAT, version: TOWER_FORMAT_VERSION, id: meta.id, name: meta.name, ...(meta.blurb ? { blurb: meta.blurb } : {}), ...(meta.yaw !== undefined ? { yaw: meta.yaw } : {}), plinths, pieces, crowns };
}

/** Tower file text with one piece per line, so diffs and hand edits stay readable. */
export function formatTowerJson(t: TowerJson): string {
  const row = (o: object) => '    ' + JSON.stringify(o).replace(/,/g, ', ').replace(/:/g, ': ');
  const list = (a: object[]) => (a.length ? '[\n' + a.map(row).join(',\n') + '\n  ]' : '[]');
  const head: string[] = [`  "format": ${JSON.stringify(t.format)}`, `  "version": ${t.version}`, `  "id": ${JSON.stringify(t.id)}`, `  "name": ${JSON.stringify(t.name)}`];
  if (t.blurb !== undefined) head.push(`  "blurb": ${JSON.stringify(t.blurb)}`);
  if (t.yaw !== undefined) head.push(`  "yaw": ${t.yaw}`);
  const parts = [...head, `  "plinths": ${list(t.plinths)}`, `  "pieces": ${list(t.pieces)}`, `  "crowns": ${list(t.crowns)}`];
  if (t.source !== undefined) parts.push(`  "source": ${JSON.stringify(t.source)}`);
  return '{\n' + parts.join(',\n') + '\n}\n';
}

/** Parse text into a tower file, or explain why not. */
export function parseTowerJson(text: string): { tower?: TowerJson; check: TowerCheck } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { check: { ok: false, errors: [`not valid JSON: ${(e as Error).message}`], warnings: [] } };
  }
  const check = validateTowerJson(data);
  return check.ok ? { tower: data as TowerJson, check } : { check };
}

// ---------------------------------------------------------------------------------------------
// Structural checks a design tool can show while you build (also run by the tower lab).

interface Box {
  x: number;
  z: number;
  y0: number;
  y1: number;
  hl: number; // half length (along its axis)
  hw: number; // half width
  ax: number; // axis (unit vector)
  az: number;
  kind: 'piece' | 'crown' | 'plinth';
  index: number;
}

function boxes(t: TowerJson): Box[] {
  const out: Box[] = [];
  t.plinths.forEach((p, i) => out.push({ x: p.x, z: p.z, y0: 0, y1: p.h ?? 1, hl: p.w / 2, hw: p.d / 2, ax: Math.cos(rad(p.ang)), az: -Math.sin(rad(p.ang)), kind: 'plinth', index: i }));
  t.pieces.forEach((p, i) => out.push({ x: p.x, z: p.z, y0: p.y, y1: p.y + (p.h ?? PIECE_HEIGHT), hl: p.len / 2, hw: (p.w ?? PIECE_WIDTH) / 2, ax: Math.cos(rad(p.ang)), az: -Math.sin(rad(p.ang)), kind: 'piece', index: i }));
  t.crowns.forEach((c, i) => out.push({ x: c.x, z: c.z, y0: c.y, y1: c.y + (c.size ?? 1), hl: (c.size ?? 1) / 2, hw: (c.size ?? 1) / 2, ax: 1, az: 0, kind: 'crown', index: i }));
  return out;
}

/** Do two boxes' footprints overlap (separating-axis test on their two axes each)? */
function footprintsOverlap(a: Box, b: Box, tol = 0.005): boolean {
  const axes = [
    [a.ax, a.az],
    [-a.az, a.ax],
    [b.ax, b.az],
    [-b.az, b.ax],
  ];
  for (const [nx, nz] of axes) {
    const proj = (c: Box) => {
      const center = c.x * nx + c.z * nz;
      const r = Math.abs(c.ax * nx + c.az * nz) * c.hl + Math.abs(-c.az * nx + c.ax * nz) * c.hw;
      return [center - r, center + r];
    };
    const [a0, a1] = proj(a), [b0, b1] = proj(b);
    if (a1 <= b0 + tol || b1 <= a0 + tol) return false;
  }
  return true;
}

/** Points along a box's centre line and edges, for support sampling. */
function samples(c: Box): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = -4; i <= 4; i++)
    for (const w of [-0.8, 0, 0.8]) {
      const l = (c.hl * i) / 4.2, s = c.hw * w;
      pts.push([c.x + c.ax * l - c.az * s, c.z + c.az * l + c.ax * s]);
    }
  return pts;
}
function inside(c: Box, x: number, z: number): boolean {
  const dx = x - c.x, dz = z - c.z;
  return Math.abs(dx * c.ax + dz * c.az) <= c.hl + 0.001 && Math.abs(-dx * c.az + dz * c.ax) <= c.hw + 0.001;
}

const label = (b: Box) => `${b.kind} ${b.index} at (${b.x.toFixed(2)}, ${b.y0.toFixed(2)}, ${b.z.toFixed(2)})`;

/**
 * Things that make a tower unplayable or unfair, found without running physics:
 *  - two blocks occupying the same space (the physics would fling them apart)
 *  - a block with nothing under it (it drops at build time)
 *  - a piece whose only support is one piece running the same way (pulling that one drops it)
 */
export function analyzeTower(t: TowerJson): TowerCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = boxes(t);
  const solids = all.filter((b) => b.kind !== 'plinth');
  // overlaps
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (a.y1 <= b.y0 + 0.002 || b.y1 <= a.y0 + 0.002) continue;
      if (footprintsOverlap(a, b)) errors.push(`${label(a)} overlaps ${label(b)}`);
    }
  for (const a of solids)
    for (const p of all)
      if (p.kind === 'plinth' && a.y0 < p.y1 - 0.002 && footprintsOverlap(a, p)) errors.push(`${label(a)} is inside plinth ${p.index}`);
  // support: every block needs something directly under some of its footprint
  for (const a of solids) {
    const under = all.filter((b) => b !== a && Math.abs(b.y1 - a.y0) <= 0.03 + LAYER_GAP);
    const touching = under.filter((b) => samples(a).some(([x, z]) => inside(b, x, z)));
    if (!touching.length) {
      if (a.y0 <= 0.03) continue; // on the ground
      errors.push(`${label(a)} has nothing under it`);
      continue;
    }
    if (a.kind === 'piece' && touching.length === 1 && touching[0].kind === 'piece') {
      const b = touching[0];
      if (Math.abs(a.ax * b.ax + a.az * b.az) > 0.9) warnings.push(`${label(a)} rests only on a piece running the same way (pulling that one drops it)`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Everything at once: shape, then structure. */
export function checkTowerJson(t: unknown): TowerCheck {
  const v = validateTowerJson(t);
  if (!v.ok) return v;
  const a = analyzeTower(t as TowerJson);
  return { ok: a.ok, errors: a.errors, warnings: [...v.warnings, ...a.warnings] };
}

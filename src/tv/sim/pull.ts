// Tower Pull rules shared by the game mode and the headless tower tests, so both agree on what
// counts as "pulled out" and "toppled".

import { pos, type Entity, type V3 } from './sim';

/** Pieces a player can grab. */
export const isPiece = (e: Entity) => (e.type === 'jenga' || e.type === 'jgold') && !e.gone;

/** Length of a piece (its long horizontal side). */
export const pieceLength = (e: Entity) => Math.max(e.size.x, e.size.z);

/** World-space horizontal unit vector along the piece's length, from its current rotation. */
export function pieceAxis(e: Entity): V3 {
  const q = e.body.rotation();
  const alongX = e.size.x >= e.size.z;
  // rotate the local long axis by the body's quaternion
  const lx = alongX ? 1 : 0, lz = alongX ? 0 : 1;
  const { x, y, z, w } = q;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const cx = y * lz - z * 0, cy = z * lx - x * lz, cz = x * 0 - y * lx;
  const ccx = y * cz - z * cy, ccz = x * cy - y * cx;
  let ax = lx + 2 * (w * cx + ccx);
  let az = lz + 2 * (w * cz + ccz);
  const l = Math.hypot(ax, az) || 1;
  ax /= l;
  az /= l;
  return { x: ax, y: 0, z: az };
}

/** How far a piece has slid along `axis` from where it was built (signed). */
export function outDistance(e: Entity, axis: V3): number {
  const p = pos(e);
  return (p.x - e.home.x) * axis.x + (p.z - e.home.z) * axis.z;
}

/** Slide distance at which a piece counts as out (and is lifted away). */
export const outThreshold = (e: Entity) => 0.72 * pieceLength(e);

/** How much a thumb movement of 1 moves the grab target: longer pieces need to travel further. */
export const pullReach = (e: Entity) => 2.6 * Math.max(1, pieceLength(e) / 3);

/** Where something was, and how level it was (1 = flat, 0 = on its side), at the start of a turn. */
export interface Pose {
  p: V3;
  up: number;
}
export function pose(e: Entity): Pose {
  const q = e.body.rotation();
  // y component of the body's local up axis
  return { p: pos(e), up: 1 - 2 * (q.x * q.x + q.z * q.z) };
}
export function snapshotOf(ents: Entity[]): Map<Entity, Pose> {
  const m = new Map<Entity, Pose>();
  for (const e of ents) m.set(e, pose(e));
  return m;
}

/** A piece has fallen once it drops most of a layer or tips well over. Sliding sideways doesn't count. */
export const FALL_DROP = 0.45;
const TIP_UP = 0.8; // about 37 degrees
const CROWN_TIP_UP = 0.7;

function dropped(e: Entity, p0: Pose, tip: number): boolean {
  if (e.gone) return true; // fell off the island entirely
  const now = pose(e);
  return p0.p.y - now.p.y > FALL_DROP || now.up < Math.min(tip, p0.up - 0.1);
}

/** Pieces (not crowns) that have fallen since `snapshot`, skipping any in `skip`. */
export function fallenPieces(snapshot: Map<Entity, Pose>, skip?: Set<Entity>): Entity[] {
  const out: Entity[] = [];
  for (const [e, p0] of snapshot) {
    if (e.type === 'crown' || skip?.has(e)) continue;
    if (dropped(e, p0, TIP_UP)) out.push(e);
  }
  return out;
}

/** The first crown that has fallen since `snapshot` (that ends the tower), or null. */
export function fallenCrown(snapshot: Map<Entity, Pose>): Entity | null {
  for (const [e, p0] of snapshot) if (e.type === 'crown' && dropped(e, p0, CROWN_TIP_UP)) return e;
  return null;
}

/** Points lost for knocking other pieces down on a turn (the tower keeps going unless a crown fell). */
export const spillPenalty = (fell: number) => Math.min(15, 5 * fell);

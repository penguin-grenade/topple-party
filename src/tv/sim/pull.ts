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

export const TOPPLE_MOVE = 0.85;
export const CROWN_DROP = 0.45;

/** Did anything (other than the piece in hand) fall or get knocked out of place since `snapshot`? */
export function toppled(snapshot: Map<Entity, V3>, except: Entity | null): Entity | null {
  for (const [e, p0] of snapshot) {
    if (e.gone || e === except) continue;
    const p = pos(e);
    const d = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    if (d > TOPPLE_MOVE || (e.type === 'crown' && p0.y - p.y > CROWN_DROP)) return e;
  }
  return null;
}

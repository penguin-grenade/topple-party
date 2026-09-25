// Little side-on drawings of each Tower Pull tower for the lobby's tower picker.

import { buildLevel } from './sim/levels';
import { TOWERS } from './sim/towers';

const cache = new WeakMap<object, string>();

/** SVG silhouette of tower `i`, seen from roughly where the game camera starts. */
export function towerSilhouette(i: number): string {
  const def = TOWERS[i];
  const hit = cache.get(def);
  if (hit) return hit;
  const spec = buildLevel(def, 1);
  const yaw = ((def.yaw ?? 35.6) * Math.PI) / 180;
  const ux = Math.cos(yaw), uz = -Math.sin(yaw); // screen-right direction
  const shapes: { u0: number; u1: number; y0: number; y1: number; fill: string; depth: number }[] = [];
  const add = (x: number, z: number, sx: number, sz: number, rot: number, y0: number, y1: number, fill: string) => {
    let u0 = Infinity, u1 = -Infinity;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      // local corner -> world (rotY turns local +x into (cos, 0, -sin))
      const lx = (a * sx) / 2, lz = (b * sz) / 2;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const u = wx * ux + wz * uz;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
    }
    shapes.push({ u0, u1, y0, y1, fill, depth: x * Math.sin(yaw) + z * Math.cos(yaw) });
  };
  for (const p of spec.plinths) add(p.x, p.z, p.w, p.d, p.rotY, 0, p.h, '#bcc6da');
  for (const k of spec.blocks) add(k.x, k.z, k.sx, k.sz, k.rotY, k.y - k.sy / 2, k.y + k.sy / 2, k.type === 'crown' ? '#ffd23f' : k.type === 'jgold' ? '#ffc21a' : '#f1cf98');
  let u0 = Infinity, u1 = -Infinity, top = 0;
  for (const s of shapes) {
    u0 = Math.min(u0, s.u0);
    u1 = Math.max(u1, s.u1);
    top = Math.max(top, s.y1);
  }
  // draw far pieces first so nearer ones overlap them
  shapes.sort((a, b) => a.depth - b.depth);
  const pad = 0.4;
  const w = u1 - u0 + pad * 2, h = top + pad * 2;
  const r = (v: number) => v.toFixed(2);
  const rects = shapes
    .map((s) => `<rect x="${r(s.u0 - u0 + pad)}" y="${r(top - s.y1 + pad)}" width="${r(s.u1 - s.u0)}" height="${r(s.y1 - s.y0)}" fill="${s.fill}" stroke="#8a6232" stroke-width="0.05"/>`)
    .join('');
  const svg = `<svg class="tSil" viewBox="0 0 ${r(w)} ${r(h)}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${rects}</svg>`;
  cache.set(def, svg);
  return svg;
}

// The plan view: a top-down canvas of one layer at a time, where pieces are placed and moved.
// x runs right, z runs down the screen (toward where the game camera sits).

import { PIECE_HEIGHT, PIECE_WIDTH, type PieceJson } from '../tv/sim/towerFile';
import { LAYER_H, Model, PITCH, r, type Ref } from './model';

export type Tool = 'select' | 'piece' | 'row' | 'crown' | 'plinth';
export interface Settings {
  tool: Tool;
  len: number;
  ang: number;
  gold: boolean;
  crownSize: number;
  plinthH: number;
  /** grid snap in units (0 = off) */
  snap: number;
}

const COL = {
  bg: '#1c1830',
  grid: '#2a2545',
  axis: '#3d3760',
  plinth: '#7d8797',
  plinthEdge: '#b6bfcd',
  piece: '#e6c48f',
  pieceEdge: '#8a6232',
  gold: '#ffd23f',
  below: '#7a6a4f',
  belowEdge: '#4d3f2a',
  far: '#3f3730',
  above: '#5a6a8a',
  crown: '#ffd23f',
  crownEdge: '#b87400',
  sel: '#7fd6ff',
  hover: '#ffffff',
  ghost: '#7fd6ff',
  bad: '#ff5a6e',
};

export class Plan {
  private ctx: CanvasRenderingContext2D;
  /** world units per CSS pixel */
  scale = 24;
  /** world coords at the canvas centre */
  cx = 0;
  cz = 0;
  hover: Ref | null = null;
  private mouse: { x: number; z: number } | null = null;
  private drag: null | { kind: 'pan'; sx: number; sy: number; cx0: number; cz0: number } | { kind: 'move'; start: { x: number; z: number }; orig: { ref: Ref; x: number; z: number }[]; moved: boolean } | { kind: 'marquee'; start: { x: number; z: number }; add: boolean } | { kind: 'row'; start: { x: number; z: number } } | { kind: 'plinth'; start: { x: number; z: number } } = null;
  /** blocks the checks flagged (drawn red) */
  flagged = new Set<string>();
  onStatus: (s: string) => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly model: Model,
    readonly settings: Settings,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => {
      this.mouse = null;
      this.hover = null;
      this.draw();
    });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.draw();
  }
  /** Fit the whole tower footprint. */
  fit() {
    const b = this.model.bounds();
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.scale = Math.max(6, Math.min(60, 0.85 * Math.min(w / (b.maxX - b.minX + 2), h / (b.maxZ - b.minZ + 2))));
    this.draw();
  }

  // ------------------------------------------------------------------ coordinates
  private toScreen(x: number, z: number) {
    return { sx: this.canvas.clientWidth / 2 + (x - this.cx) * this.scale, sy: this.canvas.clientHeight / 2 + (z - this.cz) * this.scale };
  }
  private toWorld(sx: number, sy: number) {
    return { x: this.cx + (sx - this.canvas.clientWidth / 2) / this.scale, z: this.cz + (sy - this.canvas.clientHeight / 2) / this.scale };
  }
  private snap(v: number) {
    const s = this.settings.snap;
    return s > 0 ? r(Math.round(v / s) * s) : r(v);
  }
  private eventWorld(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  // ------------------------------------------------------------------ hit testing
  private footprint(ref: Ref): { x: number; z: number; hl: number; hw: number; ang: number } {
    const b = this.model.get(ref);
    if (ref.kind === 'piece') {
      const p = b as PieceJson;
      return { x: p.x, z: p.z, hl: p.len / 2, hw: (p.w ?? PIECE_WIDTH) / 2, ang: ((p.ang ?? 0) * Math.PI) / 180 };
    }
    if (ref.kind === 'crown') {
      const c = b as { x: number; z: number; size?: number };
      return { x: c.x, z: c.z, hl: (c.size ?? 1) / 2, hw: (c.size ?? 1) / 2, ang: 0 };
    }
    const p = b as { x: number; z: number; w: number; d: number; ang?: number };
    return { x: p.x, z: p.z, hl: p.w / 2, hw: p.d / 2, ang: ((p.ang ?? 0) * Math.PI) / 180 };
  }
  private contains(ref: Ref, x: number, z: number) {
    const f = this.footprint(ref);
    const c = Math.cos(f.ang), s = Math.sin(f.ang);
    const dx = x - f.x, dz = z - f.z;
    // rotY = ang turns local +x into (cos, 0, -sin)
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) <= f.hl && Math.abs(lz) <= f.hw;
  }
  /** Blocks on the current layer (pieces and crowns), then plinths, top-most first for hit tests. */
  private hitList(): Ref[] {
    const m = this.model, y = m.layerY;
    const out: Ref[] = [];
    m.tower.crowns.forEach((c, i) => Math.abs(c.y - y) < 0.01 && out.push({ kind: 'crown', i }));
    m.tower.pieces.forEach((p, i) => Math.abs(p.y - y) < 0.01 && out.push({ kind: 'piece', i }));
    if (this.settings.tool === 'select' || this.settings.tool === 'plinth') m.tower.plinths.forEach((_, i) => out.push({ kind: 'plinth', i }));
    return out;
  }
  hit(x: number, z: number): Ref | null {
    for (const ref of this.hitList()) if (this.contains(ref, x, z)) return ref;
    return null;
  }

  // ------------------------------------------------------------------ mouse
  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const w = this.eventWorld(e);
    const rect = this.canvas.getBoundingClientRect();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      this.drag = { kind: 'pan', sx: e.clientX - rect.left, sy: e.clientY - rect.top, cx0: this.cx, cz0: this.cz };
      return;
    }
    if (e.button !== 0) return;
    const m = this.model, s = this.settings;
    switch (s.tool) {
      case 'select': {
        const h = this.hit(w.x, w.z);
        if (h) {
          if (e.shiftKey) {
            if (m.isSelected(h)) m.selection = m.selection.filter((q) => !(q.kind === h.kind && q.i === h.i));
            else m.selection.push(h);
          } else if (!m.isSelected(h)) m.selection = [h];
          this.drag = { kind: 'move', start: w, orig: m.selection.map((ref) => ({ ref, x: (m.get(ref) as { x: number }).x, z: (m.get(ref) as { z: number }).z })), moved: false };
        } else {
          if (!e.shiftKey) m.selection = [];
          this.drag = { kind: 'marquee', start: w, add: e.shiftKey };
        }
        this.model.listeners.forEach((f) => f());
        break;
      }
      case 'piece': {
        const p: PieceJson = { x: this.snap(w.x), y: m.layerY, z: this.snap(w.z), len: s.len };
        if (s.ang) p.ang = s.ang;
        if (s.gold) p.gold = true;
        m.edit(() => {
          m.tower.pieces.push(p);
          m.selection = [{ kind: 'piece', i: m.tower.pieces.length - 1 }];
        });
        break;
      }
      case 'crown': {
        const c = { x: this.snap(w.x), y: m.layerY, z: this.snap(w.z), ...(s.crownSize !== 1 ? { size: s.crownSize } : {}) };
        m.edit(() => {
          m.tower.crowns.push(c);
          m.selection = [{ kind: 'crown', i: m.tower.crowns.length - 1 }];
        });
        break;
      }
      case 'row':
        this.drag = { kind: 'row', start: { x: this.snap(w.x), z: this.snap(w.z) } };
        break;
      case 'plinth':
        this.drag = { kind: 'plinth', start: { x: this.snap(w.x), z: this.snap(w.z) } };
        break;
    }
    this.draw();
  }

  private move(e: PointerEvent) {
    const w = this.eventWorld(e);
    this.mouse = w;
    const d = this.drag;
    const rect = this.canvas.getBoundingClientRect();
    if (d?.kind === 'pan') {
      this.cx = d.cx0 - (e.clientX - rect.left - d.sx) / this.scale;
      this.cz = d.cz0 - (e.clientY - rect.top - d.sy) / this.scale;
    } else if (d?.kind === 'move') {
      const dx = this.snap(w.x - d.start.x), dz = this.snap(w.z - d.start.z);
      if (dx || dz || d.moved) {
        d.moved = true;
        const m = this.model;
        m.edit(
          () => {
            for (const o of d.orig) {
              const b = m.get(o.ref) as { x: number; z: number };
              b.x = r(o.x + dx);
              b.z = r(o.z + dz);
            }
          },
          { coalesce: true },
        );
      }
    } else if (!d) {
      const h = this.settings.tool === 'select' ? this.hit(w.x, w.z) : null;
      this.hover = h;
    }
    this.onStatus(`x ${this.snap(w.x).toFixed(2)}  z ${this.snap(w.z).toFixed(2)}  layer y ${this.model.layerY.toFixed(3)}`);
    this.draw();
  }

  private up(e: PointerEvent) {
    const w = this.eventWorld(e);
    const d = this.drag;
    this.drag = null;
    const m = this.model, s = this.settings;
    if (!d) return;
    if (d.kind === 'move') {
      m.endDrag();
      if (!d.moved && !e.shiftKey) {
        // a plain click on an already-selected block selects just that one
        const h = this.hit(w.x, w.z);
        if (h) m.selection = [h];
      }
    } else if (d.kind === 'marquee') {
      const x0 = Math.min(d.start.x, w.x), x1 = Math.max(d.start.x, w.x), z0 = Math.min(d.start.z, w.z), z1 = Math.max(d.start.z, w.z);
      if (x1 - x0 > 0.05 || z1 - z0 > 0.05) {
        const picked = this.hitList().filter((ref) => ref.kind !== 'plinth' && this.footprintCorners(ref).every(([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1));
        m.selection = d.add ? [...m.selection, ...picked.filter((p) => !m.isSelected(p))] : picked;
      }
    } else if (d.kind === 'row') {
      const pieces = this.rowPieces(d.start, { x: this.snap(w.x), z: this.snap(w.z) });
      if (pieces.length)
        m.edit(() => {
          const i0 = m.tower.pieces.length;
          m.tower.pieces.push(...pieces);
          m.selection = pieces.map((_, k) => ({ kind: 'piece' as const, i: i0 + k }));
        });
    } else if (d.kind === 'plinth') {
      const x0 = Math.min(d.start.x, this.snap(w.x)), x1 = Math.max(d.start.x, this.snap(w.x)), z0 = Math.min(d.start.z, this.snap(w.z)), z1 = Math.max(d.start.z, this.snap(w.z));
      if (x1 - x0 >= 0.5 && z1 - z0 >= 0.5)
        m.edit(() => {
          m.tower.plinths.push({ x: r((x0 + x1) / 2), z: r((z0 + z1) / 2), w: r(x1 - x0), d: r(z1 - z0), ...(s.plinthH !== 1 ? { h: s.plinthH } : {}) });
          m.selection = [{ kind: 'plinth', i: m.tower.plinths.length - 1 }];
        });
    }
    this.model.listeners.forEach((f) => f());
    this.draw();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(4, Math.min(120, this.scale * Math.exp(-e.deltaY * 0.0015)));
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.draw();
  }

  /** Pieces side by side from `a` toward `b`, PITCH apart, running along the current angle. */
  private rowPieces(a: { x: number; z: number }, b: { x: number; z: number }): PieceJson[] {
    const s = this.settings, m = this.model;
    const ang = (s.ang * Math.PI) / 180;
    // the across direction is perpendicular to the pieces
    const ax = Math.sin(ang), az = Math.cos(ang);
    const along = (b.x - a.x) * ax + (b.z - a.z) * az;
    const n = Math.floor(Math.abs(along) / PITCH + 0.5) + 1;
    const dir = Math.sign(along) || 1;
    const out: PieceJson[] = [];
    for (let k = 0; k < n; k++) {
      const p: PieceJson = { x: r(a.x + ax * dir * k * PITCH), y: m.layerY, z: r(a.z + az * dir * k * PITCH), len: s.len };
      if (s.ang) p.ang = s.ang;
      if (s.gold) p.gold = true;
      out.push(p);
    }
    return out;
  }

  private footprintCorners(ref: Ref): [number, number][] {
    const f = this.footprint(ref);
    const c = Math.cos(f.ang), s = Math.sin(f.ang);
    const out: [number, number][] = [];
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const lx = a * f.hl, lz = b * f.hw;
      out.push([f.x + lx * c + lz * s, f.z - lx * s + lz * c]);
    }
    return out;
  }

  // ------------------------------------------------------------------ drawing
  draw() {
    const ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const W = this.canvas.clientWidth, Hh = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, Hh);
    // grid: one line per unit, brighter every 5
    const tl = this.toWorld(0, 0), br = this.toWorld(W, Hh);
    ctx.lineWidth = 1;
    for (let x = Math.floor(tl.x); x <= Math.ceil(br.x); x++) {
      ctx.strokeStyle = x === 0 ? COL.axis : x % 5 === 0 ? COL.axis : COL.grid;
      const { sx } = this.toScreen(x, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, Hh);
      ctx.stroke();
    }
    for (let z = Math.floor(tl.z); z <= Math.ceil(br.z); z++) {
      ctx.strokeStyle = z === 0 ? COL.axis : z % 5 === 0 ? COL.axis : COL.grid;
      const { sy } = this.toScreen(0, z);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.stroke();
    }
    const m = this.model, t = m.tower, y = m.layerY;
    // plinths
    t.plinths.forEach((p, i) => this.rect({ x: p.x, z: p.z, hl: p.w / 2, hw: p.d / 2, ang: ((p.ang ?? 0) * Math.PI) / 180 }, COL.plinth, COL.plinthEdge, 1, m.isSelected({ kind: 'plinth', i }) ? COL.sel : null));
    // the layer below, then two below, faint; the layer above as outlines
    const below1 = r(y - LAYER_H), below2 = r(y - 2 * LAYER_H), above = r(y + LAYER_H);
    const draw = (which: 'far' | 'below' | 'current' | 'above') => {
      t.pieces.forEach((p, i) => {
        const dy = p.y - y;
        const band = Math.abs(dy) < 0.01 ? 'current' : Math.abs(p.y - below1) < 0.01 ? 'below' : Math.abs(p.y - below2) < 0.01 ? 'far' : Math.abs(p.y - above) < 0.01 ? 'above' : null;
        if (band !== which) return;
        const f = { x: p.x, z: p.z, hl: p.len / 2, hw: (p.w ?? PIECE_WIDTH) / 2, ang: ((p.ang ?? 0) * Math.PI) / 180 };
        const ref = { kind: 'piece' as const, i };
        const flagged = this.flagged.has(`piece ${i}`);
        if (which === 'current') this.rect(f, p.gold ? COL.gold : COL.piece, flagged ? COL.bad : COL.pieceEdge, flagged ? 3 : 1.5, m.isSelected(ref) ? COL.sel : this.hover && this.hover.kind === 'piece' && this.hover.i === i ? COL.hover : null, true);
        else if (which === 'above') this.rect(f, null, COL.above, 1, null);
        else this.rect(f, which === 'below' ? COL.below : COL.far, which === 'below' ? COL.belowEdge : COL.far, 1, null);
      });
      if (which === 'current' || which === 'below')
        t.crowns.forEach((c, i) => {
          const on = Math.abs(c.y - y) < 0.01, under = Math.abs(c.y - below1) < 0.01;
          if (!(which === 'current' ? on : under)) return;
          const ref = { kind: 'crown' as const, i };
          const flagged = this.flagged.has(`crown ${i}`);
          this.rect({ x: c.x, z: c.z, hl: (c.size ?? 1) / 2, hw: (c.size ?? 1) / 2, ang: 0 }, on ? COL.crown : COL.below, flagged ? COL.bad : COL.crownEdge, flagged ? 3 : 1.5, m.isSelected(ref) ? COL.sel : this.hover && this.hover.kind === 'crown' && this.hover.i === i ? COL.hover : null);
          if (on) this.label(c.x, c.z, '♛');
        });
    };
    draw('far');
    draw('below');
    draw('current');
    draw('above');
    // ghosts for the placement tools
    const s = this.settings, mo = this.mouse, d = this.drag;
    ctx.globalAlpha = 0.55;
    if (d?.kind === 'row' && mo) for (const p of this.rowPieces(d.start, { x: this.snap(mo.x), z: this.snap(mo.z) })) this.rect({ x: p.x, z: p.z, hl: p.len / 2, hw: 0.5, ang: (s.ang * Math.PI) / 180 }, COL.ghost, COL.ghost, 1, null);
    else if (d?.kind === 'plinth' && mo) {
      const x0 = Math.min(d.start.x, this.snap(mo.x)), x1 = Math.max(d.start.x, this.snap(mo.x)), z0 = Math.min(d.start.z, this.snap(mo.z)), z1 = Math.max(d.start.z, this.snap(mo.z));
      this.rect({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hl: (x1 - x0) / 2, hw: (z1 - z0) / 2, ang: 0 }, COL.ghost, COL.ghost, 1, null);
    } else if (d?.kind === 'marquee' && mo) {
      const a = this.toScreen(d.start.x, d.start.z), b = this.toScreen(mo.x, mo.z);
      ctx.strokeStyle = COL.sel;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(a.sx, b.sx), Math.min(a.sy, b.sy), Math.abs(b.sx - a.sx), Math.abs(b.sy - a.sy));
      ctx.setLineDash([]);
    } else if (mo && !d) {
      if (s.tool === 'piece' || s.tool === 'row') this.rect({ x: this.snap(mo.x), z: this.snap(mo.z), hl: s.len / 2, hw: 0.5, ang: (s.ang * Math.PI) / 180 }, COL.ghost, COL.ghost, 1, null, true);
      else if (s.tool === 'crown') this.rect({ x: this.snap(mo.x), z: this.snap(mo.z), hl: s.crownSize / 2, hw: s.crownSize / 2, ang: 0 }, COL.ghost, COL.ghost, 1, null);
    }
    ctx.globalAlpha = 1;
    // compass: which way is the camera (z is toward it)
    ctx.fillStyle = '#9a93b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('x →', 10, Hh - 10);
    ctx.fillText('z ↓ (toward the TV camera)', 10, Hh - 26);
  }

  private rect(f: { x: number; z: number; hl: number; hw: number; ang: number }, fill: string | null, edge: string, lw: number, outline: string | null, grain = false) {
    const ctx = this.ctx;
    const { sx, sy } = this.toScreen(f.x, f.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-f.ang); // world rotY turns +x toward -z, which is up on screen
    const w = f.hl * 2 * this.scale, h = f.hw * 2 * this.scale;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    if (grain && fill && this.scale > 12) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, 0);
      ctx.lineTo(w / 2 - 3, 0);
      ctx.stroke();
    }
    ctx.strokeStyle = edge;
    ctx.lineWidth = lw;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
    }
    ctx.restore();
  }
  private label(x: number, z: number, text: string) {
    const { sx, sy } = this.toScreen(x, z);
    const ctx = this.ctx;
    ctx.fillStyle = '#5a3a00';
    ctx.font = `${Math.max(9, this.scale * 0.6)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sx, sy);
  }
}

export { PIECE_HEIGHT };

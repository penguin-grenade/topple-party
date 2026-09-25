// The editor's document: a tower file plus selection, undo history and autosave.

import { PIECE_HEIGHT, PIECE_PITCH, LAYER_GAP, TOWER_FORMAT, TOWER_FORMAT_VERSION, type TowerJson, type PieceJson, type CrownJson, type PlinthJson } from '../tv/sim/towerFile';

export const LAYER_H = PIECE_HEIGHT + LAYER_GAP; // 0.603
export const PITCH = PIECE_PITCH; // 1.02
export type Kind = 'piece' | 'crown' | 'plinth';
export interface Ref {
  kind: Kind;
  i: number;
}
export type Block = PieceJson | CrownJson | PlinthJson;

const AUTOSAVE = 'topple.editor';

export function emptyTower(): TowerJson {
  return { format: TOWER_FORMAT, version: TOWER_FORMAT_VERSION, id: 'my-tower', name: 'My Tower', blurb: '', plinths: [{ x: 0, z: 0, w: 3.8, d: 3.8 }], pieces: [], crowns: [] };
}

/** The classic 14-layer stack, as a starting point. */
export function starterTower(): TowerJson {
  const t = emptyTower();
  for (let i = 0; i < 14; i++)
    for (let k = -1; k <= 1; k++) {
      const y = r(1 + i * LAYER_H);
      if (i % 2 === 0) t.pieces.push({ x: 0, y, z: r(k * PITCH), len: 3 });
      else t.pieces.push({ x: r(k * PITCH), y, z: 0, len: 3, ang: 90 });
    }
  t.crowns.push({ x: 0, y: r(1 + 14 * LAYER_H), z: 0 });
  return t;
}

export const r = (v: number) => Math.round(v * 1000) / 1000;

export class Model {
  tower: TowerJson;
  selection: Ref[] = [];
  /** the layer being edited: the bottom height of blocks placed now */
  layerY = 1;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  listeners: (() => void)[] = [];
  /** set while a drag is in progress so each mouse move doesn't become an undo step */
  private dragging = false;

  constructor() {
    this.tower = this.loadAutosave() ?? starterTower();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  /** Call around any edit. */
  edit(fn: () => void, opts: { coalesce?: boolean } = {}) {
    if (!opts.coalesce || !this.dragging) {
      this.undoStack.push(JSON.stringify(this.tower));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    if (opts.coalesce) this.dragging = true;
    fn();
    this.tidy();
    this.autosave();
    this.emit();
  }
  /** End a coalesced drag: the next edit starts a fresh undo step. */
  endDrag() {
    this.dragging = false;
  }
  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(JSON.stringify(this.tower));
    this.tower = JSON.parse(s);
    this.selection = [];
    this.autosave();
    this.emit();
  }
  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(JSON.stringify(this.tower));
    this.tower = JSON.parse(s);
    this.selection = [];
    this.autosave();
    this.emit();
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  /** Replace the whole document (open a file, load an example). */
  replace(t: TowerJson) {
    this.undoStack.push(JSON.stringify(this.tower));
    this.redoStack = [];
    this.tower = t;
    this.selection = [];
    this.layerY = this.levels()[0] ?? 1;
    this.tidy();
    this.autosave();
    this.emit();
  }

  private tidy() {
    const t = this.tower;
    for (const p of t.pieces) {
      p.x = r(p.x);
      p.y = r(p.y);
      p.z = r(p.z);
      p.len = r(p.len);
      if (p.ang !== undefined) {
        p.ang = r(((p.ang % 360) + 540) % 360) - 180;
        if (p.ang === -180) p.ang = 180;
        if (p.ang === 0) delete p.ang;
      }
      if (p.gold === false) delete p.gold;
    }
    for (const c of t.crowns) {
      c.x = r(c.x);
      c.y = r(c.y);
      c.z = r(c.z);
      if (c.size === 1) delete c.size;
    }
    for (const p of t.plinths) {
      p.x = r(p.x);
      p.z = r(p.z);
      p.w = r(p.w);
      p.d = r(p.d);
      if (p.h === 1) delete p.h;
      if (p.ang === 0) delete p.ang;
    }
  }

  private autosave() {
    try {
      localStorage.setItem(AUTOSAVE, JSON.stringify(this.tower));
    } catch {
      /* ignore */
    }
  }
  private loadAutosave(): TowerJson | null {
    try {
      const t = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null');
      return t && t.format === TOWER_FORMAT ? t : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ queries
  get(ref: Ref): Block {
    return ref.kind === 'piece' ? this.tower.pieces[ref.i] : ref.kind === 'crown' ? this.tower.crowns[ref.i] : this.tower.plinths[ref.i];
  }
  isSelected(ref: Ref) {
    return this.selection.some((s) => s.kind === ref.kind && s.i === ref.i);
  }
  /** Distinct bottom heights in use, plus the plinth tops, sorted. */
  levels(): number[] {
    const ys = new Set<number>();
    for (const p of this.tower.plinths) ys.add(r(p.h ?? 1));
    for (const p of this.tower.pieces) ys.add(r(p.y));
    for (const c of this.tower.crowns) ys.add(r(c.y));
    return [...ys].sort((a, b) => a - b);
  }
  /** The top of the tower: where the next layer would go. */
  topY(): number {
    let top = Math.max(0, ...this.tower.plinths.map((p) => p.h ?? 1));
    for (const p of this.tower.pieces) top = Math.max(top, p.y + (p.h ?? PIECE_HEIGHT) + LAYER_GAP);
    for (const c of this.tower.crowns) top = Math.max(top, c.y + (c.size ?? 1) + LAYER_GAP);
    return r(top);
  }
  onLayer(y: number, ref: Ref) {
    const b = this.get(ref);
    if (ref.kind === 'plinth') return false;
    return Math.abs((b as PieceJson).y - y) < 0.01;
  }
  bounds() {
    let minX = -3, maxX = 3, minZ = -3, maxZ = 3;
    const grow = (x: number, z: number, hx: number, hz: number) => {
      minX = Math.min(minX, x - hx);
      maxX = Math.max(maxX, x + hx);
      minZ = Math.min(minZ, z - hz);
      maxZ = Math.max(maxZ, z + hz);
    };
    for (const p of this.tower.plinths) grow(p.x, p.z, p.w / 2, p.d / 2);
    for (const p of this.tower.pieces) grow(p.x, p.z, p.len / 2, p.len / 2);
    for (const c of this.tower.crowns) grow(c.x, c.z, 0.5, 0.5);
    return { minX, maxX, minZ, maxZ };
  }
}

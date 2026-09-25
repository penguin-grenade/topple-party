// Simulated pulls, one frame at a time, so the tower lab can run them flat out and the tower
// editor can animate them. The bookkeeping (what counts as out, spilled, or a dropped crown) is
// the game's own, from pull.ts.

import { pos, type Entity, type Sim, type V3 } from './sim';
import { fallenCrown, fallenPieces, outDistance, outThreshold, pieceAxis, snapshotOf } from './pull';

export const FRAME = 1 / 60;

export interface PullResult {
  /** the piece came all the way out */
  out: boolean;
  /** it never came out (blocked both ways) */
  stuck: boolean;
  /** a crown fell: the tower is over */
  crown: boolean;
  /** other pieces knocked down (and cleared away) */
  fell: number;
  /** sim seconds the pull took */
  secs: number;
  /** the tower was still moving when the check phase gave up waiting */
  slowSettle: boolean;
}

export interface PullOptions {
  /** +1 / -1: which way along its axis to pull; default: away from `center` */
  sign?: number;
  center?: V3;
  /** target travel speed, units per second */
  speed?: number;
  /** sideways wiggle amplitude */
  wiggle?: number;
}

/** Fastest speed of anything awake (except `except`). */
export function movement(sim: Sim, except?: Entity): number {
  let m = 0;
  for (const e of sim.blocks()) {
    if (e === except || e.body.isSleeping()) continue;
    const v = e.body.linvel();
    m = Math.max(m, Math.hypot(v.x, v.y, v.z));
  }
  return m;
}

/**
 * Grab a piece, slide it out toward the nearer end (or `sign`), wiggling a little, at `speed`
 * units/s of target travel, then wait for the tower to settle the way the game's check phase does,
 * clearing what fell and settling again. Call tick() once per frame until it returns true.
 */
export class PullRun {
  result: PullResult | null = null;
  readonly axis: V3;
  readonly snapshot;
  readonly rubble = new Set<Entity>();
  private sign: number;
  private readonly thr: number;
  private readonly speed: number;
  private readonly wiggle: number;
  private t = 0;
  private out = false;
  private tried = false;
  private lastProgressT = 0;
  private best = 0;
  private phase: 'pull' | 'settle' = 'pull';
  private settleT = 0;
  private round = 0;
  private fell = 0;
  private slow = false;

  constructor(
    readonly sim: Sim,
    readonly piece: Entity,
    opts: PullOptions = {},
  ) {
    this.axis = pieceAxis(piece);
    const c = opts.center ?? { x: 0, y: 0, z: 0 };
    const p0 = pos(piece);
    this.sign = opts.sign ?? (Math.sign((p0.x - c.x) * this.axis.x + (p0.z - c.z) * this.axis.z) || 1);
    this.thr = outThreshold(piece);
    this.speed = opts.speed ?? 1.3;
    this.wiggle = opts.wiggle ?? 0.4;
    this.snapshot = snapshotOf(sim.blocks());
    sim.grabStart(piece, this.axis);
  }

  /** Pieces that fell so far this turn (not counting ones already cleared). */
  private watch() {
    for (const f of fallenPieces(this.snapshot, this.rubble)) {
      if (f === this.piece) this.out = true; // the piece in hand tipped out: that's the pull
      else this.rubble.add(f);
    }
  }
  private finish(r: Omit<PullResult, 'secs' | 'slowSettle'>): true {
    this.result = { ...r, secs: this.t, slowSettle: this.slow };
    return true;
  }

  /** One frame. Returns true once the result is in. */
  tick(): boolean {
    if (this.result) return true;
    const { sim, piece: e, axis } = this;
    if (this.phase === 'pull') {
      const along = this.sign * Math.min(this.thr + 1.2, (this.t - this.lastProgressT) * this.speed);
      const perp = Math.sin(this.t * 7) * this.wiggle;
      sim.grabOffset(axis.x * along - axis.z * perp, axis.z * along + axis.x * perp);
      sim.step();
      this.t += FRAME;
      const od = outDistance(e, axis) * this.sign;
      if (od > this.best + 0.05) this.best = od;
      if (Math.abs(outDistance(e, axis)) > this.thr) this.out = true;
      if (fallenCrown(this.snapshot)) {
        sim.grabEnd();
        return this.finish({ out: false, stuck: false, crown: true, fell: this.rubble.size });
      }
      this.watch();
      // no progress for a while (blocked at that end): try the other way once, as a player would
      if (!this.out && this.t - this.lastProgressT > 2.5 && this.best < this.thr * 0.5 && !this.tried) {
        this.tried = true;
        this.sign = -this.sign;
        this.lastProgressT = this.t;
        this.best = 0;
      }
      if (this.out) {
        sim.grabEnd();
        sim.remove(e);
        this.snapshot.delete(e);
        this.phase = 'settle';
        this.settleT = 0;
        return false;
      }
      if (this.t >= 14) {
        sim.grabEnd();
        return this.finish({ out: false, stuck: true, crown: false, fell: this.rubble.size });
      }
      return false;
    }
    // check phase: settle (2.4 s at least, 9 s at most), clear what fell, settle again
    sim.step();
    this.settleT += FRAME;
    if (fallenCrown(this.snapshot)) return this.finish({ out: true, stuck: false, crown: true, fell: this.fell + this.rubble.size });
    this.watch();
    const calm = this.settleT > 2.4 && movement(sim) < 0.2;
    if (!calm && this.settleT < 9) return false;
    if (this.settleT >= 9) this.slow = true;
    if (!this.rubble.size || this.round === 5) return this.finish({ out: true, stuck: false, crown: false, fell: this.fell });
    for (const r of this.rubble) {
      sim.remove(r);
      this.snapshot.delete(r);
      this.fell++;
    }
    this.rubble.clear();
    this.round++;
    this.settleT = 1.2;
    return false;
  }

  /** Run to the end (the tower lab). */
  run(): PullResult {
    while (!this.tick());
    return this.result!;
  }
}

/** The centre of the pieces still standing: pulls go away from it. */
export function towerCenter(sim: Sim): V3 {
  const ps = sim.blocks().filter((e) => e.type === 'jenga' || e.type === 'jgold');
  let x = 0, z = 0;
  for (const e of ps) {
    x += e.home.x;
    z += e.home.z;
  }
  return { x: x / Math.max(1, ps.length), y: 0, z: z / Math.max(1, ps.length) };
}

/**
 * Let a freshly built tower settle and then keep every piece awake for a while (as a long turn
 * would): nothing may fall and nothing may creep. tick() once per frame until true.
 */
export class SettleRun {
  result: { ok: boolean; fell: Entity[]; creep: number; secs: number } | null = null;
  private frames = 0;
  private snapshot: ReturnType<typeof snapshotOf> | null = null;
  private start: Map<Entity, V3> | null = null;
  constructor(
    readonly sim: Sim,
    readonly settleFrames = 90,
    readonly watchFrames = 20 * 60,
  ) {}
  tick(): boolean {
    if (this.result) return true;
    const sim = this.sim;
    if (this.frames < this.settleFrames) {
      if (this.frames === 0) for (const e of sim.ents) e.body.wakeUp();
      sim.step();
      this.frames++;
      if (this.frames === this.settleFrames) {
        this.snapshot = snapshotOf(sim.blocks());
        this.start = new Map(sim.blocks().map((e) => [e, pos(e)]));
      }
      return false;
    }
    if ((this.frames - this.settleFrames) % 30 === 0) for (const e of sim.ents) e.body.wakeUp();
    sim.step();
    this.frames++;
    const fell = [...fallenPieces(this.snapshot!), ...(fallenCrown(this.snapshot!) ? [fallenCrown(this.snapshot!)!] : [])];
    const done = fell.length > 0 || this.frames >= this.settleFrames + this.watchFrames;
    if (!done) return false;
    let creep = 0;
    for (const [e, p0] of this.start!) if (!e.gone) creep = Math.max(creep, Math.hypot(pos(e).x - p0.x, pos(e).y - p0.y, pos(e).z - p0.z));
    this.result = { ok: fell.length === 0 && creep < 0.1, fell, creep, secs: this.frames * FRAME };
    return true;
  }
}

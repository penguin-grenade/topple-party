import type { PadView } from '../shared/protocol';
import type { Game, Player } from './game';
import { BLOCK_TYPES, isPrize, type BlockType } from './sim/blocks';
import { buildLevel, levelsFor, PRACTICE, TOWER, JENGA_LAYERS, JENGA_H, type LevelDef } from './sim/levels';
import { pos, type Entity, type SimEvent, type V3 } from './sim/sim';

export type PadPart = Pick<PadView, 'screen' | 'title' | 'sub' | 'control' | 'ammo' | 'camera'>;
export interface HudPart {
  left: string;
  center: string;
  sub?: string;
  urgent?: boolean;
  showJoin?: boolean;
}
export type ScoreEvent = Extract<SimEvent, { e: 'score' }>;

export abstract class Mode {
  finished = false;
  constructor(protected game: Game) {}
  abstract start(): void;
  abstract update(dt: number): void;
  abstract view(p: Player): PadPart;
  abstract hud(): HudPart;
  canThrow(_p: Player): boolean {
    return false;
  }
  cooldown(_p: Player): number {
    return 0.75;
  }
  onThrow(_p: Player): void {}
  /** Decide who gets points for a knocked-off block. */
  onScore(ev: ScoreEvent): { player: Player | null; points: number } | null {
    return { player: this.game.byId(ev.player), points: ev.points };
  }
  onGrab(_p: Player, _x: number, _y: number): void {}
  onPull(_p: Player, _d: number, _s: number): void {}
  onRelease(_p: Player): void {}
  onCamera(_p: Player, _dx: number, _dy: number, _dz: number): void {}
  onJoin(_p: Player): void {}
  onLeave(_p: Player): void {}
  reticleVisible(p: Player): boolean {
    return this.canThrow(p);
  }
  activeId(): number | null {
    return null;
  }
  dispose(): void {}
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function pickLevels(defs: LevelDef[], n: number): LevelDef[] {
  const out: LevelDef[] = [];
  while (out.length < n) out.push(...shuffle(defs));
  return out.slice(0, n);
}
const seed = () => Math.floor(Math.random() * 1e9);

// =============================================================================== Lobby practice
export class PracticeMode extends Mode {
  private idleT = 0;
  start() {
    this.game.loadLevel(buildLevel(PRACTICE, seed()));
  }
  update(dt: number) {
    const sim = this.game.sim;
    const blocks = sim.blocks();
    const left = blocks.filter((b) => !b.scored).length;
    if ((left <= 4 || sim.time > 120) && sim.settled()) {
      this.idleT += dt;
      if (this.idleT > 2) {
        this.idleT = 0;
        for (const b of blocks) if (!b.scored) this.game.renderer.fx.poof(pos(b), '#ffffff', 3);
        this.start();
        this.game.sfx.pop();
      }
    } else this.idleT = 0;
  }
  canThrow() {
    return true;
  }
  cooldown() {
    return 0.6;
  }
  onScore(ev: ScoreEvent) {
    return { player: this.game.byId(ev.player), points: 0 };
  }
  view(p: Player): PadPart {
    const host = this.game.host();
    return {
      screen: 'lobby',
      control: 'throw',
      title: "You're in!",
      sub:
        host === p
          ? "You're the host: pick a mode and start. Practice throws meanwhile!"
          : `Waiting for ${host?.name ?? 'the host'} to start. Practice throws meanwhile!`,
    };
  }
  hud(): HudPart {
    return { left: '', center: '' };
  }
}

// =============================================================================== Blast Party
export class BlastMode extends Mode {
  private levels: LevelDef[] = [];
  private idx = -1;
  private phase: 'intro' | 'play' | 'outro' = 'intro';
  private t = 0;
  private timeLeft = 60;
  private clearT = 0;
  private lastBeep = 99;
  private startScores = new Map<number, number>();
  private endText = '';

  start() {
    this.levels = pickLevels(levelsFor('blast'), this.game.rounds);
    this.next();
  }
  private next() {
    this.idx++;
    if (this.idx >= this.levels.length) {
      this.finished = true;
      this.game.finishGame();
      return;
    }
    const spec = buildLevel(this.levels[this.idx], seed());
    this.game.loadLevel(spec);
    this.phase = 'intro';
    this.t = 0;
    this.timeLeft = spec.time;
    this.clearT = 0;
    this.lastBeep = 99;
    this.startScores = new Map(this.game.players.map((p) => [p.id, p.score]));
    this.game.hud.banner(spec.name, spec.blurb, '#ffd23f', 2600);
    this.game.pushViews();
  }
  update(dt: number) {
    this.t += dt;
    const g = this.game;
    if (this.phase === 'intro' && this.t > 2.8) {
      this.phase = 'play';
      this.t = 0;
      g.hud.banner('GO!', '', '#6cff8f', 900);
      g.sfx.countdown(true);
      g.pushViews();
    } else if (this.phase === 'play') {
      this.timeLeft -= dt;
      const s = Math.ceil(this.timeLeft);
      if (s <= 5 && s >= 1 && s !== this.lastBeep) {
        this.lastBeep = s;
        g.sfx.countdown(false);
      }
      const prizesLeft = g.sim.blocks().some((b) => !b.scored && isPrize(b.type as BlockType));
      if (!prizesLeft) this.clearT += dt;
      if (this.timeLeft <= 0) this.end("TIME'S UP!");
      else if (this.clearT > 1.8) this.end('CLEARED!');
    } else if (this.phase === 'outro' && this.t > 4.2) {
      this.next();
    }
  }
  private end(text: string) {
    this.phase = 'outro';
    this.t = 0;
    this.endText = text;
    const g = this.game;
    let best: Player | null = null;
    let bestPts = 0;
    for (const p of g.players) {
      const d = p.score - (this.startScores.get(p.id) ?? 0);
      if (d > bestPts) {
        bestPts = d;
        best = p;
      }
    }
    g.hud.banner(text, best ? `<span style="color:${best.color}">${best.name}</span> scored the most: +${bestPts}` : 'Nobody scored this time!', '#ffffff', 3800);
    g.sfx.countdown(true);
    g.pushViews();
  }
  canThrow() {
    return this.phase === 'play';
  }
  onScore(ev: ScoreEvent) {
    if (this.phase === 'play' || (this.phase === 'outro' && this.t < 2)) return { player: this.game.byId(ev.player), points: ev.points };
    return null;
  }
  view(p: Player): PadPart {
    const L = this.levels[this.idx];
    if (this.phase === 'play') return { screen: 'play', control: 'throw', title: 'Knock blocks off!', sub: 'Gold 10 · Gem 25 · Skull −10' };
    if (this.phase === 'intro') return { screen: 'wait', control: 'none', title: L?.name ?? '', sub: 'Get ready…' };
    void p;
    return { screen: 'wait', control: 'none', title: this.endText, sub: 'Next level coming up' };
  }
  hud(): HudPart {
    const L = this.levels[this.idx];
    return {
      left: `<b>Level ${this.idx + 1}/${this.levels.length}</b> · ${L?.name ?? ''}`,
      center: this.phase === 'play' ? String(Math.max(0, Math.ceil(this.timeLeft))) : this.phase === 'intro' ? 'Get ready' : '',
      sub: this.phase === 'play' ? 'seconds' : '',
      urgent: this.phase === 'play' && this.timeLeft < 10,
      showJoin: true,
    };
  }
}

// =============================================================================== Best Shot (turns)
export class BestShotMode extends Mode {
  private levels: LevelDef[] = [];
  private round = -1;
  private order: number[] = [];
  private turnIdx = -1;
  private active: Player | null = null;
  private phase: 'intro' | 'turn' | 'settle' | 'turnEnd' | 'roundEnd' = 'intro';
  private t = 0;
  private balls = 3;
  private turnScore = 0;
  private levelSeed = 0;
  private roundScores = new Map<number, number>();

  start() {
    this.levels = pickLevels(levelsFor('best'), this.game.rounds);
    this.nextRound();
  }
  private nextRound() {
    this.round++;
    if (this.round >= this.levels.length) {
      this.finished = true;
      this.game.finishGame();
      return;
    }
    this.levelSeed = seed();
    this.order = this.game.players.filter((p) => p.connected).sort((a, b) => a.seat - b.seat).map((p) => p.id);
    this.roundScores = new Map();
    this.turnIdx = -1;
    this.nextTurn();
  }
  private nextTurn() {
    const g = this.game;
    do this.turnIdx++;
    while (this.turnIdx < this.order.length && !g.byId(this.order[this.turnIdx])?.connected);
    if (this.turnIdx >= this.order.length) {
      this.roundEnd();
      return;
    }
    this.active = g.byId(this.order[this.turnIdx]);
    const def = this.levels[this.round];
    g.loadLevel(buildLevel(def, this.levelSeed));
    this.balls = 3;
    this.turnScore = 0;
    this.phase = 'intro';
    this.t = 0;
    const a = this.active!;
    g.hud.banner(`${a.name}'s turn`, `Round ${this.round + 1}: ${def.name} — 3 balls`, a.color, 2200);
    g.buzz(a, [60, 60, 60]);
    g.pushViews();
  }
  private roundEnd() {
    const g = this.game;
    this.phase = 'roundEnd';
    this.t = 0;
    this.active = null;
    let best: Player | null = null, bestPts = -1;
    for (const [id, pts] of this.roundScores) {
      if (pts > bestPts) {
        bestPts = pts;
        best = g.byId(id);
      }
    }
    g.hud.banner('Round over!', best && bestPts > 0 ? `Best shot: <span style="color:${best.color}">${best.name}</span> +${bestPts}` : '', '#ffd23f', 3600);
    g.pushViews();
  }
  update(dt: number) {
    this.t += dt;
    const g = this.game;
    switch (this.phase) {
      case 'intro':
        if (this.t > 2.3) {
          this.phase = 'turn';
          this.t = 0;
          g.pushViews();
        }
        break;
      case 'turn':
        if (this.balls <= 0 || this.t > 30) {
          this.phase = 'settle';
          this.t = 0;
          g.pushViews();
        }
        break;
      case 'settle':
        if ((this.t > 1.8 && g.sim.settled()) || this.t > 6) {
          this.phase = 'turnEnd';
          this.t = 0;
          const a = this.active;
          if (a) {
            this.roundScores.set(a.id, (this.roundScores.get(a.id) ?? 0) + this.turnScore);
            g.hud.banner(this.turnScore > 0 ? `+${this.turnScore}` : 'No points', a.name, a.color, 1900);
          }
          g.pushViews();
        }
        break;
      case 'turnEnd':
        if (this.t > 2.1) this.nextTurn();
        break;
      case 'roundEnd':
        if (this.t > 4) this.nextRound();
        break;
    }
  }
  canThrow(p: Player) {
    return this.phase === 'turn' && p === this.active && this.balls > 0;
  }
  cooldown() {
    return 0.9;
  }
  onThrow() {
    this.balls--;
    this.game.pushViews();
  }
  onScore(ev: ScoreEvent) {
    if ((this.phase === 'turn' || this.phase === 'settle') && this.active) {
      this.turnScore += ev.points;
      return { player: this.active, points: ev.points };
    }
    return null;
  }
  onLeave(p: Player) {
    if (p === this.active && (this.phase === 'turn' || this.phase === 'intro')) {
      this.phase = 'settle';
      this.t = 5;
    }
  }
  reticleVisible(p: Player) {
    return p === this.active && (this.phase === 'turn' || this.phase === 'intro');
  }
  activeId() {
    return this.active?.id ?? null;
  }
  view(p: Player): PadPart {
    const a = this.active;
    if (p === a && this.phase === 'turn') return { screen: 'play', control: 'throw', ammo: this.balls, title: 'Your turn!', sub: `${this.balls} ball${this.balls === 1 ? '' : 's'} left` };
    if (p === a && this.phase === 'intro') return { screen: 'wait', control: 'none', ammo: 3, title: 'Your turn next!', sub: 'Point at the TV and get ready' };
    if (this.phase === 'roundEnd') return { screen: 'wait', control: 'none', title: 'Round over', sub: 'Next round coming up' };
    if (a && p !== a) return { screen: 'wait', control: 'none', title: `${a.name}'s turn`, sub: 'Watch and learn…' };
    return { screen: 'wait', control: 'none', title: 'Nice!', sub: '' };
  }
  hud(): HudPart {
    const def = this.levels[this.round];
    const a = this.active;
    const balls = a ? '●'.repeat(Math.max(0, this.balls)) + '○'.repeat(Math.max(0, 3 - this.balls)) : '';
    return {
      left: `<b>Round ${this.round + 1}/${this.levels.length}</b> · ${def?.name ?? ''}`,
      center: a ? `<span style="color:${a.color}">${a.name}</span>` : this.phase === 'roundEnd' ? 'Round over' : '',
      sub: a ? `${balls} &nbsp; +${this.turnScore}` : '',
      urgent: false,
      showJoin: true,
    };
  }
}

// =============================================================================== Tower Pull (turns)
const TURN_TIME = 30;

export class PullMode extends Mode {
  private tower = 0;
  private turnCount = 0;
  private active: Player | null = null;
  private phase: 'build' | 'intro' | 'turn' | 'check' | 'toppled' = 'build';
  private t = 0;
  private turnT = 0;
  private snapshot = new Map<Entity, V3>();
  private grabbed: Entity | null = null;
  private grabAxis: V3 = { x: 1, y: 0, z: 0 };
  private hover: Entity | null = null;
  private checkMsg = '';
  private creakT = 0;

  start() {
    this.game.renderer.camRate = 7; // snappy: the active player steers it
    this.buildTower();
  }
  dispose() {
    this.game.renderer.camRate = 2.6;
  }
  private buildTower() {
    const g = this.game;
    g.loadLevel(buildLevel(TOWER, seed()), { autoScore: false, substeps: 2 });
    this.phase = 'build';
    this.t = 0;
    this.grabbed = null;
    g.hud.banner(`Tower ${this.tower + 1} of ${g.rounds}`, "Pull blocks out. Don't drop the crown!", '#ffd23f', 2400);
    g.pushViews();
  }
  private nextTurn() {
    const g = this.game;
    const players = g.players.filter((p) => p.connected).sort((a, b) => a.seat - b.seat);
    if (!players.length) return;
    // continue the rotation from whoever went last
    const lastSeat = this.active?.seat ?? -1;
    const next = players.find((p) => p.seat > lastSeat) ?? players[0];
    this.active = next;
    this.turnCount++;
    this.phase = 'intro';
    this.t = 0;
    this.turnT = 0;
    this.grabbed = null;
    this.hover = null;
    g.renderer.setOutline(null);
    // each turn starts at the default height/zoom, looking from wherever the last player left the camera
    g.renderer.lift = 0;
    g.renderer.zoom = 1;
    g.hud.banner(`${next.name}'s turn`, 'Drag the camera pad to look around · hold GRAB to pull', next.color, 1800);
    g.buzz(next, [60, 60, 60]);
    g.pushViews();
  }
  private takeSnapshot() {
    this.snapshot.clear();
    for (const e of this.game.sim.blocks()) this.snapshot.set(e, pos(e));
  }
  private collapsed(): boolean {
    for (const [e, p0] of this.snapshot) {
      if (e.gone || e === this.grabbed) continue;
      const p = pos(e);
      const d = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
      if (d > 0.85 || (e.type === 'crown' && p0.y - p.y > 0.45)) return true;
    }
    return false;
  }
  private movement(): number {
    let m = 0;
    for (const e of this.game.sim.blocks()) {
      if (e === this.grabbed || e.body.isSleeping()) continue;
      const v = e.body.linvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z));
    }
    return m;
  }

  update(dt: number) {
    this.t += dt;
    const g = this.game;
    switch (this.phase) {
      case 'build':
        if (this.t > 2.2) this.nextTurn();
        break;
      case 'intro':
        if (this.t > 1.6) {
          this.phase = 'turn';
          this.t = 0;
          this.takeSnapshot();
          g.pushViews();
        }
        break;
      case 'turn': {
        this.turnT += dt;
        this.updateHover();
        if (this.grabbed && !this.grabbed.gone) {
          const e = this.grabbed;
          const p = pos(e);
          const out = (p.x - e.home.x) * this.grabAxis.x + (p.z - e.home.z) * this.grabAxis.z;
          const moving = Math.hypot(e.body.linvel().x, e.body.linvel().z);
          this.creakT -= dt;
          if (moving > 0.3 && this.creakT <= 0) {
            g.sfx.creak();
            this.creakT = 0.35;
          }
          if (Math.abs(out) > 2.15) this.pulledOut(e);
        }
        if (this.collapsed()) this.topple();
        else if (this.turnT > TURN_TIME) {
          this.release();
          this.checkMsg = "Time's up!";
          g.hud.banner("Time's up!", 'No points this turn', '#ffffff', 1600);
          this.phase = 'check';
          this.t = 0;
          g.pushViews();
        }
        break;
      }
      case 'check':
        if (this.collapsed()) this.topple();
        else if (this.t > 2.4 && this.movement() < 0.2) this.nextTurn();
        break;
      case 'toppled':
        if (this.t > 4.8) {
          this.tower++;
          if (this.tower >= g.rounds) {
            this.finished = true;
            g.finishGame();
          } else this.buildTower();
        }
        break;
    }
  }

  private updateHover() {
    const a = this.active;
    if (!a || this.grabbed) return;
    const hit = this.game.pick(a.aimShown.x, a.aimShown.y);
    const e = hit?.ent && hit.ent.type === 'jenga' ? hit.ent : null;
    if (e !== this.hover) {
      this.hover = e;
      this.game.renderer.setOutline(e, '#ffffff');
    }
  }

  private pulledOut(e: Entity) {
    const g = this.game;
    const a = this.active!;
    const layer = Math.round((e.home.y - 1 - JENGA_H / 2) / (JENGA_H + 0.003));
    const pts = 5 + Math.max(0, JENGA_LAYERS - 1 - layer);
    g.sim.grabEnd();
    const p = pos(e);
    g.renderer.fx.poof(p, '#f4d29b', 10);
    g.renderer.fx.sparkle(p, a.color, 16);
    g.sim.remove(e);
    g.renderer.setOutline(null);
    this.grabbed = null;
    g.sfx.pop();
    g.award(a, pts, p);
    this.checkMsg = `+${pts}`;
    this.phase = 'check';
    this.t = 0;
    g.pushViews();
  }

  private topple() {
    const g = this.game;
    const a = this.active;
    this.release();
    this.phase = 'toppled';
    this.t = 0;
    g.renderer.setOutline(null);
    g.sfx.sad();
    g.renderer.fx.shake = 0.5;
    if (a) {
      g.award(a, -15, { x: 0, y: 6, z: 0 });
      g.hud.banner('TOPPLED!', `<span style="color:${a.color}">${a.name}</span> knocked it over (−15)`, '#ff5a6e', 4200);
      g.buzz(a, [300, 100, 300]);
    }
    g.pushViews();
  }

  private release() {
    if (this.grabbed) {
      // the block the player was handling may stick out now; that's not a collapse
      if (!this.grabbed.gone) this.snapshot.set(this.grabbed, pos(this.grabbed));
      this.game.sim.grabEnd();
      this.grabbed = null;
    }
    this.game.renderer.setOutline(null);
  }

  onGrab(p: Player, x: number, y: number) {
    const g = this.game;
    if (p !== this.active || this.phase !== 'turn' || this.grabbed) return;
    p.aim = { x, y };
    const hit = g.pick(x, y);
    const e = hit?.ent;
    if (!e || e.type !== 'jenga' || e.gone) {
      g.buzz(p, [20, 40, 20]);
      return;
    }
    const alongX = e.size.x > e.size.z;
    const axis = alongX ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const c = pos(e);
    let side = (hit!.point.x - c.x) * axis.x + (hit!.point.z - c.z) * axis.z;
    if (Math.abs(side) < 0.5) {
      const cam = g.renderer.camera.position;
      side = (cam.x - c.x) * axis.x + (cam.z - c.z) * axis.z;
    }
    const s = side >= 0 ? 1 : -1;
    this.grabAxis = { x: axis.x * s, y: 0, z: axis.z * s };
    g.sim.grabStart(e, this.grabAxis);
    this.grabbed = e;
    this.hover = null;
    g.renderer.setOutline(e, p.color);
    g.buzz(p, 35);
    g.sfx.blip(true);
  }
  onCamera(p: Player, dx: number, dy: number, dz: number) {
    if (p !== this.active || (this.phase !== 'turn' && this.phase !== 'intro')) return;
    this.game.renderer.nudgeCamera(dx, dy, dz);
  }
  onPull(p: Player, d: number, s: number) {
    if (p !== this.active || !this.grabbed) return;
    this.game.sim.grabSet(d, s);
  }
  onRelease(p: Player) {
    if (p !== this.active) return;
    this.release();
  }
  onLeave(p: Player) {
    if (p === this.active && (this.phase === 'turn' || this.phase === 'intro')) {
      this.release();
      this.phase = 'check';
      this.t = 0;
    }
  }
  onScore() {
    return null;
  }
  reticleVisible(p: Player) {
    return p === this.active && this.phase === 'turn';
  }
  activeId() {
    return this.active?.id ?? null;
  }
  view(p: Player): PadPart {
    const a = this.active;
    if (this.phase === 'toppled') return { screen: 'wait', control: 'none', title: 'TOPPLED!', sub: a ? `${a.name} knocked it over` : '' };
    if (this.phase === 'build') return { screen: 'wait', control: 'none', title: 'New tower!', sub: 'Get ready…' };
    if (p === a) {
      if (this.phase === 'turn') return { screen: 'play', control: 'grab', title: 'Your turn!', sub: 'Pull one block all the way out', camera: true };
      if (this.phase === 'intro') return { screen: 'wait', control: 'none', title: 'Your turn next!', sub: 'Point at the TV', camera: true };
      return { screen: 'wait', control: 'none', title: this.checkMsg || 'Nice!', sub: 'Waiting for the tower to settle…' };
    }
    return { screen: 'wait', control: 'none', title: a ? `${a.name}'s turn` : 'Get ready', sub: 'Hold your breath…' };
  }
  hud(): HudPart {
    const a = this.active;
    const left = `<b>Tower ${this.tower + 1}/${this.game.rounds}</b> · Tower Pull`;
    if (!a || this.phase === 'build') return { left, center: '' };
    return {
      left,
      center: `<span style="color:${a.color}">${a.name}</span>`,
      sub: this.phase === 'turn' ? `${Math.max(0, Math.ceil(TURN_TIME - this.turnT))}s` : '',
      urgent: this.phase === 'turn' && TURN_TIME - this.turnT < 8,
    };
  }
}

export { BLOCK_TYPES };

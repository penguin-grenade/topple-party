// Headless game physics: blocks, balls, explosions, scoring attribution, and the Tower Pull grab.
// No three.js in here, so it can run (and be tuned) in Node.

import RAPIER from '@dimforge/rapier3d-compat';
import { BLOCK_TYPES, type BlockType } from './blocks';
import type { LevelSpec, PlinthSpec } from './levels';

export const GRAVITY = 16;
export const ISLAND_R = 17;
export const BALL_R = 0.36;
const BALL_GRAVITY = 0.55;
const DT = 1 / 60;

export interface V3 {
  x: number;
  y: number;
  z: number;
}
const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);

export interface Entity {
  id: number;
  kind: 'block' | 'ball';
  type: BlockType | 'ball';
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** full extents; for balls x=y=z=diameter */
  size: V3;
  home: V3;
  rotY: number;
  baseY: number;
  owner: number;
  ownerT: number;
  scored: boolean;
  gone: boolean;
  /** sim time at which the entity is removed (fades out during the last 0.5s) */
  dieAt: number;
  exploded: boolean;
  lastVel: V3;
  /** balls: thrower id */
  playerId: number;
  born: number;
  restT: number;
  view?: unknown;
}

export type SimEvent =
  | { e: 'hit'; a: Entity; b: Entity | null; speed: number; pos: V3 }
  | { e: 'score'; ent: Entity; player: number; points: number; pos: V3 }
  | { e: 'boom'; pos: V3; radius: number; kind: 'bomb' | 'chem'; owner: number }
  | { e: 'vanish'; ent: Entity; pos: V3; player: number }
  | { e: 'throw'; ent: Entity; player: number; power: number }
  | { e: 'remove'; ent: Entity };

interface PendingBoom {
  t: number;
  ent: Entity | null;
  pos: V3;
  kind: 'bomb' | 'chem';
  owner: number;
}

export interface Grab {
  ent: Entity;
  anchor: V3;
  axis: V3;
  side: V3;
  target: V3;
}

export interface SimOptions {
  /** award points & fade out blocks that fall off their stand (off for Tower Pull) */
  autoScore: boolean;
  /** extra physics substeps per frame for tall stacks */
  substeps: number;
}

let RAPIER_READY: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!RAPIER_READY) RAPIER_READY = RAPIER.init();
  return RAPIER_READY;
}

export class Sim {
  world!: RAPIER.World;
  private eq!: RAPIER.EventQueue;
  ents: Entity[] = [];
  private byCollider = new Map<number, Entity>();
  private nextId = 1;
  time = 0;
  events: SimEvent[] = [];
  plinths: PlinthSpec[] = [];
  level: LevelSpec | null = null;
  opts: SimOptions = { autoScore: true, substeps: 1 };
  private booms: PendingBoom[] = [];
  grab: Grab | null = null;
  /** total points still on the stands (for "level cleared") */
  paused = false;

  constructor() {
    this.makeWorld();
  }

  private makeWorld() {
    this.world = new RAPIER.World(v3(0, -GRAVITY, 0));
    this.world.numSolverIterations = 8;
    this.world.timestep = DT;
    this.eq = new RAPIER.EventQueue(true);
  }

  // ---------------------------------------------------------------- level
  load(spec: LevelSpec, opts: Partial<SimOptions> = {}) {
    this.clear();
    this.level = spec;
    this.opts = { autoScore: true, substeps: 1, ...opts };
    this.world.timestep = DT / this.opts.substeps;
    // floating island
    const island = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.6, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, ISLAND_R).setFriction(0.9).setRestitution(0.05), island);
    this.plinths = spec.plinths;
    for (const p of spec.plinths) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.h / 2, p.z).setRotation(quatY(p.rotY)));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(p.w / 2, p.h / 2, p.d / 2).setFriction(0.8).setRestitution(0.02), body);
    }
    for (const b of spec.blocks) this.addBlock(b.type, v3(b.x, b.y, b.z), v3(b.sx, b.sy, b.sz), b.rotY, b.baseY);
  }

  clear() {
    this.world.free();
    this.eq.free();
    this.makeWorld();
    for (const e of this.ents) {
      e.gone = true;
      this.events.push({ e: 'remove', ent: e });
    }
    this.ents = [];
    this.byCollider.clear();
    this.booms = [];
    this.grab = null;
    this.time = 0;
  }

  addBlock(type: BlockType, pos: V3, size: V3, rotY = 0, baseY = 0): Entity {
    const def = BLOCK_TYPES[type];
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(quatY(rotY))
        .setLinearDamping(0.05)
        .setAngularDamping(0.15)
        .setSleeping(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setDensity(def.density)
        .setFriction(def.friction)
        .setRestitution(def.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const ent: Entity = {
      id: this.nextId++,
      kind: 'block',
      type,
      body,
      collider,
      size,
      home: { ...pos },
      rotY,
      baseY,
      owner: -1,
      ownerT: -99,
      scored: false,
      gone: false,
      dieAt: Infinity,
      exploded: false,
      lastVel: v3(),
      playerId: -1,
      born: this.time,
      restT: 0,
    };
    this.ents.push(ent);
    this.byCollider.set(collider.handle, ent);
    return ent;
  }

  // ---------------------------------------------------------------- throwing
  /** Launch speed for a throw power in [0, 1]. */
  static speedFor(power: number) {
    return 19 + 13 * Math.max(0, Math.min(1, power));
  }

  throwBall(player: number, from: V3, target: V3, power: number): Entity {
    const speed = Sim.speedFor(power);
    const g = GRAVITY * BALL_GRAVITY;
    const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
    const theta = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
    const vel = v3((dx / d) * speed * Math.cos(theta), speed * Math.sin(theta), (dz / d) * speed * Math.cos(theta));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel(v3(-vel.z * 0.5, 0, vel.x * 0.5))
        .setGravityScale(BALL_GRAVITY)
        .setCcdEnabled(true)
        .setLinearDamping(0.02)
        .setAngularDamping(0.4),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_R).setDensity(12).setFriction(0.5).setRestitution(0.3).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const ent: Entity = {
      id: this.nextId++,
      kind: 'ball',
      type: 'ball',
      body,
      collider,
      size: v3(BALL_R * 2, BALL_R * 2, BALL_R * 2),
      home: { ...from },
      rotY: 0,
      baseY: -99,
      owner: player,
      ownerT: this.time,
      scored: false,
      gone: false,
      dieAt: this.time + 7,
      exploded: false,
      lastVel: { ...vel },
      playerId: player,
      born: this.time,
      restT: 0,
    };
    this.ents.push(ent);
    this.byCollider.set(collider.handle, ent);
    this.events.push({ e: 'throw', ent, player, power });
    // keep the ball count sane
    const balls = this.ents.filter((e) => e.kind === 'ball' && !e.gone);
    if (balls.length > 24) this.remove(balls[0]);
    return ent;
  }

  /** First thing (block, stand, island) hit by a ray. Balls are ignored. */
  raycast(origin: V3, dir: V3, maxDist = 200): { point: V3; normal: V3; ent: Entity | null } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, (c) => this.byCollider.get(c.handle)?.kind !== 'ball');
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: v3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: v3(hit.normal.x, hit.normal.y, hit.normal.z),
      ent: this.byCollider.get(hit.collider.handle) ?? null,
    };
  }

  // ---------------------------------------------------------------- explosions
  explodeEntity(ent: Entity, delay = 0) {
    if (ent.exploded || ent.gone) return;
    ent.exploded = true;
    this.booms.push({ t: this.time + delay, ent, pos: pos(ent), kind: ent.type === 'chem' ? 'chem' : 'bomb', owner: ent.owner });
  }

  private detonate(b: PendingBoom) {
    const center = b.ent && !b.ent.gone ? pos(b.ent) : b.pos;
    const R = b.kind === 'bomb' ? 4.4 : 3.4;
    const strength = b.kind === 'bomb' ? 15 : 11;
    const owner = b.ent ? (this.time - b.ent.ownerT < 12 ? b.ent.owner : -1) : b.owner;
    if (b.ent && !b.ent.gone) {
      // the exploding block itself still counts as knocked out
      if (this.opts.autoScore && !b.ent.scored) this.scoreBlock(b.ent, owner);
      this.remove(b.ent);
    }
    for (const e of this.ents) {
      if (e.gone) continue;
      const p = pos(e);
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      if (d > R) continue;
      const f = 1 - d / R;
      let dir = v3(p.x - center.x, p.y - center.y + 0.7, p.z - center.z);
      const l = len(dir) || 1;
      dir = v3(dir.x / l, dir.y / l, dir.z / l);
      const m = e.body.mass();
      const dv = strength * f;
      e.body.applyImpulse(v3(dir.x * dv * m, dir.y * dv * m, dir.z * dv * m), true);
      e.body.applyTorqueImpulse(v3((Math.random() - 0.5) * m * f * 3, (Math.random() - 0.5) * m * f * 3, (Math.random() - 0.5) * m * f * 3), true);
      // credit the blast to whoever set it off, unless someone else's ball hit this block a moment ago
      if (owner >= 0 && e.kind === 'block' && (e.owner < 0 || e.owner === owner || this.time - e.ownerT > 1.2)) {
        e.owner = owner;
        e.ownerT = this.time;
      }
      if ((e.type === 'bomb' || e.type === 'chem') && !e.exploded) {
        if (e.type === 'bomb' || b.kind === 'chem' || f > 0.35) {
          e.owner = owner >= 0 ? owner : e.owner;
          e.ownerT = this.time;
          this.explodeEntity(e, 0.12 + Math.random() * 0.1);
        }
      }
    }
    this.events.push({ e: 'boom', pos: center, radius: R, kind: b.kind, owner });
  }

  // ---------------------------------------------------------------- scoring / removal
  private scoreBlock(ent: Entity, player?: number) {
    ent.scored = true;
    const who = player ?? (ent.owner >= 0 && this.time - ent.ownerT < 12 ? ent.owner : -1);
    const points = BLOCK_TYPES[ent.type as BlockType]?.points ?? 0;
    this.events.push({ e: 'score', ent, player: who, points, pos: pos(ent) });
    ent.dieAt = Math.min(ent.dieAt, this.time + 2.5);
  }

  remove(ent: Entity) {
    if (ent.gone) return;
    ent.gone = true;
    if (this.grab?.ent === ent) this.grab = null;
    this.byCollider.delete(ent.collider.handle);
    this.world.removeRigidBody(ent.body);
    this.ents = this.ents.filter((e) => e !== ent);
    this.events.push({ e: 'remove', ent });
  }

  // ---------------------------------------------------------------- Tower Pull grab
  grabStart(ent: Entity, axis: V3) {
    const p = pos(ent);
    const side = v3(-axis.z, 0, axis.x);
    this.grab = { ent, anchor: p, axis, side, target: { ...p } };
    ent.body.setAngularDamping(8);
    ent.body.setLinearDamping(1.5);
    ent.body.wakeUp();
  }
  /** d: pull distance in block-lengths (+ = out toward you, - = push), s: sideways wiggle in [-1, 1] */
  grabSet(d: number, s: number) {
    const g = this.grab;
    if (!g) return;
    const D = d * 2.6, S = s * 0.35;
    g.target = v3(g.anchor.x + g.axis.x * D + g.side.x * S, g.anchor.y, g.anchor.z + g.axis.z * D + g.side.z * S);
  }
  grabEnd() {
    const g = this.grab;
    if (!g) return;
    if (!g.ent.gone) {
      g.ent.body.setAngularDamping(0.15);
      g.ent.body.setLinearDamping(0.05);
    }
    this.grab = null;
  }
  private applyGrab(dt: number) {
    const g = this.grab;
    if (!g || g.ent.gone) return;
    const p = g.ent.body.translation();
    const v = g.ent.body.linvel();
    const K = 260, C = 30, FMAX = 70;
    let fx = K * (g.target.x - p.x) - C * v.x;
    let fz = K * (g.target.z - p.z) - C * v.z;
    const f = Math.hypot(fx, fz);
    if (f > FMAX) {
      fx *= FMAX / f;
      fz *= FMAX / f;
    }
    g.ent.body.applyImpulse(v3(fx * dt, 0, fz * dt), true);
  }

  // ---------------------------------------------------------------- stepping
  /** Advance one frame (1/60 s), possibly in several substeps. */
  step() {
    if (this.paused) return;
    const sub = this.opts.substeps;
    for (let i = 0; i < sub; i++) this.substep(DT / sub);
  }

  private substep(dt: number) {
    for (const e of this.ents) {
      if (e.body.isSleeping()) {
        e.lastVel.x = e.lastVel.y = e.lastVel.z = 0;
      } else {
        const lv = e.body.linvel();
        e.lastVel.x = lv.x;
        e.lastVel.y = lv.y;
        e.lastVel.z = lv.z;
      }
    }
    this.applyGrab(dt);
    this.world.step(this.eq);
    this.time += dt;
    this.eq.drainCollisionEvents((h1, h2, started) => {
      if (started) this.onContact(this.byCollider.get(h1) ?? null, this.byCollider.get(h2) ?? null);
    });

    // bombs go off when they take a hard knock
    for (const e of this.ents) {
      if (e.type !== 'bomb' || e.exploded || e.body.isSleeping()) continue;
      const v = e.body.linvel();
      const dv = Math.hypot(v.x - e.lastVel.x, v.y - e.lastVel.y, v.z - e.lastVel.z);
      if (dv > 6.5) this.explodeEntity(e, 0.02);
    }
    // explosions
    if (this.booms.length) {
      const due = this.booms.filter((b) => b.t <= this.time);
      this.booms = this.booms.filter((b) => b.t > this.time);
      for (const b of due) this.detonate(b);
    }
    // scoring, cleanup
    for (const e of [...this.ents]) {
      if (e.gone) continue;
      const p = e.body.translation();
      if (p.y < -30) {
        if (e.kind === 'block' && this.opts.autoScore && !e.scored) this.scoreBlock(e);
        this.remove(e);
        continue;
      }
      if (e.kind === 'block') {
        if (this.opts.autoScore && !e.scored && p.y < e.baseY - 0.45) this.scoreBlock(e);
      } else {
        const sp = e.body.isSleeping() ? 0 : len(e.body.linvel());
        e.restT = sp < 0.4 ? e.restT + dt : 0;
        if (e.restT > 1.2) e.dieAt = Math.min(e.dieAt, this.time + 0.5);
      }
      if (this.time >= e.dieAt) this.remove(e);
    }
  }

  private onContact(a: Entity | null, b: Entity | null) {
    if (!a && !b) return;
    if (!a) [a, b] = [b, a];
    if (!a) return;
    const va = a.lastVel, vb = b ? b.lastVel : v3();
    const speed = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
    if (speed > 1.2) this.events.push({ e: 'hit', a, b, speed, pos: pos(a) });
    if (!b) return;

    const ball = a.kind === 'ball' ? a : b.kind === 'ball' ? b : null;
    const other = ball === a ? b : a;
    if (ball && other.kind === 'block') {
      other.owner = ball.playerId;
      other.ownerT = this.time;
      this.tagNeighbors(other, ball.playerId);
      if (other.type === 'ghost' && !other.gone) {
        const p = pos(other);
        if (this.opts.autoScore) this.scoreBlock(other, ball.playerId);
        this.events.push({ e: 'vanish', ent: other, pos: p, player: ball.playerId });
        this.remove(other);
        return;
      }
      if (other.type === 'bomb' && speed > 4) this.explodeEntity(other, 0.02);
      return;
    }
    if (a.kind === 'block' && b.kind === 'block') {
      // pass the "who knocked this" tag along the chain of falling blocks
      const fresh = (e: Entity) => e.owner >= 0 && this.time - e.ownerT < 6;
      if (fresh(a) && (!fresh(b) || a.ownerT > b.ownerT) && speed > 0.3) {
        b.owner = a.owner;
        b.ownerT = a.ownerT;
      } else if (fresh(b) && (!fresh(a) || b.ownerT > a.ownerT) && speed > 0.3) {
        a.owner = b.owner;
        a.ownerT = b.ownerT;
      }
      if (a.type === 'chem' && b.type === 'chem' && !a.exploded && !b.exploded) {
        const owner = a.ownerT > b.ownerT ? a.owner : b.owner;
        a.owner = b.owner = owner;
        a.ownerT = b.ownerT = this.time;
        this.explodeEntity(a, 0.03);
        this.explodeEntity(b, 0.09);
      }
    }
  }

  /** Credit blocks resting on/against the one a ball hit (they fall because of that hit). */
  private tagNeighbors(start: Entity, player: number, depth = 3) {
    let frontier = [start];
    const seen = new Set<Entity>([start]);
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: Entity[] = [];
      for (const e of frontier) {
        this.world.contactPairsWith(e.collider, (c) => {
          const n = this.byCollider.get(c.handle);
          if (!n || n.kind !== 'block' || seen.has(n)) return;
          seen.add(n);
          if (this.time - n.ownerT > 1 || n.owner === player) {
            n.owner = player;
            n.ownerT = this.time;
          }
          next.push(n);
        });
      }
      frontier = next;
    }
  }

  // ---------------------------------------------------------------- queries
  settled(): boolean {
    if (this.booms.length) return false;
    for (const e of this.ents) {
      if (e.body.isSleeping()) continue;
      const v = e.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.25) return false;
    }
    return true;
  }

  blocks(): Entity[] {
    return this.ents.filter((e) => e.kind === 'block' && !e.gone);
  }
}

export function pos(e: Entity): V3 {
  const t = e.body.translation();
  return v3(t.x, t.y, t.z);
}

export function quatY(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

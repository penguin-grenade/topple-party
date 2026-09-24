// Headless Tower Pull tower lab.
//
//   tsx tests/towers-check.ts [all | tower ids or numbers...] [--survey] [--games N] [--careful N] [--seed S]
//   (env: HZ=contact stiffness, SUB=physics substeps, WHY=1 to explain every trap)
//
// For each tower:
//   * idle:    settle it like the game does, then keep every piece awake for 20 s. It must not creep
//              or fall over by itself.
//   * survey:  on a fresh tower, pull each piece in turn. Every piece must slide out (nothing stuck);
//              reports which first pulls topple the tower ("traps").
//   * games:   play whole games with bots that pull a random piece each turn (--games), and careful
//              bots that try up to 10 pieces first and take one that holds (--careful). How many pulls
//              a tower lasts is the best proxy for how hard, and how long, it plays.
// Exits non-zero if a tower can't stand on its own or has a piece that won't slide.

import { Sim, initPhysics, pos, type Entity, type V3 } from '../src/tv/sim/sim';
import { buildLevel, type LevelSpec } from '../src/tv/sim/levels';
import { TOWERS, TOWER_CONTACT_HZ, type TowerDef } from '../src/tv/sim/towers';
import { isPiece, pieceAxis, pieceLength, outDistance, outThreshold, toppled } from '../src/tv/sim/pull';
import type { BlockType } from '../src/tv/sim/blocks';
import { VARIANTS } from './tower-variants';

const HZ = Number(process.env.HZ ?? TOWER_CONTACT_HZ);
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const num = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const VALUED = ['--games', '--careful', '--seed'];
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1])));
const ALL = [...TOWERS, ...VARIANTS];
const pickTowers = ids.length === 0 || ids.includes('all') ? TOWERS : ALL.filter((t) => ids.includes(t.id) || ids.includes(String(ALL.indexOf(t) + 1)));

let rngState = num('--seed', 7);
const rnd = () => {
  rngState = (rngState * 16807) % 2147483647;
  return (rngState - 1) / 2147483646;
};

const FRAME = 1 / 60;
/** frames a new tower settles for before play (the game does the same) */
const SETTLE = 90;
/** pulls after which the tower was still moving 8 s later (the game moves on after 9 s) */
let slowSettles = 0;

function load(sim: Sim, def: TowerDef, spec: LevelSpec) {
  sim.load(spec, { autoScore: false, substeps: Number(process.env.SUB ?? def.substeps), contactHz: HZ });
}
const pieces = (sim: Sim) => sim.blocks().filter(isPiece);
function snap(sim: Sim) {
  const m = new Map<Entity, V3>();
  for (const e of sim.blocks()) m.set(e, pos(e));
  return m;
}
function movement(sim: Sim, except?: Entity) {
  let m = 0;
  for (const e of sim.blocks()) {
    if (e === except || e.body.isSleeping()) continue;
    const v = e.body.linvel();
    m = Math.max(m, Math.hypot(v.x, v.y, v.z));
  }
  return m;
}

// ------------------------------------------------------------------ state cloning (careful bot)
interface Saved {
  type: BlockType;
  size: V3;
  t: V3;
  q: { x: number; y: number; z: number; w: number };
  home: V3;
  baseY: number;
  sleeping: boolean;
}
const save = (sim: Sim): Saved[] =>
  sim.blocks().map((e) => ({ type: e.type as BlockType, size: e.size, t: pos(e), q: e.body.rotation(), home: e.home, baseY: e.baseY, sleeping: e.body.isSleeping() }));
function restore(sim: Sim, def: TowerDef, spec: LevelSpec, st: Saved[]) {
  sim.load({ ...spec, blocks: [] }, { autoScore: false, substeps: Number(process.env.SUB ?? def.substeps), contactHz: HZ });
  for (const s of st) {
    const e = sim.addBlock(s.type, s.t, s.size, 0, s.baseY);
    e.body.setRotation(s.q, false);
    e.home = { ...s.home };
  }
  sim.settle(20);
}

// ------------------------------------------------------------------ one pull, the way a player does it
interface PullResult {
  out: boolean;
  stuck: boolean;
  topple: boolean;
  culprit?: string;
  secs: number;
}
/**
 * Grab `e`, slide it out toward the nearer end (or `sign`), wiggling a little, at `speed` m/s of
 * target travel. Then wait for the tower to settle like the game's check phase does.
 */
function pull(sim: Sim, e: Entity, opts: { sign?: number; speed?: number; wiggle?: number; center?: V3 } = {}): PullResult {
  const axis = pieceAxis(e);
  const c = opts.center ?? { x: 0, y: 0, z: 0 };
  const p0 = pos(e);
  let sign = opts.sign ?? Math.sign((p0.x - c.x) * axis.x + (p0.z - c.z) * axis.z);
  if (!sign) sign = rnd() < 0.5 ? -1 : 1;
  const thr = outThreshold(e);
  const speed = opts.speed ?? 1.3;
  const wig = opts.wiggle ?? 0.4;
  const snapshot = snap(sim);
  sim.grabStart(e, axis);
  let t = 0;
  let out = false;
  let tried = 0;
  let lastProgressT = 0;
  let best = 0;
  while (t < 14) {
    const along = sign * Math.min(thr + 1.2, (t - lastProgressT) * speed);
    const perp = Math.sin(t * 7) * wig;
    sim.grabOffset(axis.x * along - axis.z * perp, axis.z * along + axis.x * perp);
    sim.step();
    t += FRAME;
    const od = outDistance(e, axis) * sign;
    if (od > best + 0.05) best = od;
    if (Math.abs(outDistance(e, axis)) > thr) {
      out = true;
      break;
    }
    if (toppled(snapshot, e)) {
      sim.grabEnd();
      const culprit = toppled(snapshot, e)!;
      return { out: false, stuck: false, topple: true, culprit: culprit.type, secs: t };
    }
    // no progress: try the other way once (blocked by something at that end)
    if (t - lastProgressT > 4 && best < 0.4 && !tried) {
      tried = 1;
      sign = -sign;
      lastProgressT = t;
      best = 0;
    }
  }
  if (!out) {
    sim.grabEnd();
    return { out: false, stuck: true, topple: false, secs: t };
  }
  sim.grabEnd();
  sim.remove(e);
  // check phase: at least 2.4 s and until things stop moving (max 8 s)
  let s = 0;
  while (s < 8) {
    sim.step();
    s += FRAME;
    const who = toppled(snapshot, e);
    if (who) return { out: true, stuck: false, topple: true, culprit: who.type, secs: t + s };
    if (s > 2.4 && movement(sim) < 0.2) break;
  }
  if (s >= 8) slowSettles++;
  return { out: true, stuck: false, topple: false, secs: t };
}

function towerCenter(sim: Sim): V3 {
  const ps = pieces(sim);
  let x = 0, z = 0;
  for (const e of ps) {
    x += e.home.x;
    z += e.home.z;
  }
  return { x: x / ps.length, y: 0, z: z / ps.length };
}

// ------------------------------------------------------------------ tests
function idle(def: TowerDef, spec: LevelSpec) {
  const sim = new Sim();
  load(sim, def, spec);
  const built = snap(sim);
  const t0 = performance.now();
  sim.settle(SETTLE);
  let settleDrift = 0;
  for (const [e, p0] of built) settleDrift = e.gone ? 99 : Math.max(settleDrift, Math.hypot(pos(e).x - p0.x, pos(e).y - p0.y, pos(e).z - p0.z));
  // then keep everything awake for 20 s (as if a long turn kept the tower stirred up) and measure creep
  const snapshot = snap(sim);
  let fell: Entity | null = null;
  let fellAt = 0;
  for (let i = 0; i < 20 * 60; i++) {
    if (i % 30 === 0) for (const e of sim.ents) e.body.wakeUp();
    sim.step();
    if (!fell) {
      fell = toppled(snapshot, null);
      if (fell) fellAt = i / 60;
    }
  }
  const ms = (performance.now() - t0) / (20 * 60 + SETTLE);
  let drift = 0;
  for (const [e, p0] of snapshot) drift = e.gone ? 99 : Math.max(drift, Math.hypot(pos(e).x - p0.x, pos(e).y - p0.y, pos(e).z - p0.z));
  const crowns = sim.blocks().filter((e) => e.type === 'crown');
  const topY = Math.max(...sim.blocks().map((e) => pos(e).y + e.size.y / 2));
  return { settleDrift, drift, fell: fell ? `${fell.type}@${fellAt.toFixed(1)}s` : '', ms, moving: movement(sim), n: pieces(sim).length, crowns: crowns.length, topY };
}

function survey(def: TowerDef, spec: LevelSpec) {
  const sim = new Sim();
  load(sim, def, spec);
  const n = pieces(sim).length;
  const traps: number[] = [];
  const stuck: number[] = [];
  const secs: number[] = [];
  const map: string[] = [];
  for (let i = 0; i < n; i++) {
    load(sim, def, spec);
    sim.settle(SETTLE);
    const ps = pieces(sim);
    const e = ps[i];
    const r = pull(sim, e, { center: towerCenter(sim) });
    if (r.stuck) stuck.push(i);
    else if (r.topple) traps.push(i);
    if (r.out) secs.push(r.secs);
    map.push(r.stuck ? 'S' : r.topple ? (r.out ? 'x' : 'X') : '.');
    if (r.topple && process.env.WHY) console.log(`    trap #${i} (${e.type} len ${pieceLength(e).toFixed(1)} at y ${e.home.y.toFixed(2)}): ${r.culprit}`);
  }
  return { n, traps, stuck, map: map.join(''), pullSecs: secs.reduce((a, b) => a + b, 0) / Math.max(1, secs.length) };
}

/** Play until the tower topples. careful = number of candidates a careful bot tries per turn (0 = random bot). */
function game(def: TowerDef, spec: LevelSpec, careful: number, maxTurns = 80) {
  let sim = new Sim();
  let trial = new Sim();
  load(sim, def, spec);
  sim.settle(SETTLE);
  const center = towerCenter(sim);
  let turns = 0;
  while (turns < maxTurns) {
    const ps = pieces(sim);
    if (!ps.length) break;
    if (careful) {
      const st = save(sim);
      const order = ps.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, careful);
      let found = false;
      for (const idx of order) {
        restore(trial, def, spec, st);
        const r = pull(trial, pieces(trial)[idx], { center });
        if (r.out && !r.topple) {
          found = true;
          break;
        }
      }
      if (!found) return { turns, reason: 'no safe move' };
      // the trial that held becomes the real tower
      [sim, trial] = [trial, sim];
      turns++;
      continue;
    }
    const r = pull(sim, ps[Math.floor(rnd() * ps.length)], { center });
    if (r.stuck) return { turns, reason: 'stuck' };
    turns++;
    if (r.topple) return { turns, reason: `topple (${r.culprit})` };
  }
  return { turns, reason: 'max turns' };
}

async function main() {
  await initPhysics();
  const doSurvey = flag('--survey');
  const nGames = num('--games', 0);
  const nCareful = num('--careful', 0);
  let fail = 0;
  for (const def of pickTowers) {
    const spec = buildLevel(def, 1);
    const id = idle(def, spec);
    const ok = !id.fell && id.drift < 0.1 && id.settleDrift < 0.02 * id.topY;
    if (!ok) fail++;
    console.log(
      `\n#${ALL.indexOf(def) + 1} ${def.name} [${def.id}] pieces=${id.n} crowns=${id.crowns} top=${id.topY.toFixed(1)} ` +
        `settle=${id.settleDrift.toFixed(3)} creep=${id.drift.toFixed(3)} ${id.fell ? 'FELL ' + id.fell : ''} still-moving=${id.moving.toFixed(2)} ${id.ms.toFixed(2)}ms/frame ${ok ? 'OK' : 'UNSTABLE'}`,
    );
    if (!ok) continue;
    if (doSurvey) {
      const s = survey(def, spec);
      if (s.stuck.length) fail++;
      console.log(`  survey: ${s.n - s.traps.length - s.stuck.length} safe, ${s.traps.length} traps (${((100 * s.traps.length) / s.n).toFixed(0)}%), ${s.stuck.length} stuck, avg pull ${s.pullSecs.toFixed(1)}s`);
      console.log(`  map: ${s.map}`);
      if (slowSettles) console.log(`  still moving 8 s after ${slowSettles} pulls`);
      slowSettles = 0;
    }
    if (nGames) {
      const res = Array.from({ length: nGames }, () => game(def, spec, 0));
      const t = res.map((r) => r.turns).sort((a, b) => a - b);
      console.log(`  random bot: pulls before topple median ${t[t.length >> 1]} (min ${t[0]}, max ${t[t.length - 1]}) [${t.join(' ')}]`);
    }
    if (nCareful) {
      const res = Array.from({ length: nCareful }, () => game(def, spec, 10));
      const t = res.map((r) => r.turns).sort((a, b) => a - b);
      console.log(`  careful bot: median ${t[t.length >> 1]} (min ${t[0]}, max ${t[t.length - 1]}) [${res.map((r) => r.turns + ':' + r.reason).join(', ')}]`);
    }
  }
  if (fail) process.exitCode = 1;
}
main();

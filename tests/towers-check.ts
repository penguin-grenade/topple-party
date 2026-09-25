// Headless Tower Pull tower lab.
//
//   tsx tests/towers-check.ts [all | tower ids or numbers | tower .json files...] [--survey] [--sample N] [--games N] [--careful N] [--seed S]
//   (env: HZ=contact stiffness, SUB=physics substeps, WHY=1 to explain every trap)
//
// For each tower:
//   * idle:    settle it like the game does, then keep every piece awake for 20 s. It must not creep
//              or fall over by itself.
//   * survey:  on a fresh tower, pull each piece in turn (or a random --sample of N pieces on a big
//              tower). Every piece must slide out (nothing stuck);
//              reports which first pulls knock other pieces down ("spills") or drop a crown ("traps").
//   * games:   play whole towers by the game's rules (spills cost points but play goes on; a fallen
//              crown ends the tower) with bots that pull a random piece each turn (--games), and
//              careful bots that try up to 10 pieces first and take one that holds (--careful). How
//              many pulls a tower lasts is the best proxy for how hard, and how long, it plays.
// Exits non-zero if a tower can't stand on its own or has a piece that won't slide.

import { Sim, initPhysics, pos, type Entity, type V3 } from '../src/tv/sim/sim';
import { buildLevel, type LevelSpec } from '../src/tv/sim/levels';
import { TOWERS, TOWER_CONTACT_HZ, type TowerDef } from '../src/tv/sim/towers';
import { isPiece, pieceAxis, pieceLength, outDistance, outThreshold, snapshotOf, fallenPieces, fallenCrown } from '../src/tv/sim/pull';
import type { BlockType } from '../src/tv/sim/blocks';
import { VARIANTS } from './tower-variants';
import { parseTowerJson, checkTowerJson, towerFromJson } from '../src/tv/sim/towerFile';
import fs from 'node:fs';

const HZ = Number(process.env.HZ ?? TOWER_CONTACT_HZ);
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const num = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const VALUED = ['--games', '--careful', '--seed', '--sample'];
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(args[i - 1])));
// tower files (paths ending in .json) are checked structurally, then run like any other tower
const fileTowers: TowerDef[] = ids
  .filter((a) => a.endsWith('.json'))
  .map((f) => {
    const { tower, check } = parseTowerJson(fs.readFileSync(f, 'utf8'));
    const c = tower ? checkTowerJson(tower) : check;
    for (const e of c.errors) console.log(`${f}: ERROR ${e}`);
    for (const w of c.warnings) console.log(`${f}: warning ${w}`);
    if (!tower || !c.ok) {
      process.exitCode = 1;
      return null;
    }
    return towerFromJson(tower) as TowerDef;
  })
  .filter((t): t is TowerDef => !!t);
const ALL = [...TOWERS, ...VARIANTS, ...fileTowers];
const pickTowers = ids.length === 0 || ids.includes('all') ? TOWERS : ALL.filter((t) => ids.includes(t.id) || ids.includes(String(ALL.indexOf(t) + 1)) || fileTowers.includes(t));

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
  /** a crown fell: the tower is over */
  crown: boolean;
  /** other pieces knocked down (and cleared away) */
  fell: number;
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
  // the same bookkeeping as the game's PullMode
  const snapshot = snapshotOf(sim.blocks());
  const rubble = new Set<Entity>();
  const crownDown = () => !!fallenCrown(snapshot);
  const watch = () => {
    for (const f of fallenPieces(snapshot, rubble)) {
      if (f === e) out = true; // the piece in hand tipped out: that's the pull
      else rubble.add(f);
    }
  };
  sim.grabStart(e, axis);
  let t = 0;
  let out = false;
  let tried = 0;
  let lastProgressT = 0;
  let best = 0;
  while (t < 14 && !out) {
    const along = sign * Math.min(thr + 1.2, (t - lastProgressT) * speed);
    const perp = Math.sin(t * 7) * wig;
    sim.grabOffset(axis.x * along - axis.z * perp, axis.z * along + axis.x * perp);
    sim.step();
    t += FRAME;
    const od = outDistance(e, axis) * sign;
    if (od > best + 0.05) best = od;
    if (Math.abs(outDistance(e, axis)) > thr) out = true;
    if (crownDown()) {
      sim.grabEnd();
      return { out: false, stuck: false, crown: true, fell: rubble.size, secs: t };
    }
    watch();
    // no progress for a while (blocked by something at that end): try the other way once, as a player would
    if (t - lastProgressT > 2.5 && best < thr * 0.5 && !tried) {
      tried = 1;
      sign = -sign;
      lastProgressT = t;
      best = 0;
    }
  }
  sim.grabEnd();
  if (!out) return { out: false, stuck: true, crown: false, fell: rubble.size, secs: t };
  sim.remove(e);
  snapshot.delete(e);
  // check phase: settle (2.4 s at least, 9 s at most), clear what fell, settle again
  let fell = 0;
  for (let round = 0; round < 6; round++) {
    let s = round === 0 ? 0 : 1.2;
    while (s < 9) {
      sim.step();
      s += FRAME;
      if (crownDown()) return { out: true, stuck: false, crown: true, fell: fell + rubble.size, secs: t };
      watch();
      if (s > 2.4 && movement(sim) < 0.2) break;
    }
    if (s >= 9) slowSettles++;
    if (!rubble.size || round === 5) break;
    for (const r of rubble) {
      sim.remove(r);
      snapshot.delete(r);
      fell++;
    }
    rubble.clear();
  }
  return { out: true, stuck: false, crown: false, fell, secs: t };
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
/**
 * Building mistakes: a piece whose only support is one piece running the same way right under it.
 * Pulling that one drops the one above, so it plays like a trap nobody can see.
 */
function stackingProblems(spec: LevelSpec): string[] {
  const ps = spec.blocks.filter((b) => b.type === 'jenga' || b.type === 'jgold');
  const axis = (b: (typeof ps)[number]) => {
    const a = b.sx >= b.sz ? b.rotY : b.rotY + Math.PI / 2;
    return { x: Math.cos(a), z: -Math.sin(a), len: Math.max(b.sx, b.sz) };
  };
  const out: string[] = [];
  for (const up of ps) {
    const au = axis(up);
    const under = ps.filter((d) => {
      if (Math.abs(up.y - d.y - (d.sy + up.sy) / 2 - 0.003) > 0.02) return false;
      const ad = axis(d);
      for (let k = -4; k <= 4; k++) {
        const rx = up.x + (au.x * au.len * k) / 8.4 - d.x, rz = up.z + (au.z * au.len * k) / 8.4 - d.z;
        if (Math.abs(rx * ad.x + rz * ad.z) <= ad.len / 2 && Math.abs(-rx * ad.z + rz * ad.x) <= 0.5) return true;
      }
      return false;
    });
    if (under.length === 1) {
      const ad = axis(under[0]);
      if (Math.abs(au.x * ad.x + au.z * ad.z) > 0.9) out.push(`piece at (${up.x.toFixed(2)}, ${up.y.toFixed(2)}, ${up.z.toFixed(2)}) rests on a single parallel piece`);
    }
  }
  return out;
}

function idle(def: TowerDef, spec: LevelSpec) {
  const sim = new Sim();
  load(sim, def, spec);
  const built = snap(sim);
  const t0 = performance.now();
  sim.settle(SETTLE);
  let settleDrift = 0;
  for (const [e, p0] of built) settleDrift = e.gone ? 99 : Math.max(settleDrift, Math.hypot(pos(e).x - p0.x, pos(e).y - p0.y, pos(e).z - p0.z));
  // then keep everything awake for 20 s (as if a long turn kept the tower stirred up): nothing may
  // fall and nothing may creep
  const snapshot = snap(sim);
  const poses = snapshotOf(sim.blocks());
  let fell: Entity | null = null;
  let fellAt = 0;
  for (let i = 0; i < 20 * 60; i++) {
    if (i % 30 === 0) for (const e of sim.ents) e.body.wakeUp();
    sim.step();
    if (!fell) {
      fell = fallenCrown(poses) ?? fallenPieces(poses)[0] ?? null;
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

function survey(def: TowerDef, spec: LevelSpec, sample = 0) {
  const sim = new Sim();
  load(sim, def, spec);
  const n = pieces(sim).length;
  const chosen = new Set<number>();
  if (sample && sample < n) while (chosen.size < sample) chosen.add(Math.floor(rnd() * n));
  const traps: number[] = [];
  const spills: number[] = [];
  const stuck: number[] = [];
  const secs: number[] = [];
  const map: string[] = [];
  for (let i = 0; i < n; i++) {
    if (chosen.size && !chosen.has(i)) {
      map.push(' ');
      continue;
    }
    load(sim, def, spec);
    sim.settle(SETTLE);
    const ps = pieces(sim);
    const e = ps[i];
    const r = pull(sim, e, { center: towerCenter(sim) });
    if (r.stuck) stuck.push(i);
    else if (r.crown) traps.push(i);
    else if (r.fell) spills.push(i);
    if (r.out) secs.push(r.secs);
    // . clean   s spill (other pieces fell, play goes on)   X a crown fell   S stuck
    map.push(r.stuck ? 'S' : r.crown ? 'X' : r.fell ? 's' : '.');
    if ((r.crown || r.fell) && process.env.WHY) console.log(`    #${i} (${e.type} len ${pieceLength(e).toFixed(1)} at y ${e.home.y.toFixed(2)}): ${r.crown ? 'crown fell' : `${r.fell} fell`}`);
  }
  return { n: chosen.size || n, traps, spills, stuck, map: map.join(''), pullSecs: secs.reduce((a, b) => a + b, 0) / Math.max(1, secs.length) };
}

/**
 * Play one tower by the game's rules until a crown falls (or nothing is left): spills cost points but
 * play goes on. careful = pieces a careful bot tries per turn before committing (0 = random bot).
 */
function game(def: TowerDef, spec: LevelSpec, careful: number, maxTurns = 120) {
  let sim = new Sim();
  let trial = new Sim();
  load(sim, def, spec);
  sim.settle(SETTLE);
  const center = towerCenter(sim);
  let turns = 0;
  let spills = 0;
  while (turns < maxTurns) {
    const ps = pieces(sim);
    if (!ps.length) return { turns, spills, reason: 'cleared' };
    if (careful) {
      // try up to `careful` pieces; take the first clean pull, else the smallest spill that keeps the crowns up
      const st = save(sim);
      const order = ps.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, careful);
      let pick = -1;
      let pickFell = Infinity;
      for (const idx of order) {
        restore(trial, def, spec, st);
        const r = pull(trial, pieces(trial)[idx], { center });
        if (!r.out || r.crown) continue;
        if (r.fell === 0) {
          pick = idx;
          pickFell = 0;
          break;
        }
        if (r.fell < pickFell) {
          pick = idx;
          pickFell = r.fell;
        }
      }
      if (pick < 0) return { turns, spills, reason: 'every try dropped a crown' };
      restore(trial, def, spec, st);
      const r = pull(trial, pieces(trial)[pick], { center });
      [sim, trial] = [trial, sim];
      turns++;
      if (r.fell) spills++;
      if (r.crown) return { turns, spills, reason: 'crown' };
      continue;
    }
    const r = pull(sim, ps[Math.floor(rnd() * ps.length)], { center });
    if (r.stuck) return { turns, spills, reason: 'stuck' };
    turns++;
    if (r.fell) spills++;
    if (r.crown) return { turns, spills, reason: 'crown' };
  }
  return { turns, spills, reason: 'max turns' };
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
    const stacking = stackingProblems(spec);
    const ok = !id.fell && id.drift < 0.1 && id.settleDrift < 0.02 * id.topY && !stacking.length;
    for (const m of stacking) console.log(`  STACKING: ${m}`);
    if (!ok) fail++;
    console.log(
      `\n#${ALL.indexOf(def) + 1} ${def.name} [${def.id}] pieces=${id.n} crowns=${id.crowns} top=${id.topY.toFixed(1)} ` +
        `settle=${id.settleDrift.toFixed(3)} creep=${id.drift.toFixed(3)} ${id.fell ? 'FELL ' + id.fell : ''} still-moving=${id.moving.toFixed(2)} ${id.ms.toFixed(2)}ms/frame ${ok ? 'OK' : 'UNSTABLE'}`,
    );
    if (!ok) continue;
    if (doSurvey) {
      const sv = survey(def, spec, num('--sample', 0));
      if (sv.stuck.length) fail++;
      console.log(
        `  survey: ${sv.n - sv.traps.length - sv.spills.length - sv.stuck.length} clean, ${sv.spills.length} spills, ${sv.traps.length} drop a crown (${((100 * sv.traps.length) / sv.n).toFixed(0)}%), ${sv.stuck.length} stuck, avg pull ${sv.pullSecs.toFixed(1)}s`,
      );
      console.log(`  map: ${sv.map}`);
      if (slowSettles) console.log(`  still moving 8 s after ${slowSettles} pulls`);
      slowSettles = 0;
    }
    const report = (label: string, res: { turns: number; spills: number; reason: string }[]) => {
      const t = res.map((r) => r.turns).sort((a, b) => a - b);
      const sp = res.reduce((a, r) => a + r.spills, 0) / res.length;
      console.log(`  ${label}: pulls until a crown falls: median ${t[t.length >> 1]} (min ${t[0]}, max ${t[t.length - 1]}), ${sp.toFixed(1)} spills a game [${res.map((r) => `${r.turns}${r.reason === 'crown' ? '' : ':' + r.reason}`).join(' ')}]`);
    };
    if (nGames) report('random bot', Array.from({ length: nGames }, () => game(def, spec, 0)));
    if (nCareful) report('careful bot', Array.from({ length: nCareful }, () => game(def, spec, 10)));
  }
  if (fail) process.exitCode = 1;
}
main();

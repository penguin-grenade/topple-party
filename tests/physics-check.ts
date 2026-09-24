// Headless physics sanity checks: stability of every level, a sample throw, and Tower Pull behaviour.
import { Sim, initPhysics, pos } from '../src/tv/sim/sim';
import { LEVELS, PRACTICE, buildLevel } from '../src/tv/sim/levels';

const run = (sim: Sim, secs: number) => { for (let i = 0; i < secs * 60; i++) sim.step(); };

async function main() {
  await initPhysics();
  const sim = new Sim();
  const only = process.argv[2];
  for (const def of [PRACTICE, ...LEVELS]) {
    if (only && only !== def.id) continue;
    const spec = buildLevel(def, 1234);
    sim.load(spec);
    sim.events = [];
    const t0 = performance.now();
    // wake everything to test real stability (not just sleeping)
    for (const e of sim.ents) e.body.wakeUp();
    run(sim, 6);
    const ms = performance.now() - t0;
    const scored = sim.events.filter((e) => e.e === 'score').length;
    const booms = sim.events.filter((e) => e.e === 'boom').length;
    let maxMove = 0;
    for (const e of sim.blocks()) { const p = pos(e); maxMove = Math.max(maxMove, Math.hypot(p.x - e.home.x, p.y - e.home.y, p.z - e.home.z)); }
    // throw test
    sim.events = [];
    const c = spec.blocks.reduce((a, b) => ({ x: a.x + b.x / spec.blocks.length, y: a.y + b.y / spec.blocks.length, z: a.z + b.z / spec.blocks.length }), { x: 0, y: 0, z: 0 });
    sim.throwBall(0, { x: 0, y: 3.5, z: 14 }, c, 0.8);
    run(sim, 1.2);
    sim.throwBall(1, { x: 1, y: 3.5, z: 14 }, { x: c.x - 1.5, y: c.y + 1, z: c.z }, 1);
    run(sim, 5);
    const pts = sim.events.filter((e) => e.e === 'score') as any[];
    const byPlayer: Record<string, number> = {};
    for (const s of pts) byPlayer[s.player] = (byPlayer[s.player] ?? 0) + s.points;
    console.log(`${def.id.padEnd(9)} blocks=${String(spec.blocks.length).padStart(3)} idle: scored=${scored} booms=${booms} maxMove=${maxMove.toFixed(3)} (${(ms / 360).toFixed(2)}ms/step) | throws: knocked=${pts.length} booms=${sim.events.filter((e) => e.e === 'boom').length} pts=${JSON.stringify(byPlayer)}`);
  }
}
main();

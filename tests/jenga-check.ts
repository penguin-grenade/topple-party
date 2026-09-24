import { Sim, initPhysics, pos } from '../src/tv/sim/sim';
import { TOWER, buildLevel, JENGA_LAYERS } from '../src/tv/sim/levels';
const run = (sim: Sim, secs: number, f?: (t: number) => void) => { for (let i = 0; i < secs * 60; i++) { f?.(i / 60); sim.step(); } };

function maxDrift(sim: Sim, except?: any) {
  let m = 0; for (const e of sim.blocks()) { if (e === except) continue; const p = pos(e); m = Math.max(m, Math.hypot(p.x - e.home.x, p.y - e.home.y, p.z - e.home.z)); } return m;
}
async function main() {
  await initPhysics();
  const sim = new Sim();
  const substeps = Number(process.argv[2] ?? 2);
  for (const seed of [1, 2, 3]) {
    const spec = buildLevel(TOWER, seed);
    sim.load(spec, { autoScore: false, substeps });
    for (const e of sim.ents) e.body.wakeUp();
    const t0 = performance.now();
    run(sim, 8);
    const idleDrift = maxDrift(sim);
    const ms = (performance.now() - t0) / 480;
    // try pulling each block in layers 3..11 (fresh tower each time), report result
    const results: string[] = [];
    let stuck = 0;
    for (const layer of [2, 5, 8, 11, 13]) {
      for (const k of [0, 1, 2]) {
        sim.load(buildLevel(TOWER, seed), { autoScore: false, substeps });
        run(sim, 0.5);
        const blocks = sim.blocks().filter((e) => e.type === 'jenga');
        const ent = blocks[layer * 3 + k];
        const alongX = layer % 2 === 0;
        const axis = alongX ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
        sim.grabStart(ent, axis);
        let out = false;
        run(sim, 3, (t) => { if (ent.gone) return; const D = Math.min(1.1, t * 0.6) * 2.6, W = Math.sin(t * 6) * 1.5; sim.grabOffset(axis.x * D - axis.z * W, axis.z * D + axis.x * W); const p = pos(ent); if (!out && Math.abs((p.x - ent.home.x) * axis.x + (p.z - ent.home.z) * axis.z) > 2.1) { out = true; sim.grabEnd(); sim.remove(ent); } });
        const moved = ent.gone ? 'OUT' : ((pos(ent).x - ent.home.x) * axis.x + (pos(ent).z - ent.home.z) * axis.z).toFixed(2);
        if (!ent.gone) sim.grabEnd();
        run(sim, 2);
        const drift = maxDrift(sim, ent);
        if (!ent.gone) stuck++;
        results.push(`L${layer}${'LMR'[k]}:${moved}${drift > 0.85 ? ` COLLAPSE(${drift.toFixed(2)})` : drift > 0.3 ? ` shaky(${drift.toFixed(2)})` : ''}`);
      }
    }
    console.log(`seed ${seed} substeps ${substeps}: idle drift ${idleDrift.toFixed(3)} (${ms.toFixed(2)} ms/frame), ${stuck} stuck\n  ` + results.join('  '));
    if (stuck > 0 || idleDrift > 0.15) process.exitCode = 1;
  }
}
main();

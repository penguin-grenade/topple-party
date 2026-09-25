// Every built-in tower must survive a trip through the tower file format unchanged, and the
// structural checks must pass on all of them (they are known-good towers).
import { TOWERS } from '../src/tv/sim/towers';
import { buildLevel } from '../src/tv/sim/levels';
import { towerToJson, towerFromJson, validateTowerJson, analyzeTower } from '../src/tv/sim/towerFile';

let bad = 0;
for (const def of TOWERS) {
  const json = towerToJson(def);
  const v = validateTowerJson(json);
  const a = analyzeTower(json);
  // the file lists pieces then crowns, so compare the two builds as sets (sorted the same way)
  const norm = (a: number) => Math.round(a * 1000) / 1000;
  const angle = (r: number) => norm((((r * 180) / Math.PI) % 180) + 180) % 180; // a piece turned 180 is the same piece
  const key = (k: { type: string; x: number; y: number; z: number }) => `${k.type} ${norm(k.y)} ${norm(k.x)} ${norm(k.z)}`;
  const sorted = (spec: ReturnType<typeof buildLevel>) => [...spec.blocks].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const back = sorted(buildLevel(towerFromJson(json), 1));
  const orig = sorted(buildLevel(def, 1));
  let worst = 0;
  let mismatch = '';
  if (back.length !== orig.length) mismatch = `block count ${orig.length} -> ${back.length}`;
  else
    orig.forEach((o, i) => {
      const n = back[i];
      const d = Math.max(Math.abs(o.x - n.x), Math.abs(o.y - n.y), Math.abs(o.z - n.z), Math.abs(o.sx - n.sx), Math.abs(o.sy - n.sy), Math.abs(o.sz - n.sz), Math.abs(angle(o.rotY) - angle(n.rotY)), Math.abs(o.baseY - n.baseY));
      if (o.type !== n.type) mismatch ||= `block ${i} type ${o.type} -> ${n.type}`;
      worst = Math.max(worst, d);
    });
  if (worst > 1e-3) mismatch ||= `blocks moved by up to ${worst.toFixed(4)}`;
  const ok = v.ok && a.ok && !mismatch;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${def.name.padEnd(16)} ${json.pieces.length} pieces ${json.crowns.length} crowns  ${mismatch}${v.errors.join('; ')}${a.errors.length ? ' ' + a.errors.slice(0, 3).join('; ') : ''}${a.warnings.length ? ' warnings: ' + a.warnings.slice(0, 2).join('; ') : ''}`);
}
if (bad) process.exitCode = 1;

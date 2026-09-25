// Tower file tools.
//   tsx scripts/towers.ts export [dir]   write every built-in tower as a tower file (default public/towers/examples)
//   tsx scripts/towers.ts index          rebuild public/towers/index.json from the .json files in public/towers
//   tsx scripts/towers.ts check <file>   validate a tower file and run the structural checks
import fs from 'node:fs';
import path from 'node:path';
import { TOWERS } from '../src/tv/sim/towers';
import { towerToJson, checkTowerJson, parseTowerJson, formatTowerJson } from '../src/tv/sim/towerFile';

const [cmd, arg] = process.argv.slice(2);
const root = process.cwd(); // run from the repo root (npm run towers:...)
const towersDir = path.join(root, 'public', 'towers');

if (cmd === 'export') {
  const dir = arg ? path.resolve(arg) : path.join(towersDir, 'examples');
  fs.mkdirSync(dir, { recursive: true });
  for (const def of TOWERS) {
    const t = towerToJson(def);
    const file = path.join(dir, `${def.id}.json`);
    fs.writeFileSync(file, formatTowerJson(t));
    const c = checkTowerJson(t);
    console.log(`${path.relative(root, file)}: ${t.pieces.length} pieces, ${t.crowns.length} crowns${c.ok ? '' : ' ERRORS: ' + c.errors.join('; ')}${c.warnings.length ? ' (' + c.warnings.length + ' warnings)' : ''}`);
  }
} else if (cmd === 'index') {
  const files = fs.existsSync(towersDir) ? fs.readdirSync(towersDir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort() : [];
  fs.mkdirSync(towersDir, { recursive: true });
  fs.writeFileSync(path.join(towersDir, 'index.json'), JSON.stringify(files, null, 2) + '\n');
  console.log(`public/towers/index.json: ${files.length} tower file(s)${files.length ? ': ' + files.join(', ') : ''}`);
} else if (cmd === 'check' && arg) {
  const { tower, check } = parseTowerJson(fs.readFileSync(arg, 'utf8'));
  const c = tower ? checkTowerJson(tower) : check;
  for (const e of c.errors) console.log('ERROR   ' + e);
  for (const w of c.warnings) console.log('warning ' + w);
  console.log(c.ok ? `OK: ${tower!.name}, ${tower!.pieces.length} pieces, ${tower!.crowns.length} crowns` : 'NOT OK');
  process.exitCode = c.ok ? 0 : 1;
} else {
  console.log('usage: tsx scripts/towers.ts export [dir] | index | check <file>');
  process.exitCode = 2;
}

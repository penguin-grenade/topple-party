// Getting tower files into the game: the bundled ones in public/towers (listed in index.json),
// any `?tower=<url>` on the TV page, and towers imported from a phone (kept in localStorage).

import { addTower, removeCustomTowers, TOWERS, BUILTIN_TOWERS, type TowerDef } from './sim/towers';
import { checkTowerJson, parseTowerJson, towerFromJson, type TowerJson } from './sim/towerFile';

const SAVED_KEY = 'topple.towers';
const MAX_TEXT = 400_000;

export interface ImportResult {
  ok: boolean;
  /** index in TOWERS when it was added */
  index?: number;
  name?: string;
  pieces?: number;
  message: string;
}

/** Validate tower-file text and add it to the tower list. */
export function importTowerText(text: string, opts: { save?: boolean; from?: string } = {}): ImportResult {
  if (text.length > MAX_TEXT) return { ok: false, message: `That tower file is too big (${Math.round(text.length / 1000)} KB, 400 KB max).` };
  const { tower, check } = parseTowerJson(text);
  if (!tower) return { ok: false, message: `Not a tower file: ${check.errors[0]}` };
  const c = checkTowerJson(tower);
  if (!c.ok) return { ok: false, message: `${tower.name}: ${c.errors[0]}${c.errors.length > 1 ? ` (and ${c.errors.length - 1} more)` : ''}` };
  for (const w of c.warnings) console.warn(`tower ${tower.id}: ${w}`);
  const def = towerFromJson(tower) as TowerDef;
  const index = addTower(def);
  if (opts.save) saveImported(tower);
  const from = opts.from ? ` from ${opts.from}` : '';
  return { ok: true, index, name: tower.name, pieces: tower.pieces.length, message: `Imported ${tower.name}${from}: ${tower.pieces.length} pieces, ${tower.crowns.length} crown${tower.crowns.length === 1 ? '' : 's'}` };
}

function loadSaved(): TowerJson[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveImported(t: TowerJson) {
  try {
    const list = loadSaved().filter((s) => s.id !== t.id);
    list.push(t);
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the tower still works this session */
  }
}

/** Drop every imported tower (bundled tower files stay). */
export function clearImported(): number {
  const before = TOWERS.length;
  const keep = TOWERS.slice(BUILTIN_TOWERS).filter((t) => bundledIds.has(t.id));
  removeCustomTowers();
  for (const t of keep) addTower(t);
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* ignore */
  }
  return before - TOWERS.length;
}

const bundledIds = new Set<string>();
export const importedCount = () => TOWERS.length - BUILTIN_TOWERS - bundledIds.size;

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

/** Load bundled tower files, `?tower=` URLs and saved imports. Never throws: a bad file is skipped with a console warning. */
export async function loadTowerFiles(): Promise<string[]> {
  const notes: string[] = [];
  // bundled: public/towers/index.json lists the files
  try {
    const files = JSON.parse(await fetchText('towers/index.json'));
    if (Array.isArray(files))
      for (const f of files) {
        if (typeof f !== 'string' || !/^[\w.-]+\.json$/.test(f)) continue;
        try {
          const r = importTowerText(await fetchText(`towers/${f}`));
          if (r.ok) bundledIds.add(TOWERS[r.index!].id);
          else console.warn(`towers/${f}: ${r.message}`);
        } catch (e) {
          console.warn(`towers/${f}: ${(e as Error).message}`);
        }
      }
  } catch {
    /* no bundled tower files */
  }
  // ?tower=<url> (any number of them)
  for (const url of new URLSearchParams(location.search).getAll('tower')) {
    try {
      const r = importTowerText(await fetchText(url), { from: 'URL' });
      notes.push(r.message);
      if (!r.ok) console.warn(`${url}: ${r.message}`);
    } catch (e) {
      notes.push(`Couldn't load tower from ${url}: ${(e as Error).message}`);
    }
  }
  // towers a host imported earlier on this TV
  for (const t of loadSaved()) {
    const r = importTowerText(JSON.stringify(t));
    if (!r.ok) console.warn(`saved tower: ${r.message}`);
  }
  return notes;
}

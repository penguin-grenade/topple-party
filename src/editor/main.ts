// Tower Editor: design Tower Pull towers in the browser and save them as tower files.

import { checkTowerJson, formatTowerJson, parseTowerJson, towerFromJson, type TowerJson, type PieceJson, type CrownJson, type PlinthJson } from '../tv/sim/towerFile';
import { buildLevel } from '../tv/sim/levels';
import { Sim, initPhysics, type Entity } from '../tv/sim/sim';
import { TOWER_CONTACT_HZ } from '../tv/sim/towers';
import { PullRun, SettleRun, towerCenter } from '../tv/sim/pullSim';
import { LAYER_H, Model, emptyTower, r, type Ref } from './model';
import { Plan, type Settings, type Tool } from './plan';
import { View3D } from './view3d';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const EXAMPLES = ['classic', 'square', 'ziggurat', 'lighthouse', 'twister', 'lean', 'scales', 'gate', 'arch', 'colossus', 'buttress', 'corkscrew', 'pivot', 'corbel', 'trident', 'j78d', 'aqueduct', 'citadel', 'babel', 'cathedral', 'metropolis'];
const LEN_PRESETS = [2.02, 3, 3.04, 4.06, 5.08, 6.1, 8.14, 10.18];

const model = new Model();
const settings: Settings = { tool: 'piece', len: 3, ang: 0, gold: false, crownSize: 1, plinthH: 1, snap: 0.51 };
const plan = new Plan($<HTMLCanvasElement>('plan'), model, settings);
const view = new View3D($<HTMLCanvasElement>('view'), model);

let toastTimer = 0;
function toast(text: string, ms = 2200) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ tools & settings
function setTool(tool: Tool) {
  settings.tool = tool;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  $('plan').style.cursor = tool === 'select' ? 'default' : 'crosshair';
  plan.draw();
}
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
const lenInput = $<HTMLInputElement>('pLen'), angInput = $<HTMLInputElement>('pAng'), goldInput = $<HTMLInputElement>('pGold');
const crownInput = $<HTMLInputElement>('cSize'), plinthInput = $<HTMLInputElement>('plH'), snapInput = $<HTMLSelectElement>('snap');
lenInput.value = String(settings.len);
angInput.value = String(settings.ang);
crownInput.value = String(settings.crownSize);
plinthInput.value = String(settings.plinthH);
for (const l of LEN_PRESETS) {
  const b = document.createElement('button');
  b.textContent = String(l);
  b.onclick = () => {
    settings.len = l;
    lenInput.value = String(l);
    applyToSelection((p) => (p.len = l));
    plan.draw();
  };
  $('lenPresets').appendChild(b);
}
lenInput.oninput = () => {
  const v = Number(lenInput.value);
  if (v >= 0.5 && v <= 40) {
    settings.len = v;
    applyToSelection((p) => (p.len = v));
    plan.draw();
  }
};
angInput.oninput = () => {
  const v = Number(angInput.value);
  if (Number.isFinite(v)) {
    settings.ang = v;
    applyToSelection((p) => (p.ang = v));
    plan.draw();
  }
};
document.querySelectorAll<HTMLButtonElement>('[data-ang]').forEach(
  (b) =>
    (b.onclick = () => {
      settings.ang = Number(b.dataset.ang);
      angInput.value = String(settings.ang);
      applyToSelection((p) => (p.ang = settings.ang));
      plan.draw();
    }),
);
goldInput.onchange = () => {
  settings.gold = goldInput.checked;
  applyToSelection((p) => (p.gold = settings.gold));
  plan.draw();
};
crownInput.oninput = () => (settings.crownSize = Math.max(0.4, Math.min(2, Number(crownInput.value) || 1)));
plinthInput.oninput = () => (settings.plinthH = Math.max(0.1, Math.min(10, Number(plinthInput.value) || 1)));
snapInput.onchange = () => (settings.snap = Number(snapInput.value));

/** Piece settings also edit the selected pieces, so you can fix a length after placing. */
function applyToSelection(fn: (p: PieceJson) => void) {
  const refs = model.selection.filter((s) => s.kind === 'piece');
  if (!refs.length) return;
  model.edit(() => {
    for (const s of refs) fn(model.tower.pieces[s.i]);
  });
}

// ------------------------------------------------------------------ tower meta
const nameInput = $<HTMLInputElement>('tName'), idInput = $<HTMLInputElement>('tId'), blurbInput = $<HTMLInputElement>('tBlurb'), yawInput = $<HTMLInputElement>('tYaw');
function metaToInputs() {
  const t = model.tower;
  nameInput.value = t.name;
  idInput.value = t.id;
  blurbInput.value = t.blurb ?? '';
  yawInput.value = t.yaw === undefined ? '' : String(t.yaw);
}
const metaEdit = (fn: (t: TowerJson) => void) => model.edit(() => fn(model.tower));
nameInput.onchange = () => metaEdit((t) => (t.name = nameInput.value.trim() || 'My Tower'));
idInput.onchange = () =>
  metaEdit((t) => {
    const v = idInput.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-tower';
    t.id = v.slice(0, 40);
    idInput.value = t.id;
  });
blurbInput.onchange = () =>
  metaEdit((t) => {
    if (blurbInput.value.trim()) t.blurb = blurbInput.value.trim();
    else delete t.blurb;
  });
yawInput.onchange = () =>
  metaEdit((t) => {
    if (yawInput.value.trim() === '') delete t.yaw;
    else t.yaw = Number(yawInput.value);
  });

// ------------------------------------------------------------------ layers
function setLayer(y: number) {
  model.layerY = r(Math.max(0, y));
  refreshLayer();
  plan.draw();
  view.restyle();
}
function refreshLayer() {
  $('layerY').textContent = `y ${model.layerY.toFixed(3)}`;
  const n = model.tower.pieces.filter((p) => Math.abs(p.y - model.layerY) < 0.01).length;
  const c = model.tower.crowns.filter((k) => Math.abs(k.y - model.layerY) < 0.01).length;
  const idx = Math.round((model.layerY - 1) / LAYER_H);
  $('layerInfo').textContent = `${n} piece${n === 1 ? '' : 's'}${c ? `, ${c} crown${c === 1 ? '' : 's'}` : ''} · layer ${idx} above a 1-high plinth`;
}
/** Step to the next height in use above/below, or one layer if there is none. */
function stepLayer(dir: 1 | -1) {
  const levels = model.levels();
  const y = model.layerY;
  const next = dir > 0 ? levels.find((l) => l > y + 0.01) : [...levels].reverse().find((l) => l < y - 0.01);
  const one = r(y + dir * LAYER_H);
  // prefer a real level if it's within one layer; otherwise step exactly one layer
  if (next !== undefined && Math.abs(next - y) <= LAYER_H + 0.01) setLayer(next);
  else setLayer(Math.max(0, one));
}
$('layerUp').onclick = () => stepLayer(1);
$('layerDown').onclick = () => stepLayer(-1);
$('layerTop').onclick = () => setLayer(model.topY());
$('fitBtn').onclick = () => plan.fit();

function layerRefs(): Ref[] {
  const out: Ref[] = [];
  model.tower.pieces.forEach((p, i) => Math.abs(p.y - model.layerY) < 0.01 && out.push({ kind: 'piece', i }));
  model.tower.crowns.forEach((c, i) => Math.abs(c.y - model.layerY) < 0.01 && out.push({ kind: 'crown', i }));
  return out;
}
function duplicateLayer(turn: boolean) {
  const src = model.tower.pieces.filter((p) => Math.abs(p.y - model.layerY) < 0.01);
  if (!src.length) return toast('Nothing on this layer to duplicate');
  const y = r(model.layerY + LAYER_H);
  model.edit(() => {
    const i0 = model.tower.pieces.length;
    for (const p of src) {
      const q: PieceJson = { ...p, y };
      if (turn) {
        // turn the whole layer 90° about its centre, so a 3-across layer becomes the crossing layer
        const cx = src.reduce((a, s) => a + s.x, 0) / src.length, cz = src.reduce((a, s) => a + s.z, 0) / src.length;
        q.x = r(cx - (p.z - cz));
        q.z = r(cz + (p.x - cx));
        q.ang = (p.ang ?? 0) + 90;
      }
      model.tower.pieces.push(q);
    }
    model.selection = src.map((_, k) => ({ kind: 'piece', i: i0 + k }));
  });
  setLayer(y);
}
$('dupUp').onclick = () => duplicateLayer(true);
$('dupSame').onclick = () => duplicateLayer(false);
$('clearLayer').onclick = () => {
  const refs = layerRefs();
  if (!refs.length) return;
  model.selection = refs;
  deleteSelection();
};

// ------------------------------------------------------------------ selection edits
function deleteSelection() {
  if (!model.selection.length) return;
  model.edit(() => {
    const t = model.tower;
    const gone = (k: Ref['kind']) => new Set(model.selection.filter((s) => s.kind === k).map((s) => s.i));
    t.pieces = t.pieces.filter((_, i) => !gone('piece').has(i));
    t.crowns = t.crowns.filter((_, i) => !gone('crown').has(i));
    t.plinths = t.plinths.filter((_, i) => !gone('plinth').has(i));
    model.selection = [];
  });
}
function rotateSelection(deg: number) {
  const refs = model.selection.filter((s) => s.kind === 'piece' || s.kind === 'plinth');
  if (!refs.length) return;
  model.edit(() => {
    for (const s of refs) {
      const b = model.get(s) as PieceJson | PlinthJson;
      b.ang = (b.ang ?? 0) + deg;
    }
  });
}
function nudgeSelection(dx: number, dz: number) {
  if (!model.selection.length) return;
  const step = settings.snap || 0.1;
  model.edit(() => {
    for (const s of model.selection) {
      const b = model.get(s) as { x: number; z: number };
      b.x = r(b.x + dx * step);
      b.z = r(b.z + dz * step);
    }
  });
}
function duplicateSelection() {
  if (!model.selection.length) return;
  model.edit(() => {
    const t = model.tower;
    const added: Ref[] = [];
    for (const s of model.selection) {
      if (s.kind === 'piece') {
        t.pieces.push({ ...t.pieces[s.i], x: r(t.pieces[s.i].x + 1.02) });
        added.push({ kind: 'piece', i: t.pieces.length - 1 });
      } else if (s.kind === 'crown') {
        t.crowns.push({ ...t.crowns[s.i], x: r(t.crowns[s.i].x + 1.02) });
        added.push({ kind: 'crown', i: t.crowns.length - 1 });
      }
    }
    model.selection = added;
  });
}
function toggleGold() {
  const refs = model.selection.filter((s) => s.kind === 'piece');
  if (!refs.length) return;
  const any = refs.some((s) => !model.tower.pieces[s.i].gold);
  model.edit(() => {
    for (const s of refs) model.tower.pieces[s.i].gold = any;
  });
}

// ------------------------------------------------------------------ keyboard
window.addEventListener('keydown', (e) => {
  const inField = (e.target as HTMLElement).matches('input, select, textarea');
  if (inField && e.key !== 'Escape') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? model.redo() : model.undo();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    model.redo();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    model.selection = layerRefs();
    model.listeners.forEach((f) => f());
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateLayer(true);
    return;
  }
  if (ctrl && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }
  switch (e.key) {
    case '1': setTool('select'); break;
    case '2': setTool('piece'); break;
    case '3': setTool('row'); break;
    case '4': setTool('crown'); break;
    case '5': setTool('plinth'); break;
    case '[': stepLayer(-1); break;
    case ']': stepLayer(1); break;
    case 'r': case 'R':
      if (model.selection.length) rotateSelection(e.shiftKey ? -90 : 90);
      else {
        settings.ang = (settings.ang + 90) % 360;
        angInput.value = String(settings.ang);
        plan.draw();
      }
      break;
    case 'g': case 'G':
      if (model.selection.length) toggleGold();
      else {
        settings.gold = !settings.gold;
        goldInput.checked = settings.gold;
      }
      break;
    case 'd': case 'D': duplicateSelection(); break;
    case 'f': case 'F': plan.fit(); break;
    case 'Delete': case 'Backspace': deleteSelection(); break;
    case 'Escape':
      model.selection = [];
      model.listeners.forEach((f) => f());
      (document.activeElement as HTMLElement)?.blur?.();
      break;
    case 'ArrowLeft': nudgeSelection(-1, 0); e.preventDefault(); break;
    case 'ArrowRight': nudgeSelection(1, 0); e.preventDefault(); break;
    case 'ArrowUp': nudgeSelection(0, -1); e.preventDefault(); break;
    case 'ArrowDown': nudgeSelection(0, 1); e.preventDefault(); break;
    default: return;
  }
});

// ------------------------------------------------------------------ files
function currentJsonText() {
  return formatTowerJson(model.tower);
}
function save() {
  const blob = new Blob([currentJsonText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${model.tower.id || 'tower'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${a.download}`);
}
$('saveBtn').onclick = save;
$('copyBtn').onclick = async () => {
  try {
    await navigator.clipboard.writeText(currentJsonText());
    toast('Tower file copied. Paste it on the host phone: Import tower file…');
  } catch {
    toast("Couldn't copy (clipboard blocked). Use Save instead.");
  }
};
$('newBtn').onclick = () => {
  if (!confirm('Start a new, empty tower? (The current one stays in Undo.)')) return;
  model.replace(emptyTower());
  setLayer(1);
  plan.fit();
  view.frameTower();
};
$('openBtn').onclick = () => $<HTMLInputElement>('openFile').click();
$<HTMLInputElement>('openFile').onchange = async () => {
  const f = $<HTMLInputElement>('openFile').files?.[0];
  if (!f) return;
  loadText(await f.text(), f.name);
  $<HTMLInputElement>('openFile').value = '';
};
function loadText(text: string, from: string) {
  const { tower, check } = parseTowerJson(text);
  if (!tower) return toast(`${from}: ${check.errors[0]}`, 4000);
  model.replace(tower);
  setLayer(model.levels()[0] ?? 1);
  plan.fit();
  view.frameTower();
  toast(`Loaded ${tower.name} (${tower.pieces.length} pieces)`);
}
const ex = $<HTMLSelectElement>('examples');
for (const id of EXAMPLES) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = id;
  ex.appendChild(o);
}
ex.onchange = async () => {
  const id = ex.value;
  ex.value = '';
  if (!id) return;
  try {
    const res = await fetch(`../towers/examples/${id}.json`);
    if (!res.ok) throw new Error(`${res.status}`);
    loadText(await res.text(), id);
  } catch (e) {
    toast(`Couldn't load the example: ${(e as Error).message}`);
  }
};
// drag a .json file onto the page
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadText(await f.text(), f.name);
});
$('playBtn').onclick = () => {
  const c = checkTowerJson(model.tower);
  if (!c.ok) return toast(`Fix the errors first: ${c.errors[0]}`, 4000);
  // the game loads towers saved under this key at start-up (the same list the phone import uses)
  try {
    const key = 'topple.towers';
    const list: TowerJson[] = JSON.parse(localStorage.getItem(key) || '[]');
    const t = JSON.parse(JSON.stringify(model.tower)) as TowerJson;
    delete t.source;
    localStorage.setItem(key, JSON.stringify([...list.filter((s) => s.id !== t.id), t]));
  } catch {
    return toast("Couldn't hand the tower to the game (storage blocked). Save it and import it on the phone instead.", 4000);
  }
  window.open('../', 'topple-party-game');
  toast(`${model.tower.name} is in the game's tower list (after the built-in ones)`);
};
$('undoBtn').onclick = () => model.undo();
$('redoBtn').onclick = () => model.redo();

// ------------------------------------------------------------------ checks, stats, selection panel
const checkList = $<HTMLUListElement>('checkList');
function refreshChecks() {
  const t = model.tower;
  const c = checkTowerJson(t);
  const top = model.topY();
  $('stats').textContent = `${t.pieces.length} pieces · ${t.crowns.length} crown${t.crowns.length === 1 ? '' : 's'} · ${t.plinths.length} plinth${t.plinths.length === 1 ? '' : 's'} · top at y ${top.toFixed(2)} · ${Math.max(0, Math.round((top - 1) / LAYER_H))} layers`;
  checkList.innerHTML = '';
  plan.flagged = new Set();
  const add = (cls: string, text: string, ref?: Ref) => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    if (ref) {
      plan.flagged.add(`${ref.kind} ${ref.i}`);
      li.onclick = () => {
        model.selection = [ref];
        const b = model.get(ref);
        if (ref.kind !== 'plinth') setLayer((b as PieceJson | CrownJson).y);
        model.listeners.forEach((f) => f());
      };
    }
    checkList.appendChild(li);
  };
  const refIn = (msg: string): Ref | undefined => {
    const m = /^(piece|crown|plinth) (\d+)/.exec(msg);
    return m ? { kind: m[1] as Ref['kind'], i: Number(m[2]) } : undefined;
  };
  for (const e of c.errors) add('err', e, refIn(e));
  for (const w of c.warnings) add('warn', w, refIn(w));
  if (!c.errors.length && !c.warnings.length) add('ok', 'No problems found. Run the settle test to be sure.');
  $('pullBtn').toggleAttribute('disabled', !(model.selection.length === 1 && model.selection[0].kind === 'piece') || view.inPhysics);
  // selection panel
  const si = $('selInfo');
  if (model.selection.length === 1) {
    const s = model.selection[0];
    const b = model.get(s);
    si.style.display = '';
    if (s.kind === 'piece') {
      const p = b as PieceJson;
      si.innerHTML = `<b>Piece ${s.i}</b> · x ${p.x} · y ${p.y} · z ${p.z} · len ${p.len} · ${p.ang ?? 0}°${p.gold ? ' · gold' : ''}`;
    } else if (s.kind === 'crown') {
      const k = b as CrownJson;
      si.innerHTML = `<b>Crown ${s.i}</b> · x ${k.x} · y ${k.y} · z ${k.z} · size ${k.size ?? 1}`;
    } else {
      const p = b as PlinthJson;
      si.innerHTML = `<b>Plinth ${s.i}</b> · x ${p.x} · z ${p.z} · ${p.w} × ${p.d} · h ${p.h ?? 1}`;
    }
  } else if (model.selection.length > 1) {
    si.style.display = '';
    si.innerHTML = `<b>${model.selection.length} selected</b> · R turns, G gold, Del deletes, arrows nudge`;
  } else si.style.display = 'none';
  $('undoBtn').toggleAttribute('disabled', !model.canUndo());
  $('redoBtn').toggleAttribute('disabled', !model.canRedo());
}

// ------------------------------------------------------------------ physics tests
let run: { tick: () => boolean; sim: Sim; kind: 'settle' | 'pull'; piece?: Entity; snapshotFell: Set<Entity> } | null = null;
let physicsReady: Promise<void> | null = null;
const physMsg = $('physMsg');
function say(text: string) {
  physMsg.textContent = text;
  physMsg.classList.add('show');
}
async function startPhysics(kind: 'settle' | 'pull') {
  const c = checkTowerJson(model.tower);
  if (!c.ok) return toast(`Fix the errors first: ${c.errors[0]}`, 4000);
  physicsReady ??= initPhysics();
  say('Loading physics…');
  await physicsReady;
  const spec = buildLevel(towerFromJson(model.tower), 1);
  const sim = new Sim();
  sim.load(spec, { autoScore: false, substeps: 1, contactHz: TOWER_CONTACT_HZ });
  view.startPhysics(sim);
  $('stopBtn').style.display = '';
  $('settleBtn').toggleAttribute('disabled', true);
  $('pullBtn').toggleAttribute('disabled', true);
  if (kind === 'settle') {
    const sr = new SettleRun(sim, 90, 8 * 60);
    run = { kind, sim, snapshotFell: new Set(), tick: () => false };
    run.tick = () => {
      const done = sr.tick();
      if (done && sr.result) {
        const f = sr.result;
        run!.snapshotFell = new Set(f.fell);
        say(f.ok ? `Stands. Nothing fell in ${f.secs.toFixed(0)} s; biggest creep ${f.creep.toFixed(2)}.` : f.fell.length ? `${f.fell.length} block${f.fell.length === 1 ? '' : 's'} fell (shown red) after ${f.secs.toFixed(1)} s.` : `Stood, but crept ${f.creep.toFixed(2)} units: something is barely balanced.`);
      }
      return done;
    };
    say('Settling…');
  } else {
    const s = model.selection[0];
    const piece = sim.ents[s.i]; // pieces come first in the built level, in file order
    sim.settle(90);
    const pr = new PullRun(sim, piece, { center: towerCenter(sim) });
    run = { kind, sim, piece, snapshotFell: new Set(), tick: () => false };
    run.tick = () => {
      const done = pr.tick();
      run!.snapshotFell = new Set(pr.rubble);
      if (done && pr.result) {
        const q = pr.result;
        say(q.crown ? `A crown fell! Pulling this piece topples the tower (−15).` : q.stuck ? `Stuck: it would not come out either way in ${q.secs.toFixed(0)} s.` : q.fell ? `Spill: it came out in ${q.secs.toFixed(1)} s but ${q.fell} other piece${q.fell === 1 ? '' : 's'} fell (−${Math.min(15, 5 * q.fell)}); play would go on.` : `Clean pull in ${q.secs.toFixed(1)} s. Nothing else moved.`);
      }
      return done;
    };
    say('Pulling…');
  }
  const step = () => {
    if (!run) return;
    // a few sim frames per animation frame so a test doesn't take all day
    let done = false;
    for (let i = 0; i < 3 && !done; i++) done = run.tick();
    view.syncPhysics(run.sim, run.snapshotFell, run.piece);
    if (!done) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stopPhysics() {
  run = null;
  view.stopPhysics();
  physMsg.classList.remove('show');
  $('stopBtn').style.display = 'none';
  $('settleBtn').toggleAttribute('disabled', false);
  refreshChecks();
}
$('settleBtn').onclick = () => startPhysics('settle');
$('pullBtn').onclick = () => startPhysics('pull');
$('stopBtn').onclick = stopPhysics;

// ------------------------------------------------------------------ wiring
view.onPick = (ref) => {
  if (settings.tool !== 'select') setTool('select');
  model.selection = ref ? [ref] : [];
  if (ref && ref.kind !== 'plinth') setLayer((model.get(ref) as PieceJson).y);
  model.listeners.forEach((f) => f());
};
plan.onStatus = (s) => ($('status').textContent = s);
let rebuildQueued = false;
model.onChange(() => {
  if (view.inPhysics) stopPhysics();
  metaToInputs();
  refreshLayer();
  refreshChecks();
  plan.draw();
  if (!rebuildQueued) {
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      view.rebuild();
    });
  }
});
setTool('piece');
metaToInputs();
setLayer(model.topY() > 1 ? model.topY() : 1);
refreshChecks();
view.rebuild();
requestAnimationFrame(() => {
  plan.fit();
  view.frameTower();
});
(window as unknown as { __editor: unknown }).__editor = { model, settings, plan, view };

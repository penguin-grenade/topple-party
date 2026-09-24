import { MODES, PROTOCOL_VERSION, cleanName, type C2S, type PadView, type S2C } from '../shared/protocol';
import { connectToRoom, netConfigFromUrl, type Link } from '../shared/net';
import { MotionInput } from './motion';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DEG = Math.PI / 180;

// ---------- persistent settings ----------
// Local-transport test mode runs several "phones" as tabs of one browser, so keep their state per tab.
const store = (): Storage => (new URLSearchParams(location.search).has('local') ? sessionStorage : localStorage);
function load(key: string, def: string): string {
  try {
    return store().getItem('topple.' + key) ?? def;
  } catch {
    return def;
  }
}
function save(key: string, val: string) {
  try {
    store().setItem('topple.' + key, val);
  } catch {
    /* private mode */
  }
}

const ADJ = ['Wobbly', 'Sneaky', 'Mighty', 'Fuzzy', 'Turbo', 'Lucky', 'Cosmic', 'Sleepy', 'Zippy', 'Bouncy', 'Grumpy', 'Jolly', 'Rowdy', 'Spicy'];
const NOUN = ['Walrus', 'Penguin', 'Otter', 'Llama', 'Yeti', 'Badger', 'Gecko', 'Moose', 'Panda', 'Taco', 'Robot', 'Narwhal', 'Pickle', 'Goose'];
const randomName = () => ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)];

let token = load('token', '');
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  save('token', token);
}

const netCfg = netConfigFromUrl();
const motion = new MotionInput();
let sensitivity = Number(load('sens', '1')) || 1;
motion.setSensitivity(sensitivity);
let aimMode: 'motion' | 'touch' = (load('aim', 'motion') as 'motion' | 'touch');
if (!window.isSecureContext) aimMode = 'touch';

// ---------- state ----------
let link: Link | null = null;
let roomCode = '';
let myName = load('name', '') || randomName();
let myColor = '#888';
let view: PadView | null = null;
let lastPong = 0;
let reconnecting = false;
let leaving = false;
let cooldownUntil = 0;
let touchAim = { x: 0, y: 0 };

// ---------- DOM ----------
const codeIn = $<HTMLInputElement>('code');
const nameIn = $<HTMLInputElement>('name');
const joinBtn = $<HTMLButtonElement>('joinBtn');
const joinErr = $('joinErr');
const actionBtn = $<HTMLButtonElement>('action');
const actionLabel = $('actionLabel');
const ring = $('ring');

codeIn.value = (location.hash.replace('#', '') || load('lastCode', '')).toUpperCase().slice(0, 4);
nameIn.value = myName;
const updateJoinEnabled = () => {
  joinBtn.disabled = codeIn.value.trim().length !== 4;
};
codeIn.addEventListener('input', () => {
  codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  updateJoinEnabled();
});
updateJoinEnabled();
if (location.hash.length > 1) nameIn.focus();

function show(screen: 'join' | 'pad') {
  $('join').classList.toggle('hidden', screen !== 'join');
  $('pad').classList.toggle('hidden', screen !== 'pad');
}
function overlay(text: string | null, sub = '') {
  const o = $('overlay');
  o.classList.toggle('hidden', !text);
  if (text) {
    $('overlayText').textContent = text;
    $('overlaySub').textContent = sub;
  }
}

function send(m: C2S) {
  link?.send(m);
}

// ---------- joining ----------
joinBtn.addEventListener('click', () => {
  const code = codeIn.value.trim().toUpperCase();
  leaving = false;
  myName = cleanName(nameIn.value || randomName());
  save('name', myName);
  save('lastCode', code);
  // Permission prompt must run inside the click handler (iOS).
  const perm = aimMode === 'motion' ? motion.requestPermission() : Promise.resolve(false);
  requestWakeLock();
  joinBtn.disabled = true;
  joinErr.textContent = '';
  overlay('Connecting…', `Room ${code}`);
  perm.then((ok) => {
    if (!ok && aimMode === 'motion') {
      aimMode = 'touch';
      toast('Motion sensors unavailable — using touch aiming.');
    }
    connect(code);
  });
});

let connecting = false;
async function connect(code: string) {
  if (connecting) return;
  connecting = true;
  roomCode = code;
  try {
    const l = await connectToRoom(code, netCfg);
    connecting = false;
    if (leaving) {
      l.close();
      return;
    }
    if (link && link !== l) link.close();
    link = l;
    lastPong = performance.now();
    l.onMessage = (m) => {
      if (link === l) onMessage(m);
    };
    l.onClose = () => {
      if (link !== l) return;
      link = null;
      if (!leaving) scheduleReconnect();
    };
    send({ t: 'hello', v: PROTOCOL_VERSION, name: myName, token });
    reconnecting = false;
    overlay(null);
    history.replaceState(null, '', location.pathname + location.search + '#' + code);
  } catch (e) {
    connecting = false;
    if (leaving) return;
    if (reconnecting) {
      scheduleReconnect();
      return;
    }
    overlay(null);
    show('join');
    joinBtn.disabled = false;
    joinErr.textContent = (e as Error).message;
  }
}

let reconnectTimer = 0;
let reconnectSince = 0;
function scheduleReconnect() {
  if (leaving) return;
  if (!reconnecting) reconnectSince = performance.now();
  if (performance.now() - reconnectSince > 30000) {
    // The TV is gone (closed, or restarted with a new code). Back to the join screen.
    leaveGame('Lost the connection to the TV. Check the code on the TV and join again.');
    return;
  }
  reconnecting = true;
  overlay('Reconnecting…', 'Keep this page open. Hang tight!');
  clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => connect(roomCode), 1500);
}

function onMessage(raw: unknown) {
  const m = raw as S2C;
  switch (m.t) {
    case 'welcome':
      myColor = m.color;
      myName = m.name;
      document.documentElement.style.setProperty('--me', m.color);
      $('pname').textContent = m.name;
      show('pad');
      if (!calibratedOnce && aimMode === 'motion') showCalib();
      break;
    case 'view':
      view = m.v;
      render();
      break;
    case 'buzz':
      try {
        navigator.vibrate?.(m.ms);
      } catch {
        /* no vibration */
      }
      break;
    case 'pong':
      lastPong = performance.now();
      break;
    case 'full':
      leaveGame('That game is full (8 players max).');
      break;
    case 'bye':
      leaveGame(m.reason);
      break;
  }
}

// heartbeat
setInterval(() => {
  if (!link) return;
  send({ t: 'ping', ts: Date.now() });
  if (performance.now() - lastPong > 7000 && !reconnecting) {
    const l = link;
    link = null;
    l.close();
    scheduleReconnect();
  }
}, 2000);

// ---------- calibration ----------
let calibratedOnce = false;
function showCalib() {
  $('calib').classList.remove('hidden');
  // No sensor data (desktop browser, sensors blocked)? Fall back to the touch pad.
  setTimeout(() => {
    if (aimMode === 'motion' && !motion.orientationSeen) {
      aimMode = 'touch';
      $('calib').classList.add('hidden');
      toast('No motion sensors found. Drag the pad to aim instead.');
      render();
    }
  }, 1500);
}
$('calibBtn').addEventListener('click', () => {
  motion.recenter();
  calibratedOnce = true;
  $('calib').classList.add('hidden');
  navigator.vibrate?.(20);
});
$('recenter').addEventListener('click', () => {
  if (aimMode === 'motion') {
    motion.recenter();
    toast('Centered! Point at the middle of the TV when you tap this.');
  } else touchAim = { x: 0, y: 0 };
  navigator.vibrate?.(15);
});

// ---------- rendering ----------
function render() {
  const v = view;
  if (!v) return;
  $('title').textContent = v.title;
  $('sub').textContent = v.sub ?? '';
  $('pscore').textContent = `${v.score} pts`;
  const ammo = $('ammo');
  ammo.innerHTML = '';
  if (v.ammo != null && v.control === 'throw') {
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'ball' + (i < v.ammo ? '' : ' used');
      ammo.appendChild(d);
    }
  }
  // host panel
  const hp = $('hostPanel');
  hp.innerHTML = '';
  const hostScreens = ['lobby', 'results', 'paused'];
  hp.classList.toggle('hidden', !(v.host && hostScreens.includes(v.screen)));
  if (v.host && v.screen === 'lobby') {
    const modes = document.createElement('div');
    modes.className = 'modes';
    for (const md of MODES) {
      const b = document.createElement('button');
      b.className = 'mode' + (md.id === v.mode ? ' sel' : '');
      b.innerHTML = `<b>${md.name}</b><small>${md.turns ? 'take turns' : 'all at once'}</small>`;
      b.onclick = () => send({ t: 'host', a: 'mode', mode: md.id });
      modes.appendChild(b);
    }
    hp.appendChild(modes);
    const rounds = document.createElement('div');
    rounds.className = 'rounds';
    const label = MODES.find((m) => m.id === v.mode)?.roundsLabel ?? 'rounds';
    rounds.innerHTML = `<button id="rMinus">−</button><span>${v.rounds} ${label}</span><button id="rPlus">+</button>`;
    hp.appendChild(rounds);
    rounds.querySelector<HTMLButtonElement>('#rMinus')!.onclick = () => send({ t: 'host', a: 'rounds', n: v.rounds - 1 });
    rounds.querySelector<HTMLButtonElement>('#rPlus')!.onclick = () => send({ t: 'host', a: 'rounds', n: v.rounds + 1 });
    const start = document.createElement('button');
    start.className = 'start';
    start.textContent = 'START GAME';
    start.onclick = () => send({ t: 'host', a: 'start' });
    hp.appendChild(start);
  } else if (v.host && v.screen === 'results') {
    hp.appendChild(hostButton('PLAY AGAIN', 'start', () => send({ t: 'host', a: 'again' })));
    hp.appendChild(hostButton('Back to lobby', '', () => send({ t: 'host', a: 'lobby' })));
  } else if (v.host && v.screen === 'paused') {
    hp.appendChild(hostButton('RESUME', 'start', () => send({ t: 'host', a: 'resume' })));
    hp.appendChild(hostButton('Quit to lobby', '', () => send({ t: 'host', a: 'lobby' })));
  }
  $('pauseBtn').classList.toggle('hidden', !(v.host && (v.screen === 'play' || v.screen === 'wait')));

  // action button
  const enabled = v.control !== 'none' && !(v.control === 'throw' && v.ammo === 0);
  actionBtn.disabled = !enabled;
  actionBtn.dataset.kind = v.control;
  actionLabel.textContent = v.control === 'throw' ? 'THROW' : v.control === 'grab' ? 'GRAB' : 'WAIT';
  $('hint').textContent =
    v.control === 'throw'
      ? aimMode === 'motion'
        ? 'Point at the TV · hold the button · flick your wrist'
        : 'Drag the pad to aim · hold to charge · release to throw'
      : v.control === 'grab'
        ? aimMode === 'motion'
          ? 'Point at a block · hold GRAB · tilt phone toward you to pull (or slide thumb down)'
          : 'Drag the pad to aim · hold GRAB · slide thumb down to pull, up to push'
        : '';
  $('touchpad').classList.toggle('hidden', aimMode !== 'touch' || v.control === 'none');
  $('camPad').classList.toggle('hidden', !v.camera);
}

function hostButton(text: string, cls: string, fn: () => void) {
  const b = document.createElement('button');
  b.className = 'hbtn ' + cls;
  b.textContent = text;
  b.onclick = fn;
  return b;
}

$('pauseBtn').addEventListener('click', () => send({ t: 'host', a: 'pause' }));

let toastTimer = 0;
function toast(text: string) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- aiming ----------
function currentAim(): { x: number; y: number } {
  return aimMode === 'motion' ? { x: motion.x, y: motion.y } : touchAim;
}

const pad = $('touchpad');
let padPointer: { id: number; x: number; y: number } | null = null;
pad.addEventListener('pointerdown', (e) => {
  padPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  pad.setPointerCapture(e.pointerId);
});
pad.addEventListener('pointermove', (e) => {
  if (!padPointer || padPointer.id !== e.pointerId) return;
  const dx = e.clientX - padPointer.x, dy = e.clientY - padPointer.y;
  padPointer.x = e.clientX;
  padPointer.y = e.clientY;
  const r = pad.getBoundingClientRect();
  touchAim.x = Math.max(-1.1, Math.min(1.1, touchAim.x + (dx / r.width) * 2.2 * sensitivity));
  touchAim.y = Math.max(-1.1, Math.min(1.1, touchAim.y - (dy / r.height) * 2.2 * sensitivity));
});
const endPad = () => (padPointer = null);
pad.addEventListener('pointerup', endPad);
pad.addEventListener('pointercancel', endPad);

// ---------- camera pad (Tower Pull): drag to orbit / raise, pinch or buttons to zoom ----------
const camPad = $('camPad');
const camTouches = new Map<number, { x: number; y: number }>();
const camAcc = { dx: 0, dy: 0, dz: 0 };
const pinchDist = () => {
  const [a, b] = [...camTouches.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};
camPad.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  camPad.setPointerCapture(e.pointerId);
  camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  camPad.classList.add('active');
});
camPad.addEventListener('pointermove', (e) => {
  const prev = camTouches.get(e.pointerId);
  if (!prev) return;
  if (camTouches.size >= 2) {
    const before = pinchDist();
    camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    camAcc.dz -= (pinchDist() - before) / 300; // spread fingers = zoom in
    return;
  }
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  camTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  camAcc.dx -= (dx / camPad.clientWidth) * Math.PI; // the tower turns with your finger
  camAcc.dy -= (dy / camPad.clientHeight) * 4; // drag up to look higher
});
const camUp = (e: PointerEvent) => {
  camTouches.delete(e.pointerId);
  if (!camTouches.size) camPad.classList.remove('active');
};
camPad.addEventListener('pointerup', camUp);
camPad.addEventListener('pointercancel', camUp);
$('zoomIn').addEventListener('click', () => (camAcc.dz -= 0.12));
$('zoomOut').addEventListener('click', () => (camAcc.dz += 0.12));

// ---------- action button: throw / grab ----------
let pressed = false;
let fired = false;
let pressT = 0;
let grab: { yaw0: number; pitch0: number; tx0: number; ty0: number; tx: number; ty: number } | null = null;

motion.onFlick = (x, y, power) => {
  if (!pressed || fired || view?.control !== 'throw') return;
  if (!doThrow(x, y, power)) motion.armed = true; // still cooling down: wait for the next flick
};

let flickHints = 0;
function doThrow(x: number, y: number, p: number): boolean {
  if (performance.now() < cooldownUntil) return false;
  fired = true;
  send({ t: 'throw', x, y, p });
  cooldownUntil = performance.now() + Math.max(0.4, (view?.cooldown ?? 0.75) - 0.1) * 1000;
  navigator.vibrate?.(Math.round(20 + p * 40));
  actionBtn.classList.remove('thrown');
  void actionBtn.offsetWidth;
  actionBtn.classList.add('thrown');
  $('power').style.setProperty('--p', String(p));
  $('power').classList.add('show');
  setTimeout(() => $('power').classList.remove('show'), 700);
  return true;
}

actionBtn.addEventListener('pointerdown', (e) => {
  if (actionBtn.disabled || !view) return;
  e.preventDefault();
  actionBtn.setPointerCapture(e.pointerId);
  pressed = true;
  fired = false;
  pressT = performance.now();
  actionBtn.classList.add('down');
  if (view.control === 'throw') {
    motion.armed = aimMode === 'motion' && motion.motionSeen;
  } else if (view.control === 'grab') {
    const a = currentAim();
    send({ t: 'grab', x: a.x, y: a.y });
    grab = { yaw0: motion.relYaw, pitch0: motion.relPitch, tx0: e.clientX, ty0: e.clientY, tx: e.clientX, ty: e.clientY };
  }
});
actionBtn.addEventListener('pointermove', (e) => {
  if (grab) {
    grab.tx = e.clientX;
    grab.ty = e.clientY;
  }
});
const release = () => {
  if (!pressed) return;
  pressed = false;
  actionBtn.classList.remove('down');
  motion.armed = false;
  if (view?.control === 'throw' && !fired) {
    const useMotion = aimMode === 'motion' && motion.motionSeen;
    const a = currentAim();
    if (!useMotion) doThrow(a.x, a.y, chargePower());
    else if (performance.now() - pressT < 450) doThrow(a.x, a.y, 0.3); // quick tap = gentle lob
    else if (flickHints++ < 3) toast('Flick your wrist toward the TV while holding the button!');
  }
  if (grab) {
    send({ t: 'release' });
    grab = null;
  }
  ring.style.setProperty('--c', '0');
};
actionBtn.addEventListener('pointerup', release);
actionBtn.addEventListener('pointercancel', release);

function chargePower(): number {
  // ping-pong 0..1 over 1.2s so a long hold isn't always max
  const t = ((performance.now() - pressT) / 1200) % 2;
  return 0.15 + 0.85 * (t < 1 ? t : 2 - t);
}

// send aim / pull at ~30 Hz
let lastSent = { x: 9, y: 9, t: 0 };
setInterval(() => {
  if (!link || !view) return;
  const now = performance.now();
  if (camAcc.dx || camAcc.dy || camAcc.dz) {
    send({ t: 'cam', dx: +camAcc.dx.toFixed(4), dy: +camAcc.dy.toFixed(3), dz: +camAcc.dz.toFixed(3) });
    camAcc.dx = camAcc.dy = camAcc.dz = 0;
  }
  if (grab) {
    const h = window.innerHeight, w = window.innerWidth;
    let d = (grab.ty - grab.ty0) / (0.22 * h);
    let s = (grab.tx - grab.tx0) / (0.3 * w);
    if (aimMode === 'motion') {
      d += (motion.relPitch - grab.pitch0) / (18 * DEG);
      s += -(motion.relYaw - grab.yaw0) / (18 * DEG);
    }
    send({ t: 'pull', d: Math.max(-1.5, Math.min(1.5, d)), s: Math.max(-1, Math.min(1, s)) });
    return;
  }
  if (view.control === 'none') return;
  const a = currentAim();
  if (Math.abs(a.x - lastSent.x) > 0.002 || Math.abs(a.y - lastSent.y) > 0.002 || now - lastSent.t > 400) {
    send({ t: 'aim', x: +a.x.toFixed(4), y: +a.y.toFixed(4) });
    lastSent = { x: a.x, y: a.y, t: now };
  }
}, 33);

// charge ring + cooldown visuals
function frame() {
  const now = performance.now();
  if (pressed && view?.control === 'throw' && !(aimMode === 'motion' && motion.motionSeen)) {
    ring.style.setProperty('--c', chargePower().toFixed(3));
  }
  actionBtn.classList.toggle('cool', now < cooldownUntil);
  const dot = $('aimDot');
  const a = currentAim();
  dot.style.transform = `translate(${a.x * 40}px, ${-a.y * 40}px)`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- settings ----------
const sensIn = $<HTMLInputElement>('sens');
sensIn.value = String(sensitivity);
sensIn.addEventListener('input', () => {
  sensitivity = Number(sensIn.value);
  motion.setSensitivity(sensitivity);
  save('sens', String(sensitivity));
});
const aimSel = $<HTMLSelectElement>('aimMode');
aimSel.value = aimMode;
aimSel.addEventListener('change', () => {
  aimMode = aimSel.value as 'motion' | 'touch';
  save('aim', aimMode);
  if (aimMode === 'motion' && motion.permission !== 'granted') motion.requestPermission();
  render();
});
$('settingsBtn').addEventListener('click', () => $('settings').classList.remove('hidden'));
$('settingsClose').addEventListener('click', () => $('settings').classList.add('hidden'));
const renameIn = $<HTMLInputElement>('renameIn');
$('settingsBtn').addEventListener('click', () => (renameIn.value = myName));
const applyRename = () => {
  const n = cleanName(renameIn.value);
  if (!renameIn.value.trim() || n === myName) return;
  myName = n;
  save('name', myName);
  nameIn.value = myName;
  $('pname').textContent = myName;
  send({ t: 'name', name: myName });
};
renameIn.addEventListener('change', applyRename);
$('settingsClose').addEventListener('click', applyRename);

/** Stop playing: drop the connection and don't auto-reconnect until the player taps JOIN again. */
function leaveGame(message = '') {
  leaving = true;
  clearTimeout(reconnectTimer);
  reconnecting = false;
  const l = link;
  link = null;
  l?.close();
  view = null;
  roomCode = '';
  overlay(null);
  $('settings').classList.add('hidden');
  $('calib').classList.add('hidden');
  show('join');
  joinBtn.disabled = false;
  joinErr.textContent = message;
}
$('leaveBtn').addEventListener('click', () => leaveGame());

// ---------- keep the screen awake ----------
let wakeLock: any = null;
async function requestWakeLock() {
  try {
    wakeLock = await (navigator as any).wakeLock?.request('screen');
  } catch {
    /* not supported */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (link || reconnecting) requestWakeLock();
    if (!link && roomCode && !leaving && view) scheduleReconnect();
  }
});
void wakeLock;

// Diagnostics for testing in a desktop browser
(window as any).__pad = { motion, send: (m: C2S) => send(m), state: () => ({ view, link: !!link, myColor }) };

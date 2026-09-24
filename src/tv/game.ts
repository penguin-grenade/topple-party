import { NetHost, netConfigFromUrl, netConfigToQuery, type Link, type NetConfig } from '../shared/net';
import { MAX_PLAYERS, MODES, PLAYER_COLORS, PROTOCOL_VERSION, cleanName, type C2S, type ModeId, type PadView, type S2C } from '../shared/protocol';
import { Sfx } from './audio';
import { Hud, ICON_SOUND_OFF, ICON_SOUND_ON, LOBBY_FOCUS, type ChipInfo, type LobbyFocus } from './hud';
import { BestShotMode, BlastMode, Mode, PracticeMode, PullMode } from './modes';
import { Renderer } from './render/renderer';
import type { LevelSpec } from './sim/levels';
import { Sim, type SimEvent, type SimOptions, type V3 } from './sim/sim';

export interface Player {
  id: number;
  token: string;
  name: string;
  color: string;
  colorName: string;
  seat: number;
  link: Link | null;
  connected: boolean;
  lastSeen: number;
  score: number;
  aim: { x: number; y: number };
  aimShown: { x: number; y: number };
  aimT: number;
  lastThrow: number;
  local?: boolean;
  lastView: string;
  delta: number;
  deltaT: number;
  goneSince: number;
}

const now = () => performance.now() / 1000;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class Game {
  readonly sim = new Sim();
  readonly renderer: Renderer;
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  players: Player[] = [];
  phase: 'lobby' | 'playing' | 'results' = 'lobby';
  mode: Mode;
  selMode: ModeId = 'blast';
  rounds = 3;
  paused = false;

  private net: NetHost;
  private netCfg: NetConfig;
  private nextId = 1;
  private lobbyFocus: LobbyFocus = 'start';
  private resultsFocus = 0;
  private pauseFocus = 0;
  private acc = 0;
  private lastT = 0;
  private viewTimer = 0;
  private uiTimer = 0;
  private debug = false;
  private lastRanks = new Map<number, number>();
  private mouse: { down: boolean; x: number; y: number; t0: number; dragY: number } = { down: false, x: 0, y: 0, t0: 0, dragY: 0 };
  /** counters for debugging / automated tests */
  private lastKeyBack = 0;
  stats = { throws: 0, ballHits: 0, booms: 0, scored: 0, last: { x: 0, y: 0, p: 0 } };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.netCfg = netConfigFromUrl();
    this.net = new NetHost(this.netCfg);
    this.mode = new PracticeMode(this);
    const saved = (() => {
      try {
        return JSON.parse(localStorage.getItem('topple.tv') || '{}');
      } catch {
        return {};
      }
    })();
    if (MODES.some((m) => m.id === saved.mode)) this.selMode = saved.mode;
    if (saved.rounds) this.rounds = clamp(saved.rounds, 1, 8);
  }

  async start() {
    this.enterLobby();
    this.net.onStatus = (s, detail) => {
      if (s === 'ready') this.hud.setNetStatus('Ready for players', 'ok');
      else if (s === 'connecting') this.hud.setNetStatus('Opening the room…', 'busy');
      else if (s === 'reconnecting') this.hud.setNetStatus('Reconnecting to the join server… (players already in are fine)', 'warn');
      else if (detail === 'browser-incompatible') this.hud.setNetStatus("This browser doesn't support WebRTC, so phones can't connect. Try the Android TV app or another browser.", 'err');
      else this.hud.setNetStatus(`Can't reach the join server (${detail ?? 'offline'}). Retrying…`, 'err');
    };
    this.net.onLink = (l) => this.onLink(l);
    let preferred: string | undefined;
    try {
      preferred = localStorage.getItem('topple.code') || undefined;
    } catch {
      /* ignore */
    }
    const code = await this.net.start(preferred);
    try {
      localStorage.setItem('topple.code', code);
    } catch {
      /* ignore */
    }
    const base = new URL('p/', location.href.split('#')[0].split('?')[0]);
    const url = base.href + netConfigToQuery(this.netCfg) + '#' + code;
    this.hud.setJoin(url, (base.host + base.pathname).replace(/\/$/, ''), code);
    (window as any).__joinUrl = url;
  }

  begin() {
    const loop = (t: number) => {
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.setupMouse();
    this.setupPointerUi();
    (window as any).__tvBack = () => this.back();
    if (!Game.inApp) {
      // TV browsers map the remote's Back button to browser-back. Keep one history entry of our own
      // so Back pauses/closes menus instead of leaving the game.
      history.pushState({ topple: 1 }, '');
      window.addEventListener('popstate', () => {
        // some remotes send a Back keydown *and* navigate back; don't handle the same press twice
        if (now() - this.lastKeyBack < 0.6 || this.back()) history.pushState({ topple: 1 }, '');
        else history.back();
      });
    }
  }

  static readonly inApp = /TopplePartyTV/.test(navigator.userAgent);

  // ------------------------------------------------------------------ pointer (mouse, LG Magic Remote, Samsung pointer)
  private setupPointerUi() {
    const ui = document.getElementById('ui')!;
    ui.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      this.sfx.unlock();
      this.uiAction(el.dataset.act!, Number(el.dataset.i ?? 0));
    });
    ui.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el || this.phase !== 'lobby') return;
      const act = el.dataset.act!;
      const f: LobbyFocus | null = act === 'mode' ? (`mode${el.dataset.i}` as LobbyFocus) : act.startsWith('rounds') ? 'rounds' : act === 'start' ? 'start' : null;
      if (f && f !== this.lobbyFocus) {
        this.lobbyFocus = f;
        this.uiTimer = 0;
      }
    });
    // hide the cursor when the pointer is idle (TV browsers always show one)
    let idle = 0;
    const wake = () => {
      document.body.classList.remove('nocursor');
      clearTimeout(idle);
      idle = window.setTimeout(() => document.body.classList.add('nocursor'), 2500);
    };
    window.addEventListener('mousemove', wake);
    wake();
    const fs = document.getElementById('fsTool')!;
    const d = document as any;
    const canFs = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
    if (Game.inApp || !canFs) fs.remove();
    this.refreshTools();
  }

  private uiAction(act: string, i: number) {
    switch (act) {
      case 'mode':
        if (this.phase !== 'lobby') return;
        this.selMode = MODES[i].id;
        this.lobbyFocus = `mode${i}` as LobbyFocus;
        this.sfx.blip(true);
        break;
      case 'rounds-':
      case 'rounds+':
        if (this.phase !== 'lobby') return;
        this.rounds = clamp(this.rounds + (act === 'rounds+' ? 1 : -1), 1, 8);
        this.lobbyFocus = 'rounds';
        this.sfx.blip(act === 'rounds+');
        break;
      case 'start':
        if (this.phase === 'lobby') this.startGame();
        return;
      case 'again':
        if (this.phase === 'results') this.startGame();
        return;
      case 'lobby':
        this.enterLobby();
        return;
      case 'resume':
        this.resume();
        return;
      case 'pause':
        this.pause();
        return;
      case 'sound':
        this.sfx.setMuted(!this.sfx.muted);
        this.refreshTools();
        return;
      case 'fullscreen':
        this.toggleFullscreen();
        return;
    }
    this.uiTimer = 0;
    this.pushViews();
  }

  toggleFullscreen() {
    const d = document as any;
    const el = document.documentElement as any;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else {
        const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
        if (p && p.catch) p.catch(() => {});
      }
    } catch {
      /* not allowed here */
    }
  }

  private refreshTools() {
    const snd = document.getElementById('soundTool');
    if (snd) {
      const html = this.sfx.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
      if (snd.innerHTML !== html) snd.innerHTML = html;
    }
    document.getElementById('pauseTool')?.classList.toggle('hidden', !(this.phase === 'playing' && !this.paused));
  }

  // ------------------------------------------------------------------ helpers used by modes
  byId(id: number): Player | null {
    return this.players.find((p) => p.id === id) ?? null;
  }
  host(): Player | null {
    return this.players.filter((p) => p.connected && !p.local).sort((a, b) => a.id - b.id)[0] ?? this.players.find((p) => p.connected) ?? null;
  }
  loadLevel(spec: LevelSpec, opts: Partial<SimOptions> = {}) {
    this.sim.load(spec, opts);
    this.renderer.setPlinths(spec.plinths);
    this.renderer.setCamera(spec.cam);
    this.renderer.setOutline(null);
    this.renderer.orbit = 0;
  }
  pick(x: number, y: number) {
    const r = this.renderer.ray(clamp(x, -1.05, 1.05), clamp(y, -1.05, 1.05));
    return this.sim.raycast(r.origin, r.dir, 150);
  }
  award(p: Player, points: number, at: V3) {
    if (!points) return;
    p.score += points;
    p.delta = (now() - p.deltaT < 1.5 ? p.delta : 0) + points;
    p.deltaT = now();
    const sc = this.renderer.project(at);
    this.hud.popup(sc.x, sc.y, `${points > 0 ? '+' : ''}${points}`, points < 0 ? '#ff5a6e' : p.color, points >= 25 ? 1.6 : points >= 10 ? 1.3 : 1);
    this.buzz(p, points >= 10 ? [40, 40, 80] : points < 0 ? [200] : 25);
    const idx = this.chips().findIndex((c) => c.id === p.id);
    if (idx >= 0) this.hud.bumpChip(idx);
    this.pushViews();
  }
  buzz(p: Player, ms: number | number[]) {
    this.send(p, { t: 'buzz', ms });
  }
  pushViews() {
    this.viewTimer = 0;
  }

  // ------------------------------------------------------------------ flow
  enterLobby() {
    this.mode.dispose();
    this.phase = 'lobby';
    this.paused = false;
    this.hud.showPause(false);
    this.hud.hideResults();
    this.hud.hideBanner();
    this.hud.showLobby(true);
    this.hud.setHud(false);
    // forget players who left
    this.players = this.players.filter((p) => p.connected);
    this.mode = new PracticeMode(this);
    this.mode.start();
    this.renderer.sway = 1;
    this.sfx.stopMusic();
    this.pushViews();
  }

  startGame() {
    const active = this.players.filter((p) => p.connected);
    if (!active.length) {
      this.hud.toast('Scan the QR code with your phone to join first!');
      return;
    }
    try {
      localStorage.setItem('topple.tv', JSON.stringify({ mode: this.selMode, rounds: this.rounds }));
    } catch {
      /* ignore */
    }
    this.mode.dispose();
    this.players = active;
    for (const p of this.players) {
      p.score = 0;
      p.delta = 0;
    }
    this.phase = 'playing';
    this.paused = false;
    this.hud.showLobby(false);
    this.hud.hideResults();
    this.sfx.blip(true);
    this.mode = this.selMode === 'blast' ? new BlastMode(this) : this.selMode === 'best' ? new BestShotMode(this) : new PullMode(this);
    this.mode.start();
    this.sfx.startMusic();
    this.pushViews();
  }

  finishGame() {
    this.phase = 'results';
    this.resultsFocus = 0;
    this.sim.grabEnd();
    this.renderer.setOutline(null);
    const rows = this.ranked();
    this.lastRanks = new Map(rows.map((r) => [r.id, r.rank]));
    const top = rows.filter((r) => r.rank === 1);
    const title = rows.length === 0 ? 'Game over' : top.length > 1 ? "It's a tie!" : `<span style="color:${top[0].color}">${top[0].name}</span> wins!`;
    this.hud.showResults(rows, title, this.resultsFocus, this.host()?.name ?? null);
    this.hud.setHud(false);
    this.hud.confetti(this.players.map((p) => p.color));
    this.sfx.stopMusic();
    this.sfx.fanfare();
    this.pushViews();
  }

  private ranked() {
    const rows = [...this.players].sort((a, b) => b.score - a.score);
    let rank = 0, prev = Infinity;
    return rows.map((p, i) => {
      if (p.score !== prev) rank = i + 1;
      prev = p.score;
      return { id: p.id, name: p.name, color: p.color, score: p.score, rank };
    });
  }

  pause() {
    if (this.phase !== 'playing' || this.paused) return;
    this.paused = true;
    this.pauseFocus = 0;
    this.hud.showPause(true, 0);
    this.pushViews();
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.hud.showPause(false);
    this.pushViews();
  }

  /** Android TV back button. Returns true if handled (false lets the app exit). */
  back(): boolean {
    if (this.paused) {
      this.resume();
      return true;
    }
    if (this.phase === 'playing') {
      this.pause();
      return true;
    }
    if (this.phase === 'results') {
      this.enterLobby();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ networking
  private onLink(link: Link) {
    let player: Player | null = null;
    const timer = setTimeout(() => {
      if (!player) link.close();
    }, 10000);
    link.onMessage = (raw: unknown) => {
      const m = raw as C2S;
      if (!m || typeof m !== 'object') return;
      if (!player) {
        if (m.t === 'hello') {
          clearTimeout(timer);
          player = this.admit(link, m);
        }
        return;
      }
      player.lastSeen = now();
      this.onMessage(player, m);
    };
    link.onClose = () => {
      clearTimeout(timer);
      if (player && player.link === link) this.dropPlayer(player);
    };
  }

  private admit(link: Link, m: Extract<C2S, { t: 'hello' }>): Player | null {
    if (m.v !== PROTOCOL_VERSION) {
      link.send({ t: 'bye', reason: 'This phone page is out of date. Refresh it and try again.' } satisfies S2C);
      setTimeout(() => link.close(), 300);
      return null;
    }
    let p = this.players.find((x) => x.token === m.token) ?? null;
    if (p) {
      const old = p.link;
      p.link = link;
      p.connected = true;
      p.lastSeen = now();
      if (old && old !== link) {
        old.send({ t: 'bye', reason: 'You joined again from another tab or device.' } satisfies S2C);
        setTimeout(() => old.close(), 200);
      }
      if (p.goneSince) this.hud.toast(`<b style="color:${p.color}">${p.name}</b> is back!`);
      p.goneSince = 0;
      this.mode.onJoin(p);
    } else {
      // late joiners during a turn-based game still get in (they're added next round)
      if (this.players.filter((x) => x.connected || this.phase !== 'lobby').length >= MAX_PLAYERS) {
        link.send({ t: 'full' } satisfies S2C);
        setTimeout(() => link.close(), 300);
        return null;
      }
      const used = new Set(this.players.map((x) => x.seat));
      let seat = 0;
      while (used.has(seat)) seat++;
      const col = PLAYER_COLORS[seat % PLAYER_COLORS.length];
      p = {
        id: this.nextId++,
        token: m.token,
        name: cleanName(m.name),
        color: col.hex,
        colorName: col.name,
        seat,
        link,
        connected: true,
        lastSeen: now(),
        score: 0,
        aim: { x: 0, y: 0 },
        aimShown: { x: 0, y: 0 },
        aimT: 0,
        lastThrow: 0,
        lastView: '',
        delta: 0,
        deltaT: 0,
        goneSince: 0,
      };
      this.players.push(p);
      this.hud.toast(`<b style="color:${p.color}">${p.name}</b> joined!`);
      this.sfx.join();
      this.mode.onJoin(p);
    }
    // de-duplicate names
    const base = cleanName(m.name);
    let name = base, n = 2;
    while (this.players.some((x) => x !== p && x.name === name)) name = `${base.slice(0, 11)} ${n++}`;
    p.name = name;
    p.lastView = '';
    this.send(p, { t: 'welcome', id: p.id, color: p.color, colorName: p.colorName, name: p.name });
    this.pushViews();
    return p;
  }

  private dropPlayer(p: Player) {
    if (!p.connected) return;
    p.connected = false;
    p.link = null;
    p.goneSince = now();
    this.hud.toast(`<b style="color:${p.color}">${p.name}</b> disconnected`, '#ffb3bd');
    this.mode.onLeave(p);
    this.pushViews();
  }

  private send(p: Player, m: S2C) {
    p.link?.send(m);
  }

  private onMessage(p: Player, m: C2S) {
    switch (m.t) {
      case 'ping':
        this.send(p, { t: 'pong', ts: m.ts });
        break;
      case 'aim':
        p.aim = { x: clamp(+m.x || 0, -1.25, 1.25), y: clamp(+m.y || 0, -1.25, 1.25) };
        p.aimT = now();
        break;
      case 'throw':
        this.throwFor(p, +m.x || 0, +m.y || 0, clamp(+m.p || 0, 0, 1));
        break;
      case 'grab':
        if (!this.paused) this.mode.onGrab(p, clamp(+m.x || 0, -1.1, 1.1), clamp(+m.y || 0, -1.1, 1.1));
        break;
      case 'pull':
        if (!this.paused) this.mode.onPull(p, clamp(+m.d || 0, -1.5, 1.5), clamp(+m.s || 0, -1, 1));
        break;
      case 'release':
        this.mode.onRelease(p);
        break;
      case 'name':
        p.name = cleanName(m.name);
        this.pushViews();
        break;
      case 'host':
        if (p === this.host()) this.hostAction(m);
        break;
    }
  }

  private hostAction(m: Extract<C2S, { t: 'host' }>) {
    switch (m.a) {
      case 'mode':
        if (this.phase === 'lobby' && MODES.some((x) => x.id === m.mode)) {
          this.selMode = m.mode;
          this.lobbyFocus = `mode${MODES.findIndex((x) => x.id === m.mode)}` as LobbyFocus;
          this.sfx.blip(true);
        }
        break;
      case 'rounds':
        if (this.phase === 'lobby') {
          this.rounds = clamp(Math.round(m.n), 1, 8);
          this.sfx.blip(true);
        }
        break;
      case 'start':
        if (this.phase === 'lobby') this.startGame();
        break;
      case 'again':
        if (this.phase === 'results') this.startGame();
        break;
      case 'lobby':
        if (this.phase !== 'lobby') this.enterLobby();
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
    }
    this.pushViews();
  }

  throwFor(p: Player, x: number, y: number, power: number) {
    if (this.paused || !this.mode.canThrow(p)) return;
    const t = now();
    if (t - p.lastThrow < this.mode.cooldown(p) * 0.85) return;
    p.lastThrow = t;
    const cx = clamp(x, -1.05, 1.05), cy = clamp(y, -1.05, 1.05);
    p.aim = { x: cx, y: cy };
    p.aimShown = { x: cx, y: cy };
    p.aimT = t;
    const ray = this.renderer.ray(cx, cy);
    const hit = this.sim.raycast(ray.origin, ray.dir, 150);
    const target = hit ? hit.point : { x: ray.origin.x + ray.dir.x * 40, y: ray.origin.y + ray.dir.y * 40, z: ray.origin.z + ray.dir.z * 40 };
    const seats = this.players.filter((x) => x.connected).sort((a, b) => a.seat - b.seat);
    const from = this.renderer.throwOrigin(Math.max(0, seats.indexOf(p)), seats.length);
    this.sim.throwBall(p.id, from, target, power);
    this.stats.throws++;
    this.stats.last = { x: cx, y: cy, p: power };
    this.mode.onThrow(p);
    this.hud.pulseReticle(p.id);
    this.sfx.whoosh(power);
  }

  // ------------------------------------------------------------------ per-frame
  private frame(tMs: number) {
    const dt = Math.min(0.05, this.lastT ? (tMs - this.lastT) / 1000 : 1 / 60);
    this.lastT = tMs;
    const k = 1 - Math.exp(-dt * 22);
    for (const p of this.players) {
      p.aimShown.x += (p.aim.x - p.aimShown.x) * k;
      p.aimShown.y += (p.aim.y - p.aimShown.y) * k;
    }
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 3) {
        this.sim.step();
        this.acc -= 1 / 60;
        n++;
      }
      if (n === 3) this.acc = 0;
      this.handleEvents();
      if (this.phase !== 'results' && !this.mode.finished) this.mode.update(dt);
      if (this.phase === 'lobby') this.renderer.orbit = Math.sin(tMs / 9000) * 0.22;
    }
    this.handleEvents();
    this.renderer.sync(this.sim, (id) => this.byId(id)?.color ?? '#ffffff');
    this.renderer.render(dt);
    this.updateUi(dt);
  }

  private handleEvents() {
    const evs = this.sim.events;
    if (!evs.length) return;
    this.sim.events = [];
    for (const ev of evs) this.onSimEvent(ev);
  }

  private onSimEvent(ev: SimEvent) {
    const fx = this.renderer.fx;
    switch (ev.e) {
      case 'hit': {
        if (ev.a.kind === 'ball' || ev.b?.kind === 'ball') this.stats.ballHits++;
        const mat = ev.a.kind === 'ball' || ev.b?.kind === 'ball' ? 'ball' : (ev.a.type as string);
        this.sfx.hit(ev.speed, mat);
        if (!ev.b && ev.speed > 7 && ev.a.kind === 'block') fx.dust(ev.pos, ev.speed / 4);
        break;
      }
      case 'score': {
        this.stats.scored++;
        const res = this.mode.onScore(ev);
        if (!res) break;
        if (res.player && res.points) this.award(res.player, res.points, ev.pos);
        else if (ev.points) {
          const sc = this.renderer.project(ev.pos);
          this.hud.popup(sc.x, sc.y, `${ev.points > 0 ? '+' : ''}${ev.points}`, res.player?.color ?? '#e8e8f0', 0.85);
        }
        if (ev.points >= 5 || ev.points < 0) this.sfx.score(ev.points);
        fx.sparkle(ev.pos, res.player?.color ?? '#ffffff', ev.points >= 10 ? 18 : 6, 4);
        break;
      }
      case 'boom':
        this.stats.booms++;
        fx.explosion(ev.pos, ev.radius, ev.kind);
        this.sfx.boom(ev.kind === 'bomb');
        if (ev.owner >= 0) {
          const p = this.byId(ev.owner);
          if (p) this.buzz(p, [80, 30, 120]);
        }
        break;
      case 'vanish':
        fx.sparkle(ev.pos, '#c9b6ff', 18, 5);
        fx.poof(ev.pos, '#ffffff', 6);
        this.sfx.pop();
        break;
      case 'throw':
      case 'remove':
        break;
    }
  }

  private chips(): ChipInfo[] {
    const h = this.host();
    const active = this.phase === 'playing' ? this.mode.activeId() : null;
    const t = now();
    return [...this.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        host: p === h,
        connected: p.connected,
        active: p.id === active,
        delta: t - p.deltaT < 1.6 ? p.delta : 0,
      }));
  }

  private updateUi(dt: number) {
    // reticles
    const W = window.innerWidth, H = window.innerHeight;
    const t = now();
    this.hud.reticles(
      this.players.map((p) => ({
        id: p.id,
        x: (clamp(p.aimShown.x, -1.05, 1.05) * 0.5 + 0.5) * W,
        y: (-clamp(p.aimShown.y, -1.05, 1.05) * 0.5 + 0.5) * H,
        color: p.color,
        name: p.name,
        visible: p.connected && !this.paused && this.phase !== 'results' && this.mode.reticleVisible(p) && t - p.aimT < 20,
        dim: t - p.aimT > 3,
      })),
    );
    // scoreboard + hud text (cheap diffing inside)
    this.hud.renderPlayers(this.chips(), this.phase === 'lobby');
    if (this.phase === 'playing') {
      const h = this.mode.hud();
      this.hud.setHud(true, h.left, h.center, h.sub ?? '', !!h.showJoin);
      this.hud.setTimerUrgent(!!h.urgent);
    }
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.refreshTools();
      if (this.phase === 'lobby') {
        const connected = this.players.filter((p) => p.connected).length;
        this.hud.renderLobby(this.selMode, this.rounds, this.lobbyFocus, this.host()?.name ?? null, connected);
      }
      // stale players: phones that stopped pinging
      for (const p of this.players) {
        if (p.connected && !p.local && t - p.lastSeen > 9) {
          const l = p.link;
          this.dropPlayer(p);
          l?.close();
        }
      }
      if (this.phase === 'lobby') {
        const before = this.players.length;
        this.players = this.players.filter((p) => p.connected || t - p.goneSince < 30);
        if (before !== this.players.length) this.pushViews();
      }
      if (this.phase === 'playing' && !this.players.some((p) => p.connected)) {
        // everyone left: go back to the lobby after a grace period
        if (this.players.every((p) => t - p.goneSince > 45)) this.enterLobby();
      }
      if (this.debug) this.hud.setDebug(`${this.renderer.fps.toFixed(0)} fps · scale ${this.renderer.renderScale.toFixed(2)} · bodies ${this.sim.ents.length}`);
    }
    this.viewTimer -= dt;
    if (this.viewTimer <= 0) {
      this.viewTimer = 0.5;
      this.sendViews();
    }
  }

  private sendViews() {
    const h = this.host();
    const ranks = this.phase === 'results' ? this.lastRanks : null;
    for (const p of this.players) {
      if (!p.link) continue;
      let part;
      if (this.paused) part = { screen: 'paused' as const, control: 'none' as const, title: 'Paused', sub: p === h ? '' : `${h?.name ?? 'The host'} paused the game` };
      else if (this.phase === 'results') {
        const r = ranks?.get(p.id) ?? 0;
        part = {
          screen: 'results' as const,
          control: 'none' as const,
          title: r === 0 ? 'Game over' : r === 1 ? '🏆 You win!' : `#${r} place`,
          sub: r === 0 ? "You joined after this game. You're in the next one!" : `${p.score} points`,
        };
      } else part = this.mode.view(p);
      const v: PadView = {
        ammo: null,
        ...part,
        host: p === h,
        mode: this.selMode,
        rounds: this.rounds,
        score: p.score,
        rank: ranks?.get(p.id),
        cooldown: this.mode.cooldown(p),
      };
      const json = JSON.stringify(v);
      if (json !== p.lastView) {
        p.lastView = json;
        this.send(p, { t: 'view', v });
      }
    }
  }

  // ------------------------------------------------------------------ TV remote / keyboard
  private onKey(e: KeyboardEvent) {
    this.sfx.unlock();
    const k = e.key;
    if (k === 'GoBack' || k === 'BrowserBack') return; // handled by the Android app via __tvBack
    const up = k === 'ArrowUp', down = k === 'ArrowDown', left = k === 'ArrowLeft', right = k === 'ArrowRight';
    const ok = k === 'Enter' || k === ' ' || e.keyCode === 23;
    const esc = k === 'Escape' || k === 'Backspace' || e.keyCode === 461 || e.keyCode === 10009;
    if (k === 'm' || k === 'M') {
      this.sfx.setMuted(!this.sfx.muted);
      this.hud.toast(this.sfx.muted ? 'Sound off' : 'Sound on');
      this.refreshTools();
      return;
    }
    if (k === 'f' || k === 'F') {
      this.toggleFullscreen();
      return;
    }
    if (k === 'F2' || k === '`') {
      this.debug = !this.debug;
      document.getElementById('debug')!.classList.toggle('hidden', !this.debug);
      return;
    }
    if ((k === 'k' || k === 'K') && this.phase === 'lobby') {
      this.addLocalPlayer();
      return;
    }
    if (up || down || left || right || ok || esc) e.preventDefault();
    if (esc) this.lastKeyBack = now();

    if (this.paused) {
      if (up || down) {
        this.pauseFocus = 1 - this.pauseFocus;
        this.hud.showPause(true, this.pauseFocus);
        this.sfx.blip(up);
      } else if (ok) {
        if (this.pauseFocus === 0) this.resume();
        else this.enterLobby();
      } else if (esc) this.resume();
      return;
    }
    if (this.phase === 'lobby') {
      let i = LOBBY_FOCUS.indexOf(this.lobbyFocus);
      if (up) i = Math.max(0, i - 1);
      if (down) i = Math.min(LOBBY_FOCUS.length - 1, i + 1);
      if (up || down) {
        this.lobbyFocus = LOBBY_FOCUS[i];
        this.sfx.blip(up);
      }
      if (this.lobbyFocus === 'rounds' && (left || right)) {
        this.rounds = clamp(this.rounds + (right ? 1 : -1), 1, 8);
        this.sfx.blip(right);
        this.pushViews();
      } else if ((left || right) && this.lobbyFocus.startsWith('mode')) {
        const j = clamp(Number(this.lobbyFocus.slice(4)) + (right ? 1 : -1), 0, 2);
        this.lobbyFocus = `mode${j}` as LobbyFocus;
        this.selMode = MODES[j].id;
        this.sfx.blip(right);
        this.pushViews();
      }
      if (ok) {
        if (this.lobbyFocus.startsWith('mode')) {
          this.selMode = MODES[Number(this.lobbyFocus.slice(4))].id;
          this.lobbyFocus = 'start';
          this.sfx.blip(true);
          this.pushViews();
        } else if (this.lobbyFocus === 'start') this.startGame();
      }
      this.uiTimer = 0;
      return;
    }
    if (this.phase === 'results') {
      if (up || down || left || right) {
        this.resultsFocus = 1 - this.resultsFocus;
        this.hud.showResults(this.ranked(), document.querySelector('#results .resTitle')?.innerHTML ?? '', this.resultsFocus, this.host()?.name ?? null);
        this.sfx.blip(true);
      } else if (ok) {
        if (this.resultsFocus === 0) this.startGame();
        else this.enterLobby();
      } else if (esc) this.enterLobby();
      return;
    }
    if (this.phase === 'playing' && esc) this.pause();
  }

  // ------------------------------------------------------------------ mouse player (for playing/testing on a PC)
  private addLocalPlayer() {
    if (this.players.some((p) => p.local)) return;
    const used = new Set(this.players.map((x) => x.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const col = PLAYER_COLORS[seat % PLAYER_COLORS.length];
    this.players.push({
      id: this.nextId++, token: 'local', name: 'Mouse', color: col.hex, colorName: col.name, seat, link: null, connected: true, lastSeen: Infinity,
      score: 0, aim: { x: 0, y: 0 }, aimShown: { x: 0, y: 0 }, aimT: now(), lastThrow: 0, local: true, lastView: '', delta: 0, deltaT: 0, goneSince: 0,
    });
    this.hud.toast('Mouse player added: move to aim, hold & release to throw (hold + drag down to pull in Tower Pull)');
  }

  private setupMouse() {
    const mp = () => this.players.find((p) => p.local);
    const toNdc = (e: MouseEvent) => ({ x: (e.clientX / window.innerWidth) * 2 - 1, y: -((e.clientY / window.innerHeight) * 2 - 1) });
    window.addEventListener('pointerdown', () => this.sfx.unlock());
    window.addEventListener('mousemove', (e) => {
      const p = mp();
      if (!p) return;
      const n = toNdc(e);
      if (this.mouse.down && this.mode instanceof PullMode) {
        this.mode.onPull(p, (e.clientY - this.mouse.dragY) / (window.innerHeight * 0.25), 0);
        return;
      }
      p.aim = n;
      p.aimT = now();
    });
    window.addEventListener('mousedown', (e) => {
      const p = mp();
      if (!p || e.button !== 0 || (e.target as HTMLElement).closest?.('[data-act]')) return;
      this.mouse = { down: true, x: e.clientX, y: e.clientY, t0: now(), dragY: e.clientY };
      if (this.mode instanceof PullMode) this.mode.onGrab(p, p.aim.x, p.aim.y);
    });
    window.addEventListener('mouseup', (e) => {
      const p = mp();
      if (!p || !this.mouse.down || e.button !== 0) return;
      this.mouse.down = false;
      if (this.mode instanceof PullMode) {
        this.mode.onRelease(p);
        return;
      }
      const held = now() - this.mouse.t0;
      const ph = (held / 1.2) % 2;
      this.throwFor(p, p.aim.x, p.aim.y, 0.15 + 0.85 * (ph < 1 ? ph : 2 - ph));
    });
  }
}

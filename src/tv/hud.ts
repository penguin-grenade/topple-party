// DOM overlay for the TV: lobby, scores, banners, reticles, results, pause.

import { MODES, type ModeId } from '../shared/protocol';
import { qrCanvas } from '../shared/qr';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ChipInfo {
  id: number;
  name: string;
  color: string;
  score: number;
  host: boolean;
  connected: boolean;
  active?: boolean;
  delta?: number;
}

export interface ReticleInfo {
  id: number;
  x: number;
  y: number;
  color: string;
  name: string;
  visible: boolean;
  dim?: boolean;
}

export type LobbyFocus = 'mode0' | 'mode1' | 'mode2' | 'rounds' | 'start';
export const LOBBY_FOCUS: LobbyFocus[] = ['mode0', 'mode1', 'mode2', 'rounds', 'start'];

export class Hud {
  private reticleEls = new Map<number, HTMLElement>();
  private toastTimer = 0;
  private bannerTimer = 0;

  setJoin(url: string, displayUrl: string, code: string) {
    const holder = $('qr');
    holder.innerHTML = '';
    holder.appendChild(qrCanvas(url, 420));
    const mini = $('miniQr');
    mini.innerHTML = '';
    mini.appendChild(qrCanvas(url, 160));
    $('joinUrl').textContent = displayUrl;
    $('roomCode').textContent = code;
    $('miniCode').textContent = code;
  }

  setNetStatus(text: string, kind: 'ok' | 'warn' | 'err' | 'busy') {
    const el = $('netStatus');
    el.textContent = text;
    el.dataset.kind = kind;
  }

  showLobby(on: boolean) {
    $('lobby').classList.toggle('hidden', !on);
    document.body.classList.toggle('in-lobby', on);
  }

  renderLobby(mode: ModeId, rounds: number, focus: LobbyFocus, hostName: string | null, playerCount: number) {
    const modes = $('modes');
    modes.innerHTML = MODES.map(
      (m, i) => `<div class="modeCard ${m.id === mode ? 'sel' : ''} ${focus === `mode${i}` ? 'focus' : ''}">
        <div class="mName">${m.name}</div><div class="mTag">${esc(m.tagline)}</div>
        <div class="mBadge">${m.turns ? 'Take turns' : 'All at once'}</div></div>`,
    ).join('');
    const label = MODES.find((m) => m.id === mode)!.roundsLabel;
    const rr = $('roundsRow');
    rr.innerHTML = `<span class="arrow">◀</span><b>${rounds}</b> ${label}<span class="arrow">▶</span>`;
    rr.classList.toggle('focus', focus === 'rounds');
    const sb = $('startBtn');
    sb.classList.toggle('focus', focus === 'start');
    sb.classList.toggle('disabled', playerCount === 0);
    $('hostHint').innerHTML =
      playerCount === 0
        ? 'Waiting for players to join…'
        : hostName
          ? `<b>${esc(hostName)}</b> is the host and can pick on their phone — or use the TV remote.`
          : 'Use the TV remote to pick a mode.';
  }

  renderPlayers(chips: ChipInfo[], lobby: boolean) {
    const el = $('players');
    const slots = lobby ? Math.max(chips.length, Math.min(8, Math.max(4, chips.length + 1))) : chips.length;
    let html = '';
    for (let i = 0; i < slots; i++) {
      const c = chips[i];
      if (!c) {
        html += `<div class="chip empty"><div class="dot">+</div><div class="cName">Join!</div></div>`;
        continue;
      }
      html += `<div class="chip ${c.connected ? '' : 'away'} ${c.active ? 'active' : ''}" style="--c:${c.color}">
        <div class="dot">${esc(c.name.slice(0, 1).toUpperCase())}${c.host ? '<span class="crown">♛</span>' : ''}</div>
        <div class="cName">${esc(c.name)}</div>
        ${lobby ? '' : `<div class="cScore">${c.score}</div>`}
        ${c.delta ? `<div class="cDelta ${c.delta < 0 ? 'neg' : ''}">${c.delta > 0 ? '+' : ''}${c.delta}</div>` : ''}
      </div>`;
    }
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
    el.classList.toggle('lobby', lobby);
  }

  bumpChip(index: number) {
    const chip = $('players').children[index] as HTMLElement | undefined;
    if (!chip) return;
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }

  setHud(on: boolean, left = '', center = '', centerSub = '', showJoin = false) {
    $('hud').classList.toggle('hidden', !on);
    $('hudLeft').innerHTML = left;
    const c = $('hudCenter');
    const html = `<div class="hc1">${center}</div>${centerSub ? `<div class="hc2">${centerSub}</div>` : ''}`;
    if (c.dataset.html !== html) {
      c.innerHTML = html;
      c.dataset.html = html;
    }
    $('miniJoin').classList.toggle('hidden', !showJoin);
  }

  setTimerUrgent(on: boolean) {
    $('hudCenter').classList.toggle('urgent', on);
  }

  banner(big: string, small = '', color = '#ffffff', ms = 2200) {
    const b = $('banner');
    b.innerHTML = `<div class="bBig" style="--c:${color}">${big}</div>${small ? `<div class="bSmall">${small}</div>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), ms);
  }
  hideBanner() {
    $('banner').classList.remove('show');
  }

  popup(x: number, y: number, text: string, color: string, size = 1) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--c', color);
    el.style.setProperty('--s', String(size));
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  reticles(list: ReticleInfo[]) {
    const root = $('reticles');
    const seen = new Set<number>();
    for (const r of list) {
      seen.add(r.id);
      let el = this.reticleEls.get(r.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'reticle';
        el.innerHTML = `<div class="ring"></div><div class="rdot"></div><div class="rname"></div>`;
        root.appendChild(el);
        this.reticleEls.set(r.id, el);
      }
      el.style.setProperty('--c', r.color);
      (el.querySelector('.rname') as HTMLElement).textContent = r.name;
      el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      el.classList.toggle('hidden', !r.visible);
      el.classList.toggle('dim', !!r.dim);
    }
    for (const [id, el] of this.reticleEls) {
      if (!seen.has(id)) {
        el.remove();
        this.reticleEls.delete(id);
      }
    }
  }

  pulseReticle(id: number) {
    const el = this.reticleEls.get(id);
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  showResults(rows: { name: string; color: string; score: number; rank: number }[], title: string, focus: number, hostName: string | null) {
    const el = $('results');
    el.classList.remove('hidden');
    const podium = rows
      .slice(0, 3)
      .map(
        (r) => `<div class="pod p${Math.min(3, r.rank)}" style="--c:${r.color}"><div class="pAvatar">${esc(r.name.slice(0, 1).toUpperCase())}</div>
        <div class="pName">${esc(r.name)}</div><div class="pScore">${r.score} pts</div><div class="pStep">${r.rank}</div></div>`,
      );
    // order podium 2-1-3
    const ordered = [podium[1] ?? '', podium[0] ?? '', podium[2] ?? ''].join('');
    const rest = rows
      .slice(3)
      .map((r) => `<div class="restRow" style="--c:${r.color}"><span>${r.rank}.</span><b>${esc(r.name)}</b><i>${r.score} pts</i></div>`)
      .join('');
    el.innerHTML = `<div class="resTitle">${title}</div><div class="podium">${ordered}</div><div class="rest">${rest}</div>
      <div class="resBtns"><div class="btn ${focus === 0 ? 'focus' : ''}">Play again</div><div class="btn ${focus === 1 ? 'focus' : ''}">Back to lobby</div></div>
      <div class="resHint">${hostName ? `${esc(hostName)} (host) can choose on their phone.` : ''}</div>`;
  }
  hideResults() {
    $('results').classList.add('hidden');
  }

  showPause(on: boolean, focus = 0) {
    const el = $('pause');
    el.classList.toggle('hidden', !on);
    if (on)
      el.innerHTML = `<div class="pTitle">Paused</div><div class="resBtns col"><div class="btn ${focus === 0 ? 'focus' : ''}">Resume</div>
      <div class="btn ${focus === 1 ? 'focus' : ''}">Quit to lobby</div></div>`;
  }

  toast(text: string, color = '#ffffff') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--c', color);
    t.innerHTML = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
    clearTimeout(this.toastTimer);
  }

  confetti(colors: string[]) {
    const root = $('popups');
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 0.8}s`;
      c.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 20}vw`);
      root.appendChild(c);
      setTimeout(() => c.remove(), 4800);
    }
  }

  setDebug(text: string) {
    const d = $('debug');
    d.textContent = text;
  }
}

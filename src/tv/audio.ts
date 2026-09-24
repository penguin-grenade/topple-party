// Tiny synthesized sound kit (no audio files needed).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private hitBudget = 0;
  private lastHitT = 0;
  muted = false;
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  musicOn = true;

  /** Call on any user gesture / key press; also tries immediately (works in the TV app). */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  private noise(t: number, dur: number, filter: BiquadFilterType, f0: number, f1: number, vol: number, q = 1) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number, attack = 0.005) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Block clack. speed = impact speed in m/s. */
  hit(speed: number, material: string) {
    if (!this.ready) return;
    const now = this.ctx!.currentTime;
    // limit the rate so a collapsing tower doesn't turn into white noise
    this.hitBudget = Math.min(10, this.hitBudget + (now - this.lastHitT) * 25);
    this.lastHitT = now;
    if (this.hitBudget < 1) return;
    this.hitBudget -= 1;
    const v = Math.min(1, speed / 12);
    const vol = 0.05 + v * 0.35;
    const t = now + Math.random() * 0.01;
    if (material === 'stone') {
      this.noise(t, 0.09, 'bandpass', 900, 400, vol * 1.2, 1.5);
      this.tone(t, 0.08, 'sine', 180, 120, vol * 0.5);
    } else if (material === 'ball') {
      this.tone(t, 0.12, 'sine', 140, 70, vol * 0.9);
      this.noise(t, 0.05, 'lowpass', 1800, 400, vol * 0.5);
    } else if (material === 'ice' || material === 'gem' || material === 'silver' || material === 'gold') {
      const f = 1400 + Math.random() * 900;
      this.tone(t, 0.18, 'triangle', f, f * 0.98, vol * 0.35);
      this.noise(t, 0.04, 'highpass', 3000, 2000, vol * 0.4);
    } else {
      const f = 520 + Math.random() * 380;
      this.tone(t, 0.07, 'triangle', f, f * 0.7, vol * 0.45);
      this.noise(t, 0.06, 'bandpass', 1600, 700, vol * 0.8, 2);
    }
  }

  boom(big = true) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noise(t, big ? 1.1 : 0.8, 'lowpass', 2400, 90, big ? 0.9 : 0.6, 0.7);
    this.tone(t, 0.6, 'sine', 110, 38, big ? 0.9 : 0.6, 0.002);
    this.noise(t, 0.12, 'highpass', 4000, 1500, 0.3);
  }

  whoosh(power: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.35, 'bandpass', 500, 2600 + power * 2000, 0.12 + power * 0.18, 3);
  }

  score(points: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    if (points < 0) {
      this.tone(t, 0.25, 'sawtooth', 300, 150, 0.12);
      this.tone(t + 0.12, 0.3, 'sawtooth', 220, 110, 0.12);
      return;
    }
    const base = points >= 25 ? 880 : points >= 10 ? 740 : points >= 5 ? 660 : 587;
    const notes = points >= 10 ? [1, 1.26, 1.5, 2] : points >= 5 ? [1, 1.5] : [1];
    notes.forEach((m, i) => this.tone(t + i * 0.06, 0.22, 'triangle', base * m, base * m, points >= 5 ? 0.16 : 0.08));
  }

  pop() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.12, 'sine', 500, 1400, 0.25);
    this.noise(t, 0.08, 'highpass', 2500, 5000, 0.12);
  }

  blip(up = true) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.08, 'square', up ? 660 : 440, up ? 880 : 330, 0.06);
  }

  join() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.07, 0.18, 'triangle', f, f, 0.14));
  }

  countdown(final = false) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, final ? 0.5 : 0.15, 'square', final ? 988 : 660, final ? 988 : 660, 0.1);
  }

  fanfare() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const seq = [523, 659, 784, 1047, 784, 1047];
    seq.forEach((f, i) => this.tone(t + i * 0.11, i === seq.length - 1 ? 0.6 : 0.16, 'triangle', f, f, 0.16));
    seq.forEach((f, i) => this.tone(t + i * 0.11, 0.14, 'square', f / 2, f / 2, 0.04));
  }

  sad() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [392, 370, 349, 262].forEach((f, i) => this.tone(t + i * 0.22, i === 3 ? 0.7 : 0.22, 'triangle', f, f * (i === 3 ? 0.97 : 1), 0.14));
  }

  creak() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.25, 'sawtooth', 90 + Math.random() * 40, 70, 0.03, 0.05);
  }

  // ---- light background music: a bouncy 16-step loop ----
  startMusic() {
    if (!this.ctx || this.musicGain || !this.musicOn) return;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.05;
    this.musicGain.connect(this.master);
    const bpm = 112;
    const stepDur = 60 / bpm / 2;
    let next = this.ctx.currentTime + 0.1;
    const chords = [
      [261.6, 329.6, 392.0],
      [220.0, 261.6, 329.6],
      [174.6, 220.0, 261.6],
      [196.0, 246.9, 293.7],
    ];
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      while (next < this.ctx.currentTime + 0.3) {
        const s = this.musicStep++;
        const chord = chords[Math.floor(s / 8) % 4];
        const g = this.musicGain;
        const note = (f: number, dur: number, type: OscillatorType, vol: number) => {
          const o = this.ctx!.createOscillator();
          o.type = type;
          o.frequency.value = f;
          const e = this.ctx!.createGain();
          e.gain.setValueAtTime(0.0001, next);
          e.gain.exponentialRampToValueAtTime(vol, next + 0.01);
          e.gain.exponentialRampToValueAtTime(0.0001, next + dur);
          o.connect(e).connect(g);
          o.start(next);
          o.stop(next + dur + 0.05);
        };
        if (s % 2 === 0) note(chord[0] / 2, stepDur * 1.6, 'triangle', 0.9);
        if (s % 4 === 2) note(chord[1], stepDur * 0.8, 'square', 0.18);
        if (s % 8 === 3 || s % 8 === 6) note(chord[2] * 2, stepDur * 0.7, 'triangle', 0.35);
        if (s % 16 === 14) note(chord[1] * 2, stepDur * 0.7, 'triangle', 0.3);
        next += stepDur;
      }
      this.musicTimer = window.setTimeout(tick, 120);
    };
    tick();
  }

  stopMusic() {
    clearTimeout(this.musicTimer);
    if (this.musicGain) {
      const g = this.musicGain;
      g.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.2);
      setTimeout(() => g.disconnect(), 800);
      this.musicGain = null;
    }
  }
}

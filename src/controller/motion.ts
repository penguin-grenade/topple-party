// Turns the phone's orientation + motion sensors into a Wii-remote style pointer and "flick to throw".
//
// Pointer: we take the phone's top edge (or back, if held upright like a camera) as the pointing
// direction, convert it to heading/elevation, and map the change since the last "re-center"
// to screen coordinates in [-1, 1].
// Throw: while the throw button is held, a spike in linear acceleration + rotation rate fires a
// throw. The peak of the spike sets the power. Aim is taken from just *before* the swing began,
// so the swing itself doesn't drag the aim point downward.

const DEG = Math.PI / 180;

class OneEuro {
  private x: number | undefined;
  private dx = 0;
  private t = 0;
  constructor(public minCutoff = 1.4, public beta = 0.5, public dCutoff = 1) {}
  reset() {
    this.x = undefined;
    this.dx = 0;
  }
  filter(v: number, tMs: number): number {
    if (this.x === undefined) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = Math.max(0.001, (tMs - this.t) / 1000);
    this.t = tMs;
    const ad = this.alpha(dt, this.dCutoff);
    this.dx += ad * ((v - this.x) / dt - this.dx);
    const a = this.alpha(dt, this.minCutoff + this.beta * Math.abs(this.dx));
    this.x += a * (v - this.x);
    return this.x;
  }
  private alpha(dt: number, cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
}

type Vec3 = { x: number; y: number; z: number };

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const FLICK_START = 13; // m/s^2-ish score where a swing begins
const FLICK_FULL = 45; // score for a full-power throw

export class MotionInput {
  orientationSeen = false;
  motionSeen = false;
  permission: 'unknown' | 'granted' | 'denied' = 'unknown';

  /** filtered pointer in [-1.25, 1.25], y up */
  x = 0;
  y = 0;
  /** raw heading/elevation (radians) of the pointing axis, relative to the re-center pose */
  relYaw = 0;
  relPitch = 0;

  yawRange = 22 * DEG;
  pitchRange = 13 * DEG;

  private axis: 'top' | 'back' = 'top';
  private h0 = 0;
  private e0 = 0;
  private calibrated = false;
  private cur = { top: { h: 0, e: 0, z: 0 }, back: { h: 0, e: 0, z: 0 } };
  private fx = new OneEuro();
  private fy = new OneEuro();
  private hist: { t: number; x: number; y: number }[] = [];

  // throw detection
  armed = false;
  private swing: { t0: number; peak: number; x: number; y: number } | null = null;
  private grav: Vec3 = { x: 0, y: 0, z: 0 };
  lastScore = 0;
  onFlick: (x: number, y: number, power: number) => void = () => {};

  setSensitivity(mult: number) {
    this.yawRange = (22 * DEG) / mult;
    this.pitchRange = (13 * DEG) / mult;
  }

  /** Must be called synchronously from a user gesture (iOS permission prompt). */
  requestPermission(): Promise<boolean> {
    const DOE = (window as any).DeviceOrientationEvent;
    const DME = (window as any).DeviceMotionEvent;
    const ps: Promise<unknown>[] = [];
    if (DOE && typeof DOE.requestPermission === 'function') ps.push(DOE.requestPermission());
    if (DME && typeof DME.requestPermission === 'function') ps.push(DME.requestPermission());
    if (!ps.length) {
      this.permission = 'granted';
      this.attach();
      return Promise.resolve(true);
    }
    return Promise.all(ps)
      .then((r) => {
        const ok = r.every((x) => x === 'granted');
        this.permission = ok ? 'granted' : 'denied';
        if (ok) this.attach();
        return ok;
      })
      .catch(() => {
        this.permission = 'denied';
        return false;
      });
  }

  private attached = false;
  private attach() {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('deviceorientation', this.onOrient);
    window.addEventListener('devicemotion', this.onMotion);
  }

  recenter() {
    const t = this.cur.top, b = this.cur.back;
    // Use whichever phone axis is closer to horizontal: top edge (remote grip) or back (camera grip).
    this.axis = Math.abs(t.z) <= Math.abs(b.z) ? 'top' : 'back';
    const c = this.cur[this.axis];
    this.h0 = c.h;
    this.e0 = c.e;
    this.calibrated = true;
    this.fx.reset();
    this.fy.reset();
    this.x = this.y = 0;
  }

  /** Aim sample from roughly `msAgo` milliseconds ago (falls back to latest). */
  aimAgo(msAgo: number): { x: number; y: number } {
    const target = performance.now() - msAgo;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].t <= target) return this.hist[i];
    return { x: this.x, y: this.y };
  }

  private onOrient = (ev: DeviceOrientationEvent) => {
    if (ev.alpha == null || ev.beta == null || ev.gamma == null) return;
    this.orientationSeen = true;
    const a = ev.alpha * DEG, b = ev.beta * DEG, g = ev.gamma * DEG;
    const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
    // Device axes in world frame for R = Rz(alpha) * Rx(beta) * Ry(gamma) (W3C convention: x east, y north, z up)
    const top: Vec3 = { x: -sa * cb, y: ca * cb, z: sb };
    const back: Vec3 = { x: -ca * sg - sa * sb * cg, y: -sa * sg + ca * sb * cg, z: -cb * cg };
    const he = (v: Vec3) => ({ h: Math.atan2(v.y, v.x), e: Math.asin(clamp(v.z, -1, 1)), z: v.z });
    this.cur.top = he(top);
    this.cur.back = he(back);
    if (!this.calibrated) this.recenter();
    const c = this.cur[this.axis];
    const now = performance.now();
    // near-vertical pointing makes heading meaningless: hold x steady
    if (Math.abs(c.z) < 0.93) this.relYaw = wrap(c.h - this.h0);
    this.relPitch = c.e - this.e0;
    const rawX = clamp(-this.relYaw / this.yawRange, -1.25, 1.25);
    const rawY = clamp(this.relPitch / this.pitchRange, -1.25, 1.25);
    this.x = this.fx.filter(rawX, now);
    this.y = this.fy.filter(rawY, now);
    this.hist.push({ t: now, x: this.x, y: this.y });
    if (this.hist.length > 40) this.hist.shift();
  };

  private onMotion = (ev: DeviceMotionEvent) => {
    let ax: number, ay: number, az: number;
    const a = ev.acceleration;
    if (a && a.x != null && a.y != null && a.z != null) {
      ax = a.x;
      ay = a.y;
      az = a.z;
    } else {
      const g = ev.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null || g.z == null) return;
      const k = 0.08;
      this.grav.x += (g.x - this.grav.x) * k;
      this.grav.y += (g.y - this.grav.y) * k;
      this.grav.z += (g.z - this.grav.z) * k;
      ax = g.x - this.grav.x;
      ay = g.y - this.grav.y;
      az = g.z - this.grav.z;
    }
    this.motionSeen = true;
    const rr = ev.rotationRate;
    const rot = rr ? Math.hypot(rr.alpha || 0, rr.beta || 0, rr.gamma || 0) : 0; // deg/s
    const s = Math.hypot(ax, ay, az) + rot * 0.012;
    this.lastScore = s;
    const now = performance.now();
    if (!this.armed) {
      this.swing = null;
      return;
    }
    if (!this.swing) {
      if (s > FLICK_START) {
        const aim = this.aimAgo(90);
        this.swing = { t0: now, peak: s, x: aim.x, y: aim.y };
      }
      return;
    }
    if (s > this.swing.peak) this.swing.peak = s;
    if (s < this.swing.peak * 0.55 || now - this.swing.t0 > 200) {
      const p = clamp((this.swing.peak - FLICK_START) / (FLICK_FULL - FLICK_START), 0, 1);
      const power = 0.15 + 0.85 * Math.pow(p, 0.7);
      const { x, y } = this.swing;
      this.swing = null;
      this.armed = false;
      this.onFlick(x, y, power);
    }
  };
}

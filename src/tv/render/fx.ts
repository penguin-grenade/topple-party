import * as THREE from 'three';
import type { V3 } from '../sim/sim';

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  grav: number; drag: number;
  rx: number; ry: number; spin: number;
  c0: THREE.Color; c1: THREE.Color;
}

type SpawnOpts = Partial<Omit<P, 'c0' | 'c1'>> & { x: number; y: number; z: number; c0: THREE.ColorRepresentation; c1?: THREE.ColorRepresentation };

class Pool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 0, grav: 0, drag: 0, rx: 0, ry: 0, spin: 0, c0: new THREE.Color(), c1: new THREE.Color() });
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.mesh.count = n;
  }

  spawn(o: SpawnOpts) {
    const p = this.ps[this.next];
    this.next = (this.next + 1) % this.ps.length;
    p.alive = true;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.max = o.max ?? 1;
    p.life = p.max;
    p.s0 = o.s0 ?? 0.3;
    p.s1 = o.s1 ?? 0;
    p.grav = o.grav ?? 0;
    p.drag = o.drag ?? 0;
    p.rx = Math.random() * 6; p.ry = Math.random() * 6;
    p.spin = o.spin ?? (Math.random() - 0.5) * 8;
    p.c0.set(o.c0);
    p.c1.set(o.c1 ?? o.c0);
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05 && p.grav > 0) {
        p.y = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
      const t = 1 - p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * t;
      this.q.setFromEuler(this.e.set(p.rx, p.ry, 0));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.sc.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
      this.col.copy(p.c0).lerp(p.c1, t);
      this.mesh.setColorAt(i, this.col);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

interface Flash {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  r: number;
}

export class Fx {
  readonly group = new THREE.Group();
  private puffs: Pool;
  private fire: Pool;
  private bits: Pool;
  private flashes: Flash[] = [];
  private light: THREE.PointLight;
  private lightLife = 0;
  shake = 0;

  constructor() {
    // soft round smoke/dust puffs (lit) + unlit fireballs + little sparks/chips
    const puffMat = new THREE.MeshStandardMaterial({ roughness: 1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.18 });
    this.puffs = new Pool(new THREE.IcosahedronGeometry(1, 2), puffMat, 220);
    const fireMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.fire = new Pool(new THREE.IcosahedronGeometry(1, 2), fireMat, 120);
    const bitMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.bits = new Pool(new THREE.BoxGeometry(1, 1, 1), bitMat, 420);
    this.group.add(this.puffs.mesh, this.fire.mesh, this.bits.mesh);
    this.light = new THREE.PointLight('#ffb347', 0, 18, 1.6);
    this.group.add(this.light);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshBasicMaterial({ color: '#fff4c2', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      m.visible = false;
      this.group.add(m);
      this.flashes.push({ mesh: m, life: 0, max: 1, r: 1 });
    }
  }

  explosion(p: V3, radius: number, kind: 'bomb' | 'chem') {
    const chem = kind === 'chem';
    const fl = this.flashes.find((f) => f.life <= 0) ?? this.flashes[0];
    fl.life = fl.max = 0.32;
    fl.r = radius * 0.85;
    fl.mesh.position.set(p.x, p.y, p.z);
    (fl.mesh.material as THREE.MeshBasicMaterial).color.set(chem ? '#d4ff9e' : '#fff1b8');
    fl.mesh.visible = true;
    this.light.position.set(p.x, p.y + 0.5, p.z);
    this.light.color.set(chem ? '#8cff5a' : '#ffae42');
    this.light.intensity = 60;
    this.lightLife = 0.35;
    const hot = chem ? ['#f4ff9a', '#9dff5a', '#4ce04a'] : ['#fff6a0', '#ffc247', '#ff7a2b'];
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, sp = 3 + Math.random() * 6;
      const r = Math.sqrt(1 - u * u);
      this.fire.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: Math.cos(a) * r * sp, vy: Math.abs(u) * sp + 2, vz: Math.sin(a) * r * sp,
        drag: 3.5, grav: -1.5, max: 0.45 + Math.random() * 0.4,
        s0: 0.6 + Math.random() * 0.5, s1: 0.05,
        c0: hot[i % 3], c1: chem ? '#2f8f3a' : '#d8401c',
      });
    }
    for (let i = 0; i < 8; i++) {
      this.puffs.spawn({
        x: p.x + (Math.random() - 0.5), y: p.y, z: p.z + (Math.random() - 0.5),
        vx: (Math.random() - 0.5) * 2.5, vy: 2.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 2.5,
        drag: 1.8, grav: -0.8, max: 1.1 + Math.random() * 0.5, s0: 0.9 + Math.random() * 0.3, s1: 0.05,
        c0: '#cfc9d9', c1: '#ffffff',
      });
    }
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, sp = 8 + Math.random() * 10;
      const r = Math.sqrt(1 - u * u);
      this.bits.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: Math.cos(a) * r * sp, vy: u * sp + 4, vz: Math.sin(a) * r * sp,
        grav: 18, drag: 0.8, max: 0.6 + Math.random() * 0.7, s0: 0.12 + Math.random() * 0.1, s1: 0.02,
        c0: chem ? '#f2ff9e' : '#fff6a8', c1: chem ? '#3cff5a' : '#ff5a1f',
      });
    }
    this.shake = Math.min(1, this.shake + (chem ? 0.45 : 0.7));
  }

  sparkle(p: V3, color: string, n = 14, speed = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.bits.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: Math.cos(a) * speed * Math.random(), vy: 2 + Math.random() * speed, vz: Math.sin(a) * speed * Math.random(),
        grav: 10, drag: 1, max: 0.6 + Math.random() * 0.5, s0: 0.14, s1: 0.02, c0: '#ffffff', c1: color,
      });
    }
  }

  poof(p: V3, color: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: Math.cos(a) * 2.5, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 2.5,
        drag: 2.5, max: 0.6 + Math.random() * 0.3, s0: 0.35, s1: 0.02, c0: color, c1: '#ffffff',
      });
    }
  }

  dust(p: V3, amount: number) {
    const n = Math.min(6, Math.ceil(amount));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn({
        x: p.x + Math.cos(a) * 0.4, y: Math.max(0.1, p.y - 0.4), z: p.z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * 1.5, vy: 0.6, vz: Math.sin(a) * 1.5,
        drag: 2, max: 0.7, s0: 0.25, s1: 0.5, c0: '#e7dccb', c1: '#f7f3ec',
      });
    }
  }

  update(dt: number) {
    this.puffs.update(dt);
    this.fire.update(dt);
    this.bits.update(dt);
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      f.mesh.scale.setScalar(0.3 + f.r * Math.sqrt(t));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      if (f.life <= 0) f.mesh.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = Math.max(0, this.lightLife / 0.35) * 60;
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }
}

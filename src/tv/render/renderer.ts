import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALL_R, ISLAND_R, type Entity, type Sim, type V3 } from '../sim/sim';
import type { CamSpec, PlinthSpec } from '../sim/levels';
import type { BlockType } from '../sim/blocks';
import { blockMaterial } from './textures';
import { Fx } from './fx';

const tmpV = new THREE.Vector3();

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.3, 500);
  readonly fx = new Fx();
  private sun: THREE.DirectionalLight;
  private meshes = new Map<Entity, THREE.Mesh>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private ballGeo = new THREE.SphereGeometry(BALL_R, 24, 16);
  private ballMats = new Map<string, THREE.Material>();
  private plinthGroup = new THREE.Group();
  private cloudGroups: THREE.Object3D[] = [];
  private plinthMat = new THREE.MeshStandardMaterial({ color: '#bcc6da', roughness: 0.85 });
  private trimMat = new THREE.MeshStandardMaterial({ color: '#fff1d0', roughness: 0.7 });

  // camera rig
  private camSpec: CamSpec = { pos: [0, 6, 16], look: [0, 3, 0] };
  private camPos = new THREE.Vector3(0, 12, 30);
  private camLook = new THREE.Vector3(0, 3, 0);
  orbit = 0;
  private orbitNow = 0;
  /** player camera control (Tower Pull): raise/lower the view and zoom */
  lift = 0;
  zoom = 1;
  private liftNow = 0;
  private zoomNow = 1;
  /** how quickly the camera follows its target (higher = snappier, for hands-on control) */
  camRate = 2.6;
  private trees: THREE.Mesh[] = [];
  sway = 1;
  private t = 0;

  // highlights (Tower Pull)
  private outline: THREE.Mesh;
  private outlineOf: Entity | null = null;
  private arrowRig = new THREE.Group();
  // drawn on top of everything so the arrow poking into the tower still shows
  private arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 });

  // adaptive resolution
  private baseRatio = 1;
  private scale = 1;
  private frameAvg = 16;
  private slowT = 0;
  private fastT = 0;
  lowQuality = false;
  private needResize = false;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    // TV hardware: Android TV app, Android boxes, and smart-TV browsers (Samsung Tizen, LG webOS, Fire TV, Sony, Panasonic, Sharp, Hisense/Vidaa, HbbTV...)
    const lowEnd = /TopplePartyTV|Android|SMART-?TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|AFT[A-Z]|CrKey|HbbTV|Viera|AQUOS|VIDAA|Roku/i.test(navigator.userAgent);
    this.lowQuality = lowEnd;

    // sky + fog
    this.scene.add(makeSky());
    this.scene.fog = new THREE.Fog('#d6e9ff', 70, 260);

    // lights
    this.scene.add(new THREE.HemisphereLight('#e4f2ff', '#8d6e57', 1.25));
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.7);
    this.sun.position.set(10, 24, 14);
    this.sun.target.position.set(0, 2, 0);
    this.sun.castShadow = true;
    const sz = lowEnd ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const sc = this.sun.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 4; sc.far = 70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const island = makeIsland();
    this.trees = island.userData.trees as THREE.Mesh[];
    this.scene.add(island);
    this.scene.add(this.plinthGroup);
    for (const g of makeClouds()) {
      this.cloudGroups.push(g);
      this.scene.add(g);
    }
    this.scene.add(this.fx.group);

    this.outline = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, toneMapped: false }));
    this.outline.visible = false;
    this.scene.add(this.outline);
    const cone = new THREE.ConeGeometry(0.3, 0.62, 16);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(cone, this.arrowMat);
      m.renderOrder = 10;
      this.arrowRig.add(m);
    }
    this.arrowRig.visible = false;
    this.scene.add(this.arrowRig);

    this.resize();
    window.addEventListener('resize', () => (this.needResize = true));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // never render more than ~1080 physical rows; TVs are big but their GPUs are small
    this.baseRatio = Math.min(window.devicePixelRatio || 1, 1080 / h, this.lowQuality ? 0.85 : 1.5);
    this.gl.setPixelRatio(this.baseRatio * this.scale);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPlinths(ps: PlinthSpec[]) {
    for (const c of [...this.plinthGroup.children]) {
      this.plinthGroup.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const p of ps) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.rotY;
      const body = new THREE.Mesh(new RoundedBoxGeometry(p.w, p.h, p.d, 2, 0.08), this.plinthMat);
      body.position.y = p.h / 2 - 0.02;
      body.castShadow = body.receiveShadow = true;
      const trim = new THREE.Mesh(new RoundedBoxGeometry(p.w + 0.16, 0.16, p.d + 0.16, 2, 0.06), this.trimMat);
      trim.position.y = p.h - 0.08;
      trim.receiveShadow = true;
      g.add(body, trim);
      this.plinthGroup.add(g);
    }
  }

  setCamera(spec: CamSpec, instant = false) {
    this.camSpec = spec;
    this.lift = 0;
    this.zoom = 1;
    if (instant) {
      this.camPos.set(...spec.pos);
      this.camLook.set(...spec.look);
      this.orbitNow = this.orbit;
      this.liftNow = 0;
      this.zoomNow = 1;
    }
  }

  /** Move the camera around the current level: yaw in radians, lift in world units, zoom as a factor delta. */
  nudgeCamera(dYaw: number, dLift: number, dZoom: number, limits = { liftMin: -4, liftMax: 4.5, zoomMin: 0.55, zoomMax: 1.25 }) {
    this.orbit += dYaw;
    this.lift = Math.max(limits.liftMin, Math.min(limits.liftMax, this.lift + dLift));
    this.zoom = Math.max(limits.zoomMin, Math.min(limits.zoomMax, this.zoom + dZoom));
  }

  private geoFor(sx: number, sy: number, sz: number): THREE.BufferGeometry {
    const key = `${sx.toFixed(3)}|${sy.toFixed(3)}|${sz.toFixed(3)}`;
    let g = this.geos.get(key);
    if (!g) {
      const r = Math.min(0.07, Math.min(sx, sy, sz) * 0.14);
      g = new RoundedBoxGeometry(sx, sy, sz, 2, r);
      this.geos.set(key, g);
    }
    return g;
  }

  private ballMat(color: string) {
    let m = this.ballMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(color), emissiveIntensity: 0.35 });
      this.ballMats.set(color, m);
    }
    return m;
  }

  /** Create/update/remove meshes to mirror the simulation. `colorOf` maps player id -> color. */
  sync(sim: Sim, colorOf: (player: number) => string) {
    for (const e of sim.ents) {
      if (this.meshes.has(e) || e.gone) continue;
      let m: THREE.Mesh;
      if (e.kind === 'ball') {
        m = new THREE.Mesh(this.ballGeo, this.ballMat(colorOf(e.playerId)));
        m.castShadow = true;
      } else {
        m = new THREE.Mesh(this.geoFor(e.size.x, e.size.y, e.size.z), blockMaterial(e.type as BlockType, this.gl.capabilities.getMaxAnisotropy()));
        m.castShadow = true;
        m.receiveShadow = true;
      }
      this.scene.add(m);
      this.meshes.set(e, m);
    }
    for (const [e, m] of this.meshes) {
      if (e.gone) {
        this.scene.remove(m);
        this.meshes.delete(e);
        if (this.outlineOf === e) this.setOutline(null);
        continue;
      }
      const t = e.body.translation();
      const r = e.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
      const left = e.dieAt - sim.time;
      m.scale.setScalar(left < 0.5 ? Math.max(0.01, left / 0.5) : 1);
    }
    if (this.outlineOf && !this.outlineOf.gone) {
      const m = this.meshes.get(this.outlineOf);
      if (m) {
        this.outline.position.copy(m.position);
        this.outline.quaternion.copy(m.quaternion);
        if (this.arrowRig.visible) {
          this.arrowRig.position.copy(m.position);
          this.arrowRig.quaternion.copy(m.quaternion);
          const pulse = 1 + Math.sin(performance.now() / 160) * 0.12;
          for (const a of this.arrowRig.children) a.scale.setScalar(pulse);
        }
      }
    }
  }

  /** Highlight a block. With `arrows`, also show which two ways it can slide (Tower Pull grab). */
  setOutline(e: Entity | null, color = '#ffffff', arrows = false) {
    this.outlineOf = e;
    this.outline.visible = !!e;
    this.arrowRig.visible = !!e && arrows;
    if (e) {
      this.outline.scale.set(e.size.x + 0.12, e.size.y + 0.12, e.size.z + 0.12);
      (this.outline.material as THREE.MeshBasicMaterial).color.set(color);
      if (arrows) {
        this.arrowMat.color.set(color);
        const alongX = e.size.x > e.size.z;
        const half = (alongX ? e.size.x : e.size.z) / 2 + 0.55;
        const [a, b] = this.arrowRig.children;
        a.position.set(alongX ? half : 0, 0, alongX ? 0 : half);
        b.position.set(alongX ? -half : 0, 0, alongX ? 0 : -half);
        // cones point up (+y) by default; tip them over to point out along the block
        a.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? -Math.PI / 2 : 0);
        b.rotation.set(alongX ? 0 : -Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      }
    }
  }

  /** World-space ray through normalized screen coords (x, y in [-1, 1], y up). */
  ray(nx: number, ny: number): { origin: V3; dir: V3 } {
    const o = this.camera.position.clone();
    const d = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera).sub(o).normalize();
    return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: d.x, y: d.y, z: d.z } };
  }

  /** Where a player's ball starts: below and in front of the camera, spread by seat. */
  throwOrigin(seat: number, seats: number): V3 {
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const spread = seats > 1 ? (seat / (seats - 1) - 0.5) * 3.2 : 0;
    const p = cam.position.clone().addScaledVector(fwd, 3.6).addScaledVector(right, spread).add(new THREE.Vector3(0, -1.3, 0));
    return { x: p.x, y: p.y, z: p.z };
  }

  /** World point -> CSS pixels. */
  project(p: V3): { x: number; y: number; behind: boolean } {
    tmpV.set(p.x, p.y, p.z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, behind: tmpV.z > 1 };
  }

  render(dt: number) {
    if (this.needResize) {
      // apply resolution changes right before drawing so the resized canvas is never shown blank
      this.needResize = false;
      this.resize();
    }
    this.t += dt;
    // camera easing
    const k = 1 - Math.exp(-dt * this.camRate);
    const k2 = 1 - Math.exp(-dt * this.camRate * 0.85);
    this.orbitNow += (this.orbit - this.orbitNow) * k2;
    this.liftNow += (this.lift - this.liftNow) * k2;
    this.zoomNow += (this.zoom - this.zoomNow) * k2;
    const look = new THREE.Vector3(...this.camSpec.look);
    const rel = new THREE.Vector3(...this.camSpec.pos).sub(look).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitNow).multiplyScalar(this.zoomNow);
    look.y += this.liftNow;
    const want = look.clone().add(rel);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    const sway = this.sway;
    const shake = this.fx.shake * this.fx.shake * 0.5;
    this.camera.position.set(
      this.camPos.x + Math.sin(this.t * 0.31) * 0.25 * sway + (Math.random() - 0.5) * shake,
      this.camPos.y + Math.sin(this.t * 0.23) * 0.12 * sway + (Math.random() - 0.5) * shake,
      this.camPos.z + (Math.random() - 0.5) * shake,
    );
    this.camera.lookAt(this.camLook);
    this.clearView(dt);

    for (let i = 0; i < this.cloudGroups.length; i++) this.cloudGroups[i].rotation.y += dt * (0.006 + i * 0.004);
    this.fx.update(dt);
    this.gl.render(this.scene, this.camera);
    this.adapt(dt * 1000);
  }

  /** Shrink trees that stand between the camera and what it's looking at (or right next to the camera). */
  private clearView(dt: number) {
    const cx = this.camera.position.x, cz = this.camera.position.z;
    const lx = this.camLook.x - cx, lz = this.camLook.z - cz;
    const len2 = lx * lx + lz * lz || 1;
    for (const t of this.trees) {
      const tx = t.position.x - cx, tz = t.position.z - cz;
      const along = (tx * lx + tz * lz) / len2; // 0 at camera, 1 at the look point
      const px = tx - lx * along, pz = tz - lz * along;
      const side = Math.hypot(px, pz);
      const blocking = (along > -0.05 && along < 0.95 && side < 3.2) || Math.hypot(tx, tz) < 3.5;
      const want = blocking ? 0.001 : 1;
      const s = t.scale.x + (want - t.scale.x) * (1 - Math.exp(-dt * 9));
      t.scale.setScalar(s);
      t.visible = s > 0.02;
    }
  }

  private adapt(ms: number) {
    this.frameAvg = this.frameAvg * 0.95 + ms * 0.05;
    if (this.frameAvg > 21) {
      this.slowT += ms;
      this.fastT = 0;
      if (this.slowT > 1500 && this.scale > 0.5) {
        this.scale = Math.max(0.5, this.scale - 0.1);
        this.slowT = 0;
        this.needResize = true;
      }
    } else if (this.frameAvg < 14.5) {
      this.fastT += ms;
      this.slowT = 0;
      if (this.fastT > 5000 && this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.fastT = 0;
        this.needResize = true;
      }
    } else {
      this.slowT = this.fastT = 0;
    }
  }

  get fps() {
    return 1000 / this.frameAvg;
  }
  get renderScale() {
    return this.baseRatio * this.scale;
  }
}

// ------------------------------------------------------------------ static scenery

function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(420, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3f86ff') },
      mid: { value: new THREE.Color('#bfe0ff') },
      bot: { value: new THREE.Color('#f3c9ff') },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

function colored(geo: THREE.BufferGeometry, color: string, jitter = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i += 3) {
    const f = 1 + (Math.random() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      cols[(i + j) * 3] = c.r * f;
      cols[(i + j) * 3 + 1] = c.g * f;
      cols[(i + j) * 3 + 2] = c.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function makeIsland(): THREE.Group {
  const grp = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R - 0.35, 1.2, 72), new THREE.MeshStandardMaterial({ color: '#79cf4a', roughness: 0.95 }));
  grass.position.y = -0.6;
  grass.receiveShadow = true;
  grp.add(grass);

  const parts: THREE.BufferGeometry[] = [];
  const dirt = new THREE.CylinderGeometry(ISLAND_R - 0.35, ISLAND_R - 1.4, 1.8, 40, 1);
  dirt.translate(0, -2.1, 0);
  parts.push(colored(dirt, '#a8744a', 0.12));
  const rock = new THREE.ConeGeometry(ISLAND_R - 1.4, 11, 22, 5);
  const pos = rock.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 5.4 && y > -5.4) {
      pos.setX(i, pos.getX(i) * (0.85 + Math.random() * 0.3));
      pos.setZ(i, pos.getZ(i) * (0.85 + Math.random() * 0.3));
    }
  }
  rock.rotateX(Math.PI);
  rock.translate(0, -3 - 5.5, 0);
  parts.push(colored(rock, '#7b5b48', 0.25));

  // trees, rocks, flowers around the back and sides (keep the front clear)
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const treeSpots: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd(Math.PI * 0.62, Math.PI * 2.38); // mostly behind
    const r = rnd(10.5, ISLAND_R - 1.2);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (z > 2) continue;
    treeSpots.push([x, z]);
  }
  // each tree is its own mesh (built around its base) so it can duck out of the camera's way
  const decoMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const trees: THREE.Mesh[] = [];
  for (const [x, z] of treeSpots) {
    const h = rnd(1.6, 2.8);
    const tp: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.26, h, 6);
    trunk.translate(0, h / 2, 0);
    tp.push(colored(trunk, '#8a5a3b', 0.1));
    const kind = Math.random();
    if (kind < 0.5) {
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.ConeGeometry(1.3 - k * 0.3, 1.5, 7);
        cone.translate(0, h + 0.4 + k * 0.75, 0);
        tp.push(colored(cone, k % 2 ? '#3fae52' : '#4cc15e', 0.15));
      }
    } else {
      const puff = new THREE.IcosahedronGeometry(rnd(1.1, 1.6), 0);
      puff.translate(0, h + 0.9, 0);
      tp.push(colored(puff, Math.random() < 0.3 ? '#ff9ec7' : '#5ccf66', 0.2));
    }
    const g = mergeGeometries(tp);
    g.computeVertexNormals();
    const tree = new THREE.Mesh(g, decoMat);
    tree.position.set(x, 0, z);
    tree.castShadow = tree.receiveShadow = true;
    trees.push(tree);
    grp.add(tree);
  }
  grp.userData.trees = trees;
  for (let i = 0; i < 22; i++) {
    const a = rnd(0, Math.PI * 2), r = rnd(7, ISLAND_R - 0.8);
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 6 && z > -4) continue;
    if (Math.random() < 0.4) {
      const rock2 = new THREE.DodecahedronGeometry(rnd(0.25, 0.6), 0);
      rock2.translate(x, 0.1, z);
      parts.push(colored(rock2, '#a7aab5', 0.2));
    } else {
      const fl = new THREE.IcosahedronGeometry(0.16, 0);
      fl.translate(x, 0.12, z);
      parts.push(colored(fl, ['#ffffff', '#ffd23f', '#ff6ac1', '#a66cff'][i % 4], 0));
    }
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  merged.computeVertexNormals();
  const deco = new THREE.Mesh(merged, decoMat);
  deco.castShadow = true;
  deco.receiveShadow = true;
  grp.add(deco);
  return grp;
}

function makeClouds(): THREE.Object3D[] {
  const groups: THREE.Object3D[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, emissive: new THREE.Color('#dfe9ff'), emissiveIntensity: 0.35 });
  for (let gi = 0; gi < 2; gi++) {
    const parts: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 9; c++) {
      const a = (c / 9) * Math.PI * 2 + gi * 0.35 + Math.random() * 0.3;
      const r = 45 + Math.random() * 60 + gi * 20;
      const y = gi === 0 ? -14 + Math.random() * 10 : 6 + Math.random() * 22;
      const cx = Math.sin(a) * r, cz = Math.cos(a) * r;
      const blobs = 4 + Math.floor(Math.random() * 4);
      for (let b = 0; b < blobs; b++) {
        const s = 2.5 + Math.random() * 3.5;
        const g = new THREE.IcosahedronGeometry(s, 1);
        g.scale(1, 0.62, 1);
        g.translate(cx + (b - blobs / 2) * 3.2, y + Math.random() * 1.5, cz + (Math.random() - 0.5) * 3);
        parts.push(g.index ? g.toNonIndexed() : g);
      }
    }
    const merged = mergeGeometries(parts);
    merged.computeVertexNormals();
    const m = new THREE.Mesh(merged, mat);
    groups.push(m);
  }
  return groups;
}

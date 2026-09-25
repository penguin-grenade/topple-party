// The 3D preview: the tower as it will look in the game, orbitable, with the current layer and
// the selection picked out. In physics mode its meshes follow the simulation instead.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PIECE_HEIGHT, PIECE_WIDTH } from '../tv/sim/towerFile';
import type { Entity, Sim } from '../tv/sim/sim';
import { Model, type Ref } from './model';

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
const MATS = {
  wood: mat('#e6c48f'),
  woodLayer: mat('#e6c48f', { emissive: new THREE.Color('#2a6cff'), emissiveIntensity: 0.28 }),
  woodSel: mat('#7fd6ff', { emissive: new THREE.Color('#7fd6ff'), emissiveIntensity: 0.5 }),
  gold: mat('#ffd23f', { metalness: 0.4, roughness: 0.35 }),
  goldLayer: mat('#ffd23f', { metalness: 0.4, roughness: 0.35, emissive: new THREE.Color('#2a6cff'), emissiveIntensity: 0.28 }),
  crown: mat('#ffcf40', { metalness: 0.5, roughness: 0.3, emissive: new THREE.Color('#ff9f00'), emissiveIntensity: 0.25 }),
  crownSel: mat('#7fd6ff', { emissive: new THREE.Color('#7fd6ff'), emissiveIntensity: 0.5 }),
  plinth: mat('#aeb7c6'),
  plinthSel: mat('#7fd6ff', { emissive: new THREE.Color('#7fd6ff'), emissiveIntensity: 0.4 }),
  fell: mat('#ff5a6e', { emissive: new THREE.Color('#ff5a6e'), emissiveIntensity: 0.4 }),
  grabbed: mat('#7fd6ff', { emissive: new THREE.Color('#7fd6ff'), emissiveIntensity: 0.6 }),
};

export class View3D {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  readonly controls: OrbitControls;
  private design = new THREE.Group();
  private simGroup = new THREE.Group();
  private refOf = new Map<THREE.Object3D, Ref>();
  private simMeshes = new Map<Entity, THREE.Mesh>();
  private geos = new Map<string, THREE.BoxGeometry>();
  private ray = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  onPick: (ref: Ref | null) => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly model: Model,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color('#9fc4ff');
    this.scene.fog = new THREE.Fog('#9fc4ff', 60, 200);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a48', 1.1));
    const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
    sun.position.set(12, 30, 18);
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), mat('#7fcf5a'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(40, 40, '#5a9a40', '#6db54c');
    grid.position.y = 0.005;
    this.scene.add(grid);
    this.scene.add(this.design, this.simGroup);
    this.camera.position.set(14, 12, 20);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 4, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4) this.pick(e);
      this.down = null;
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.gl.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  /** Look at the whole tower. */
  frameTower() {
    const b = this.model.bounds(), top = this.model.topY();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, top);
    this.controls.target.set(cx, top / 2, cz);
    const d = Math.max(12, size * 1.6);
    this.camera.position.set(cx + d * 0.55, top / 2 + d * 0.45, cz + d * 0.8);
  }

  private geo(sx: number, sy: number, sz: number) {
    const key = `${sx}|${sy}|${sz}`;
    let g = this.geos.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(sx, sy, sz);
      this.geos.set(key, g);
    }
    return g;
  }

  /** Rebuild the design meshes from the document. */
  rebuild() {
    this.design.clear();
    this.refOf.clear();
    const t = this.model.tower;
    t.plinths.forEach((p, i) => {
      const m = new THREE.Mesh(this.geo(p.w, p.h ?? 1, p.d), MATS.plinth);
      m.position.set(p.x, (p.h ?? 1) / 2, p.z);
      m.rotation.y = ((p.ang ?? 0) * Math.PI) / 180;
      this.design.add(m);
      this.refOf.set(m, { kind: 'plinth', i });
    });
    t.pieces.forEach((p, i) => {
      const h = p.h ?? PIECE_HEIGHT;
      const m = new THREE.Mesh(this.geo(p.len, h, p.w ?? PIECE_WIDTH), MATS.wood);
      m.position.set(p.x, p.y + h / 2, p.z);
      m.rotation.y = ((p.ang ?? 0) * Math.PI) / 180;
      this.design.add(m);
      this.refOf.set(m, { kind: 'piece', i });
    });
    t.crowns.forEach((c, i) => {
      const s = c.size ?? 1;
      const m = new THREE.Mesh(this.geo(s, s, s), MATS.crown);
      m.position.set(c.x, c.y + s / 2, c.z);
      this.design.add(m);
      this.refOf.set(m, { kind: 'crown', i });
    });
    this.restyle();
  }
  /** Recolour for the current layer and selection (cheap: no geometry changes). */
  restyle() {
    const m = this.model, y = m.layerY;
    for (const [obj, ref] of this.refOf) {
      const mesh = obj as THREE.Mesh;
      const sel = m.isSelected(ref);
      if (ref.kind === 'plinth') mesh.material = sel ? MATS.plinthSel : MATS.plinth;
      else if (ref.kind === 'crown') mesh.material = sel ? MATS.crownSel : MATS.crown;
      else {
        const p = m.tower.pieces[ref.i];
        if (!p) continue; // the document changed and the rebuild is still queued
        const onLayer = Math.abs(p.y - y) < 0.01;
        mesh.material = sel ? MATS.woodSel : p.gold ? (onLayer ? MATS.goldLayer : MATS.gold) : onLayer ? MATS.woodLayer : MATS.wood;
      }
    }
  }
  private pick(e: PointerEvent) {
    if (this.simGroup.children.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = this.ray.intersectObjects(this.design.children, false)[0];
    this.onPick(hit ? (this.refOf.get(hit.object) ?? null) : null);
  }

  // ------------------------------------------------------------------ physics mode
  /** Show the simulation's bodies instead of the design. */
  startPhysics(sim: Sim) {
    this.design.visible = false;
    this.simGroup.clear();
    this.simMeshes.clear();
    for (const e of sim.ents) {
      const m = new THREE.Mesh(this.geo(e.size.x, e.size.y, e.size.z), e.type === 'crown' ? MATS.crown : e.type === 'jgold' ? MATS.gold : MATS.wood);
      this.simGroup.add(m);
      this.simMeshes.set(e, m);
    }
    for (const p of this.model.tower.plinths) {
      const m = new THREE.Mesh(this.geo(p.w, p.h ?? 1, p.d), MATS.plinth);
      m.position.set(p.x, (p.h ?? 1) / 2, p.z);
      m.rotation.y = ((p.ang ?? 0) * Math.PI) / 180;
      this.simGroup.add(m);
    }
    this.syncPhysics(sim);
  }
  syncPhysics(sim: Sim, fell?: Set<Entity>, grabbed?: Entity | null) {
    for (const [e, m] of this.simMeshes) {
      if (e.gone) {
        m.visible = false;
        continue;
      }
      const t = e.body.translation(), q = e.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(q.x, q.y, q.z, q.w);
      if (fell?.has(e)) m.material = MATS.fell;
      else if (e === grabbed) m.material = MATS.grabbed;
    }
    void sim;
  }
  stopPhysics() {
    this.simGroup.clear();
    this.simMeshes.clear();
    this.design.visible = true;
  }
  get inPhysics() {
    return !this.design.visible;
  }
}

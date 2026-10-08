// Placement: spawn, drag & drop, transform controls, gravity settle, undo/redo.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { createRock, rebuildRock, seedToOffset } from './hardscape.js';
import { createWood, rerollWood } from './wood.js';
import { createPlant } from './plants.js';
import { ROCK_TYPES, WOOD_TYPES, PLANT_TYPES } from './presets.js';

const DEF_SCALE = { rock: 7, wood: 9, plant: 1 };
const DEF_ROT = { rock: 20, wood: 25, plant: 40 };

export class Placement {
  constructor(scene, camera, renderer, substrate) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.substrate = substrate;

    this.objects = [];
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null; // set by main
    this.onSelection = null;
    this.sculptMode = false; // true = LMB belongs to the sculpt brush, not picking

    this.group = new THREE.Group();
    this.group.name = 'placed';
    scene.add(this.group);

    // transform gizmo
    this.gizmo = new TransformControls(camera, renderer.domElement);
    this.gizmo.setSize(0.85);
    this.gizmo.setSpace('world');
    scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      // pause orbit while dragging
      this.orbit && (this.orbit.enabled = !e.value);
      if (!e.value) {
        this._clampInside(this.selected);
        this._pushUndo('transform', { id: this.selected?.userData.id, before: null });
      }
    });

    // drag-drop state
    this._ray = new THREE.Raycaster();
    this._ray.far = 500;
    this._pending = null; // { spawn } while dragging a new item over the tank
    this._dragging = null; // existing object being repositioned
    this._hoverPt = new THREE.Vector3();
    this._overTank = false;

    this._bindEvents();
    this._setupGizmoMode('translate');
  }

  setOrbit(orbit) { this.orbit = orbit; }

  /** Sculpt mode: left-drag paints/sculpts instead of dragging objects. */
  setSculptMode(on) {
    this.sculptMode = on;
    if (on) {
      this._dragging = null;
      this.select(null);
    }
  }

  // ================= spawning =================
  spawn(kindKey, typeKey) {
    const id = ++Placement._nextId;
    const rnd = (Math.random() * 1e9) | 0;
    let obj;
    if (kindKey === 'rock') {
      obj = createRock(typeKey, rnd);
      const s = DEF_SCALE.rock * (0.75 + Math.random() * 0.5);
      obj.scale.setScalar(s);
    } else if (kindKey === 'wood') {
      obj = createWood(typeKey, rnd);
      obj.scale.setScalar(DEF_SCALE.wood * (0.8 + Math.random() * 0.4));
    } else if (kindKey === 'plant') {
      obj = createPlant(typeKey, rnd, 1);
      obj.scale.setScalar(1);
    }
    obj.userData.id = id;
    obj.userData.kindKey = kindKey;
    obj.spawnScale = obj.scale.x;
    obj.spawnRotY = obj.rotation.y;
    this._stamp(obj);
    this.group.add(obj);
    this.objects.push(obj);
    this.settleOne(obj, true);
    this.select(obj);
    this._pushUndo('add', { id });
    this._changed();
    return obj;
  }

  _stamp(obj) {
    // record per-object params for inspector + save/load. Rocks already carry
    // their full resolved params from createRock — never clobber them here.
    const u = obj.userData;
    if (u.kind === 'plant') {
      u.params = { seed: u.seed, scaleMul: 1, tint: 0, hueJitterSeed: 0 };
    } else if (u.kind === 'rock') {
      u.params = u.params ?? { seed: u.seed, tint: null };
    } else {
      u.params = { seed: u.seed, tint: null };
    }
  }

  // ================= selection =================
  select(obj) {
    if (this.selected === obj) return;
    this.selected = obj || null;
    if (obj) {
      this.gizmo.attach(obj);
      this.gizmo.visible = true;
      this.gizmo.enabled = true;
    } else {
      this.gizmo.detach();
    }
    this.onSelection && this.onSelection(obj);
    this.syncRerollBtn();
  }

  /** Show the top-bar Reroll button only for re-rollables (rock / wood). */
  syncRerollBtn() {
    const b = document.getElementById('act-reroll');
    if (!b) return;
    const u = this.selected?.userData;
    b.hidden = !u || (u.kindKey !== 'rock' && u.kindKey !== 'wood');
  }

  /** Re-roll the selected rock/wood in place (shared by toolbar + inspector). */
  rerollSelected() {
    const obj = this.selected;
    if (!obj) return;
    const u = obj.userData;
    if (u.kindKey !== 'rock' && u.kindKey !== 'wood') return;
    const ns = (Math.random() * 1e9) | 0;

    if (u.kindKey === 'rock') {
      // in-place: geometry + material rebuilt on the same mesh, so the
      // selection, gizmo and transform are untouched. Only the noise region
      // moves — proportions, colour and rotation stay as the user set them.
      u.seed = ns;
      rebuildRock(obj, { seedOffset: seedToOffset(ns) });
      if (u.autoY !== false) this.settleOne(obj);
      this._changed();
      this.onSelection && this.onSelection(obj);
      return obj;
    }

    const fresh = rerollWood(obj, ns);
    fresh.position.copy(obj.position);
    fresh.rotation.copy(obj.rotation);
    fresh.scale.copy(obj.scale);
    fresh.userData.id = u.id;
    fresh.userData.kindKey = u.kindKey;
    fresh.userData.autoY = u.autoY;
    this._removeInternal(obj);
    this.group.add(fresh);
    this.objects.push(fresh);
    this.settleOne(fresh, true);
    this.select(fresh);
    this._pushUndo('add', { id: fresh.userData.id });
    this._changed();
    return fresh;
  }

  _setupGizmoMode(mode) {
    this.gizmo.setMode(mode);
    if (mode === 'translate') this.gizmo.setSpace('world');
    if (mode === 'rotate') this.gizmo.setSpace('local');
    this.gizmo.setSize(mode === 'rotate' ? 0.95 : 0.85);
  }

  setMode(mode) {
    this._setupGizmoMode(mode);
    this.mode = mode;
  }

  // ================= picking & movement =================
  _groundRay(ndc, objs) {
    this._ray.setFromCamera(ndc, this.camera);
    const hits = this._ray.intersectObjects(objs, false);
    return hits[0] || null;
  }

  _tankRay(ndc) {
    // ray vs the substrate mesh + tank floor plane
    this._ray.setFromCamera(ndc, this.camera);
    const sub = this.substrate.mesh;
    const hitsSub = sub ? this._ray.intersectObject(sub, false) : [];
    if (hitsSub.length) return { point: hitsSub[0].point, onSub: true };
    // fallback: intersect y=0 plane within tank bounds
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (this._ray.ray.intersectPlane(plane, pt)) {
      const r = this.substrate.tank.floorRect;
      if (pt.x >= r.x0 - 2 && pt.x <= r.x0 + r.w + 2 && pt.z >= r.z0 - 2 && pt.z <= r.z0 + r.d + 2) {
        return { point: pt, onSub: false };
      }
    }
    return null;
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.gizmo.dragging) return;
      // sculpt mode: LMB belongs to the brush — never pick/drag objects.
      // capture the pointer so strokes that leave the canvas keep painting
      if (this.sculptMode) {
        this.select(null);
        el.setPointerCapture(e.pointerId);
        return;
      }
      const ndc = this._ndc(e);
      // gizmo priority
      if (this.selected) {
        const hit = this._groundRay(ndc, [this.selected]);
        if (hit && this.gizmo.axis) return; // about to drag via gizmo
      }
      const picked = this._pickPlaced(ndc);
      if (picked) {
        this.select(picked);
        this._dragging = { obj: picked, offset: new THREE.Vector3(), z: e.pointerId, moved: false };
        const t = this._tankRay(ndc);
        if (t) {
          this._dragging.offset.copy(picked.position).sub(t.point);
          this._dragging.offset.y = 0;
        }
        el.setPointerCapture(e.pointerId);
      } else {
        this.select(null);
      }
    });

    el.addEventListener('pointermove', (e) => {
      const ndc = this._ndc(e);
      // pending spawn drag (from palette)
      if (this._pending) {
        const t = this._tankRay(ndc);
        if (t) {
          this._overTank = true;
          this._pending.obj.position.copy(t.point);
          this._pending.obj.position.y += 0.6;
          this._pending.obj.rotation.y = this._pending.rotY;
          this._pending.obj.visible = true;
        } else {
          this._overTank = false;
          this._pending.obj.visible = false;
        }
        return;
      }
      // sculpt handled by main via callback
      this.onHover && this.onHover(ndc, e);

      // reposition existing object
      if (this._dragging) {
        const t = this._tankRay(ndc);
        if (t) {
          const p = t.point.clone().add(this._dragging.offset);
          const o = this._dragging.obj;
          o.position.x = p.x;
          o.position.z = p.z;
          if (t.onSub) {
            // heightAt (triangle-exact) rather than the ray hit: the ray may
            // land on a different cell than the object's footprint center,
            // which made drops visibly 'snap' onto a cell grid
            o.position.y = this.substrate.heightAt(o.position.x, o.position.z) + (o.userData.groundOffset ?? 0);
          }
          this._dragging.moved = true;
        }
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (this._pending) {
        if (this._overTank) {
          this._finishSpawn();
        } else {
          this._abortSpawn();
        }
        return;
      }
      if (this._dragging) {
        if (this._dragging.moved) {
          const o = this._dragging.obj;
          o.userData.autoY = undefined; // ground drag = back to auto-altitude
          this.settleOne(o);
          this._pushUndo('move', { id: o.userData.id, moved: true });
          this._changed();
        }
        this._dragging = null;
      }
    });
  }

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  _pickPlaced(ndc) {
    this._ray.setFromCamera(ndc, this.camera);
    const hits = this._ray.intersectObjects(this.objects, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o.parent && o.parent !== this.group) o = o.parent;
    return o;
  }

  // ================= spawn drag flow =================
  beginSpawn(kindKey, typeKey) {
    this._abortSpawn();
    const id = ++Placement._nextId;
    const rnd = (Math.random() * 1e9) | 0;
    let obj;
    if (kindKey === 'rock') obj = createRock(typeKey, rnd);
    else if (kindKey === 'wood') obj = createWood(typeKey, rnd);
    else if (kindKey === 'plant') obj = createPlant(typeKey, rnd, 1);
    else return null;
    if (kindKey === 'rock') obj.scale.setScalar(DEF_SCALE.rock);
    else if (kindKey === 'wood') obj.scale.setScalar(DEF_SCALE.wood);
    obj.visible = false;
    obj.userData.id = id;
    obj.userData.kindKey = kindKey;
    this._stamp(obj);
    this._pending = { obj, kindKey, typeKey, rotY: Math.random() * Math.PI * 2, over: false };
    return obj;
  }

  updateSpawn(ndc) {
    if (!this._pending) return null;
    const t = this._tankRay(ndc);
    if (t) {
      this._pending.obj.visible = true;
      this._pending.over = true;
      this._pending.obj.position.copy(t.point);
      this._pending.obj.rotation.y = this._pending.rotY;
      this._pending.obj.position.y += 0.6;
      return t.point;
    }
    this._pending.obj.visible = false;
    this._pending.over = false;
    return null;
  }

  _finishSpawn() {
    const p = this._pending;
    this._pending = null;
    if (!p) return;
    p.obj.visible = true;
    this.group.add(p.obj);
    this.objects.push(p.obj);
    this.settleOne(p.obj, true);
    this.select(p.obj);
    this._pushUndo('add', { id: p.obj.userData.id });
    this._changed();
  }

  _abortSpawn() {
    if (!this._pending) return;
    const p = this._pending;
    this._pending = null;
    disposeObj(p.obj);
  }

  // ================= settle =================
  /** Drop an object to rest on the substrate (or tank floor). */
  settleOne(obj, initial = false) {
    const u = obj.userData;
    // compute world bbox with current scale
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);

    // sample the substrate at several footprint points (center + quarter
    // points) and rest on the HIGHEST — long logs sit on terrain instead of
    // teetering on a single center sample
    const r = this.substrate.tank.floorRect;
    const c = new THREE.Vector3();
    bb.getCenter(c);
    const qx = Math.min((bb.max.x - bb.min.x) / 4, 6);
    const qz = Math.min((bb.max.z - bb.min.z) / 4, 6);
    const sample = (x, z) => this.substrate.heightAt(
      THREE.MathUtils.clamp(x, r.x0 + 0.5, r.x0 + r.w - 0.5),
      THREE.MathUtils.clamp(z, r.z0 + 0.5, r.z0 + r.d - 0.5)
    );
    const ground = Math.max(
      sample(c.x, c.z),
      sample(bb.min.x + qx, c.z), sample(bb.max.x - qx, c.z),
      sample(c.x, bb.min.z + qz), sample(c.x, bb.max.z - qz)
    );

    // find the lowest point of the object
    const minY = bb.min.y;
    const dy = ground - minY;
    obj.position.y += dy;
    // plants & wood sink slightly ("planting" / weighting)
    if (u.kind === 'plant') obj.position.y -= 0.35;
    if (u.kind === 'wood') obj.position.y -= 0.25;
    if (u.kind === 'rock') obj.position.y -= 0.15; // press into substrate

    obj.updateMatrixWorld(true);
    u.groundOffset = obj.position.y - ground;
    if (initial) this._clampInside(obj);
  }

  /** Force a re-seat (clears manual-Y stacking lock). */
  dropOne(obj) {
    obj.userData.autoY = undefined;
    this.settleOne(obj);
    this._changed();
  }

  settleAll() {
    for (const o of this.objects) {
      // objects with manually-set Y (stacking) keep their altitude
      if (o.userData.autoY === false) continue;
      this.settleOne(o);
    }
    this._changed();
  }

  _clampInside(obj) {
    if (!obj) return;
    const r = this.substrate.tank.floorRect;
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const m = 0.5;
    if (bb.min.x < r.x0 - m) obj.position.x += r.x0 - m - bb.min.x;
    if (bb.max.x > r.x0 + r.w + m) obj.position.x -= bb.max.x - (r.x0 + r.w + m);
    if (bb.min.z < r.z0 - m) obj.position.z += r.z0 - m - bb.min.z;
    if (bb.max.z > r.z0 + r.d + m) obj.position.z -= bb.max.z - (r.z0 + r.d + m);
    // ceiling
    const h = this.substrate.tank.state.h;
    obj.updateMatrixWorld(true);
    const bb2 = new THREE.Box3().setFromObject(obj);
    if (bb2.max.y > h + 2) obj.position.y -= bb2.max.y - (h + 2);
  }

  // ================= delete / duplicate =================
  deleteObj(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    if (this.selected === obj) this.select(null);
    this.group.remove(obj);
    if (this.selected === obj) this.select(null);
    disposeObj(obj);
    this._pushUndo('remove', { snapshot: serializeSingle(obj) }, { snapshotReinsert: true });
  }

  duplicate(obj) {
    const u = obj.userData;
    const copy = spawnFromData(serializeSingle(obj));
    if (!copy) return null;
    copy.position.x += 4;
    copy.position.z += 4;
    this.group.add(copy);
    this.objects.push(copy);
    this.settleOne(copy, true);
    this.select(copy);
    this._pushUndo('add', { id: copy.userData.id });
    this._changed();
    return copy;
  }

  // ================= undo / redo =================
  _pushUndo(kind, data, extra) {
    this.undoStack.push({ kind, data, extra, time: Date.now() });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onHistory && this.onHistory();
  }

  undo() {
    const act = this.undoStack.pop();
    if (!act) return;
    const redo = this._applyUndo(act, true);
    if (redo) this.redoStack.push(redo);
    this.onHistory && this.onHistory();
    this._changed();
  }

  redo() {
    const act = this.redoStack.pop();
    if (!act) return;
    const back = this._applyUndo(act, false);
    if (back) this.undoStack.push(back);
    this.onHistory && this.onHistory();
    this._changed();
  }

  _applyUndo(act, isUndo) {
    switch (act.kind) {
      case 'add': {
        const obj = this.byId(act.data.id);
        if (obj) {
          this._removeInternal(obj);
          return { kind: 'remove-add', data: { snapshot: serializeSingle(obj) } };
        }
        return null;
      }
      case 'remove-add': {
        const obj = spawnFromData(act.data.snapshot);
        if (obj) {
          this.group.add(obj);
          this.objects.push(obj);
        }
        return { kind: 'add', data: { id: obj?.userData.id } };
      }
      case 'remove': {
        const obj = spawnFromData(act.data.snapshot);
        if (obj) {
          this.group.add(obj);
          this.objects.push(obj);
          this._changed();
        }
        return { kind: 'add', data: { id: obj?.userData.id } };
      }
      case 'move':
        // best effort: no inverse stored; treat as no-op marker for redo
        return null;
      case 'transform':
        return null;
      default:
        return null;
    }
  }

  byId(id) {
    return this.objects.find((o) => o.userData.id === id) || null;
  }

  _removeInternal(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    if (this.selected === obj) this.select(null);
    this.group.remove(obj);
    disposeObj(obj);
  }

  _changed() {
    this.onChange && this.onChange();
  }

  /** Replace all objects from save data. */
  loadAll(list) {
    for (const o of [...this.objects]) this._removeInternal(o);
    for (const snap of list) {
      const obj = spawnFromData(snap);
      if (obj) {
        this.group.add(obj);
        this.objects.push(obj);
      }
    }
    this.select(null);
    this._changed();
  }

  serializeAll() {
    return this.objects.map(serializeSingle);
  }
}

Placement._nextId = 0;

// ================= serialization =================
export function serializeSingle(obj) {
  const u = obj.userData;
  const snap = {
    kindKey: u.kindKey,
    typeKey: u.typeKey,
    seed: u.seed,
    scale: obj.scale.x,
    pos: obj.position.toArray(),
    rotY: obj.rotation.y,
    rotX: obj.rotation.x,
    rotZ: obj.rotation.z,
    hue: u.params?.hue ?? 0,
    tint: u.params?.tint ?? null,
    autoY: u.autoY === false ? false : true,
  };
  // rocks carry their full resolved params (shape + material) so editing a
  // preset later can't silently reshape a saved layout
  if (u.kindKey === 'rock' && u.params) snap.params = { ...u.params };
  return snap;
}

export function spawnFromData(s) {
  if (!s) return null;
  let obj = null;
  const rnd = s.seed ?? ((Math.random() * 1e9) | 0);
  try {
    if (s.kindKey === 'rock') obj = createRock(s.typeKey, rnd, { params: s.params });
    else if (s.kindKey === 'wood') obj = createWood(s.typeKey, rnd);
    else if (s.kindKey === 'plant') obj = createPlant(s.typeKey, rnd, s.scaleMul ?? 1);
  } catch {
    // deleted/renamed catalogue entries (e.g. bolbitis/rotala) are skipped silently
  }
  if (!obj) return null;
  obj.userData.id = ++Placement._nextId;
  obj.userData.kindKey = s.kindKey;
  obj._stampDone = false;
  obj.scale.setScalar(s.scale ?? 1);
  obj.position.fromArray(s.pos ?? [0, 0, 0]);
  obj.rotation.set(s.rotX ?? 0, s.rotY ?? 0, s.rotZ ?? 0);
  if (s.hue && obj.userData.kind === 'plant') {
    applyHue(obj, s.hue);
    obj.userData.params = obj.userData.params || {};
    obj.userData.params.hue = s.hue;
  }
  obj.userData.autoY = s.autoY === false ? false : undefined;
  return obj;
}

export function applyHue(obj, hue) {
  obj.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) {
      const c = o.material.color;
      const hsl = {};
      c.getHSL(hsl);
      c.setHSL((hsl.h + hue + 1) % 1, hsl.s, hsl.l);
    }
  });
}

export function disposeObj(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m.map) m.map.dispose();
        if (m.bumpMap && m.bumpMap !== m.map) m.bumpMap.dispose();
        m.dispose();
      });
    }
    if (o.isInstancedMesh) o.dispose();
  });
}
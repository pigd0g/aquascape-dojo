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
    // ordered multi-selection: the LAST entry is the "active" object (the one
    // the inspector and the single-object gizmo bind to); `selected` is a getter
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null; // set by main
    this.onSelection = null;
    this.sculptMode = false; // true = LMB belongs to the sculpt brush, not picking
    this.viewOnly = false; // true = camera-only mode; picking/dragging is dead

    this.group = new THREE.Group();
    this.group.name = 'placed';
    scene.add(this.group);

    // selection visuals: an outline box per selected object (the active one
    // also carries the gizmo)
    this._outlineRoot = new THREE.Group();
    this._outlineRoot.name = 'selection';
    scene.add(this._outlineRoot);
    this._boxes = []; // [{ h: Box3Helper, o: object }]

    // invisible pivot: with several objects selected the gizmo attaches here
    // (at the selection centroid) and the drag delta is applied to every member
    this._pivot = new THREE.Object3D();
    this._pivot.visible = false;
    scene.add(this._pivot);
    this._groupStart = null; // { pos, quat, scale, objs: [{ o, pos, quat, scale }] }

    // transform gizmo
    this.gizmo = new TransformControls(camera, renderer.domElement);
    this.gizmo.setSize(0.85);
    this.gizmo.setSpace('world');
    scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      // pause orbit while dragging
      this.orbit && (this.orbit.enabled = !e.value);
      if (e.value) return;
      if (this._groupStart) {
        // group drag finished: clamp every member, re-centre the pivot, one undo
        for (const it of this._groupStart.objs) this._clampInside(it.o);
        this._groupStart = null;
        this._pivotFromSelection();
        this._pushUndo('transform', { ids: this.selection.map((o) => o.userData.id) });
      } else {
        this._clampInside(this.selected);
        this._pushUndo('transform', { id: this.selected?.userData.id, before: null });
      }
      this._refreshOutlines();
    });
    this.gizmo.addEventListener('mouseDown', () => {
      // snapshot the pre-drag state of the whole selection (group drags only)
      if (this.selection.length < 2) { this._groupStart = null; return; }
      this._groupStart = {
        pos: this._pivot.position.clone(),
        quat: this._pivot.quaternion.clone(),
        scale: this._pivot.scale.clone(),
        objs: this.selection.map((o) => ({
          o,
          pos: o.position.clone(),
          quat: o.quaternion.clone(),
          scale: o.scale.clone(),
        })),
      };
    });
    this.gizmo.addEventListener('objectChange', () => this._applyGroupDelta());

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

  /**
   * View-only mode: the scene becomes a camera-only viewer. Picking, dragging
   * and the transform gizmo are all disabled (and any live drag/spawn is
   * abandoned), so nothing can modify the layout while it is on.
   */
  setViewOnly(on) {
    this.viewOnly = !!on;
    if (on) {
      this._dragging = null;
      this._abortSpawn();
      this._overTank = false;
      this.select(null);
    }
  }

  /** True when an edit is currently allowed (never in view-only mode). */
  get canEdit() {
    return !this.viewOnly;
  }

  // ================= spawning =================
  spawn(kindKey, typeKey) {
    if (!this.canEdit) return null;
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
  /** The active (last-clicked) selected object; null when nothing is selected. */
  get selected() {
    return this.selection[this.selection.length - 1] ?? null;
  }

  /** Replace the selection with a single object (`null` clears it). */
  select(obj) {
    this.selectMany(obj ? [obj] : []);
  }

  /** Replace the whole selection (deduped, click order preserved). */
  selectMany(list) {
    const next = [];
    for (const o of list || []) if (o && !next.includes(o)) next.push(o);
    this.selection = this.viewOnly ? [] : next; // never show a gizmo in view-only mode
    this._syncSelection();
  }

  /** Shift+click: put an object into the selection, or take it out again. */
  toggleSelect(obj) {
    if (!obj || this.viewOnly) return;
    const i = this.selection.indexOf(obj);
    if (i >= 0) this.selection.splice(i, 1); // removed: active falls back to the previous
    else this.selection.push(obj);
    this._syncSelection();
  }

  isSelected(obj) {
    return this.selection.includes(obj);
  }

  /**
   * Push the selection into the gizmo, the outline boxes and the inspector.
   * One object: the gizmo binds to it. Several: it binds to the centroid pivot
   * and the members are outlined.
   */
  _syncSelection() {
    if (this.selection.length > 1) {
      this._pivotFromSelection();
      this.gizmo.attach(this._pivot);
    } else if (this.selected) {
      this.gizmo.attach(this.selected);
    } else {
      this.gizmo.detach();
    }
    this._syncOutlines();
    this.onSelection && this.onSelection(this.selection);
    this.syncRerollBtn();
  }

  /** Centre the pivot on the selection with a clean (world-aligned) transform. */
  _pivotFromSelection() {
    const p = this._pivot;
    p.position.set(0, 0, 0);
    p.quaternion.identity();
    p.scale.set(1, 1, 1);
    const c = new THREE.Vector3();
    const box = new THREE.Box3();
    for (const o of this.selection) {
      box.setFromObject(o).getCenter(c);
      p.position.add(c);
    }
    p.position.multiplyScalar(1 / Math.max(1, this.selection.length));
    p.updateMatrixWorld(true);
  }

  /**
   * Apply the pivot's live transform to the whole selection. `delta` maps the
   * pre-drag pivot frame onto the current one, so the same matrix drives
   * translate, rotate and scale (rotate/scale pivot about the centroid).
   */
  _applyGroupDelta() {
    const S = this._groupStart;
    if (!S) return; // single-object drag: the gizmo transforms the object itself
    const delta = new THREE.Matrix4()
      .compose(this._pivot.position, this._pivot.quaternion, this._pivot.scale)
      .multiply(new THREE.Matrix4().compose(S.pos, S.quat, S.scale).invert());
    const m = new THREE.Matrix4();
    for (const it of S.objs) {
      m.compose(it.pos, it.quat, it.scale).premultiply(delta);
      m.decompose(it.o.position, it.o.quaternion, it.o.scale);
    }
    this._refreshOutlines();
  }

  /** Rebuild the outline boxes (one per selected object). */
  _syncOutlines() {
    for (const b of this._boxes) {
      this._outlineRoot.remove(b.h);
      b.h.geometry.dispose();
      b.h.material.dispose();
    }
    this._boxes.length = 0;
    if (this.selection.length < 2 || this.viewOnly) return;
    for (const o of this.selection) {
      const h = new THREE.Box3Helper(new THREE.Box3().setFromObject(o), 0xd9b36a);
      h.material.depthTest = false; // stay readable through glass & hardscape
      h.material.transparent = true;
      h.material.opacity = 0.9;
      h.renderOrder = 999;
      this._outlineRoot.add(h);
      this._boxes.push({ h, o });
    }
  }

  /** Keep the outline boxes glued to their objects after a transform/settle. */
  _refreshOutlines() {
    for (const b of this._boxes) b.h.box.setFromObject(b.o);
  }

  /** Show the top-bar Reroll button whenever any selected object is re-rollable. */
  syncRerollBtn() {
    const b = document.getElementById('act-reroll');
    if (!b) return;
    b.hidden = !this.selection.some(
      (o) => o.userData.kindKey === 'rock' || o.userData.kindKey === 'wood'
    );
  }

  /**
   * Re-roll every selected rock/wood in place (shared by the E key, toolbar and
   * inspector). Rocks rebuild on the same mesh; wood grows a fresh object that
   * is swapped into the roster and the selection, so the set survives.
   */
  rerollSelected() {
    if (!this.canEdit) return null;
    const targets = this.selection.filter(
      (o) => o.userData.kindKey === 'rock' || o.userData.kindKey === 'wood'
    );
    if (!targets.length) return null;

    const newWoodIds = [];
    let active = null;
    for (const obj of targets) {
      const ns = (Math.random() * 1e9) | 0;
      const u = obj.userData;

      if (u.kindKey === 'rock') {
        // in-place: geometry + material rebuilt on the same mesh, so the
        // selection, gizmo and transform are untouched. Only the noise region
        // moves — proportions, colour and rotation stay as the user set them.
        u.seed = ns;
        rebuildRock(obj, { seedOffset: seedToOffset(ns) });
        if (u.autoY !== false) this.settleOne(obj);
        active = obj;
        continue;
      }

      const fresh = rerollWood(obj, ns);
      fresh.position.copy(obj.position);
      fresh.rotation.copy(obj.rotation);
      fresh.scale.copy(obj.scale);
      fresh.userData.id = u.id;
      fresh.userData.kindKey = u.kindKey;
      fresh.userData.autoY = u.autoY;
      fresh.spawnScale = obj.spawnScale;
      fresh.spawnRotY = obj.spawnRotY;
      // swap in place so the rest of the selection keeps its order & identity
      const oi = this.objects.indexOf(obj);
      const si = this.selection.indexOf(obj);
      this.group.remove(obj);
      disposeObj(obj);
      this.group.add(fresh);
      if (oi >= 0) this.objects[oi] = fresh;
      if (si >= 0) this.selection[si] = fresh;
      this.settleOne(fresh, true);
      newWoodIds.push(fresh.userData.id);
      active = fresh;
    }

    if (newWoodIds.length) this._pushUndo('add', { ids: newWoodIds });
    this._syncSelection();
    this._changed();
    return active;
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
  _groundRay(ndc, objs, recursive = false) {
    this._ray.setFromCamera(ndc, this.camera);
    const hits = this._ray.intersectObjects(objs, recursive);
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
      // view-only mode: left button does nothing but orbit (handled by the
      // controls), so the camera is the only thing a click can touch
      if (this.viewOnly) return;
      // sculpt mode: LMB belongs to the brush — never pick/drag objects.
      // capture the pointer so strokes that leave the canvas keep painting
      if (this.sculptMode) {
        this.select(null);
        el.setPointerCapture(e.pointerId);
        return;
      }
      const ndc = this._ndc(e);
      // gizmo priority: an axis is hovered over one of the selected objects
      if (this.selection.length) {
        const hit = this._groundRay(ndc, this.selection, true);
        if (hit && this.gizmo.axis) return; // about to drag via gizmo
      }

      const picked = this._pickPlaced(ndc);
      let collapse = null; // plain click on a member of a set: single it out
      if (e.shiftKey) {
        // Shift+click toggles membership; empty water keeps the current set
        if (!picked) return;
        const wasSelected = this.isSelected(picked);
        this.toggleSelect(picked);
        if (wasSelected) return; // just removed — never start a drag on it
      } else if (picked) {
        if (!this.isSelected(picked)) this.select(picked);
        else if (this.selection.length > 1) collapse = picked;
      } else {
        this.select(null);
        return;
      }

      // start a drag: one object, or the whole selection when several are in
      this._dragging = {
        obj: picked,
        offset: new THREE.Vector3(),
        z: e.pointerId,
        moved: false,
        collapse,
        starts: this.selection.map((o) => ({ o, x: o.position.x, z: o.position.z })),
      };
      const t = this._tankRay(ndc);
      if (t) {
        this._dragging.offset.copy(picked.position).sub(t.point);
        this._dragging.offset.y = 0;
      }
      el.setPointerCapture(e.pointerId);
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

      // reposition the dragged object — and every other selected member with it
      if (this._dragging) {
        const t = this._tankRay(ndc);
        if (t) {
          const d = this._dragging;
          const p = t.point.clone().add(d.offset);
          // one delta for the whole set, so relative offsets are preserved
          const dx = p.x - d.obj.position.x;
          const dz = p.z - d.obj.position.z;
          for (const s of d.starts) {
            const o = s.o;
            o.position.x = s.x + dx;
            o.position.z = s.z + dz;
            if (t.onSub) {
              // heightAt (triangle-exact) rather than the ray hit: the ray may
              // land on a different cell than the object's footprint center,
              // which made drops visibly 'snap' onto a cell grid
              o.position.y = this.substrate.heightAt(o.position.x, o.position.z) + (o.userData.groundOffset ?? 0);
            }
          }
          d.moved = true;
          this._refreshOutlines();
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
        const d = this._dragging;
        this._dragging = null;
        if (d.moved) {
          for (const s of d.starts) {
            const o = s.o;
            o.userData.autoY = undefined; // ground drag = back to auto-altitude
            this.settleOne(o);
          }
          this._pushUndo('move', { ids: d.starts.map((s) => s.o.userData.id), moved: true });
          this._changed();
        } else if (d.collapse) {
          // plain click on a member of a set: reduce the selection to it
          this.select(d.collapse);
        }
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
    if (!this.canEdit) return null;
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
    this.dropMany(obj ? [obj] : []);
  }

  /** Re-seat every object in `list` (the inspector's Drop, the D key). */
  dropMany(list = this.selection) {
    if (!this.canEdit) return;
    for (const obj of [...list]) {
      if (!obj) continue;
      obj.userData.autoY = undefined;
      this.settleOne(obj);
    }
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
  /** Delete every object in `list` (defaults to the selection) as one undo step. */
  deleteObjs(list = this.selection) {
    if (!this.canEdit) return;
    const snaps = [];
    for (const obj of [...list]) {
      if (!obj || !this.objects.includes(obj)) continue;
      snaps.push(serializeSingle(obj)); // snapshot before the geometry is disposed
      this._removeInternal(obj, { sync: false });
    }
    if (!snaps.length) return;
    this._syncSelection();
    this._pushUndo('remove', { snapshots: snaps });
    this._changed();
  }

  /** Single-object form (inspector button, older call sites). */
  deleteObj(obj) {
    if (obj) this.deleteObjs([obj]);
  }

  /** Duplicate every object in `list` (defaults to the selection) as one undo step. */
  duplicateMany(list = this.selection) {
    if (!this.canEdit) return [];
    const copies = [];
    for (const obj of [...list]) {
      if (!obj || !this.objects.includes(obj)) continue;
      const copy = spawnFromData(serializeSingle(obj));
      if (!copy) continue;
      // the same offset for every copy, so a duplicated cluster keeps its shape
      copy.position.x += 4;
      copy.position.z += 4;
      this.group.add(copy);
      this.objects.push(copy);
      this.settleOne(copy, true);
      copies.push(copy);
    }
    if (!copies.length) return [];
    this.selectMany(copies);
    this._pushUndo('add', { ids: copies.map((c) => c.userData.id) });
    this._changed();
    return copies;
  }

  /** Single-object form (inspector button, Ctrl+D path). */
  duplicate(obj) {
    return this.duplicateMany(obj ? [obj] : [])[0] ?? null;
  }

  // ================= undo / redo =================
  _pushUndo(kind, data, extra) {
    this.undoStack.push({ kind, data, extra, time: Date.now() });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onHistory && this.onHistory();
  }

  undo() {
    if (!this.canEdit) return;
    const act = this.undoStack.pop();
    if (!act) return;
    const redo = this._applyUndo(act, true);
    if (redo) this.redoStack.push(redo);
    this.onHistory && this.onHistory();
    this._changed();
  }

  redo() {
    if (!this.canEdit) return;
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
        // one id or a batch (duplicated set / rerolled wood)
        const ids = act.data.ids ?? (act.data.id != null ? [act.data.id] : []);
        const snaps = [];
        for (const id of ids) {
          const obj = this.byId(id);
          if (!obj) continue;
          snaps.push(serializeSingle(obj));
          this._removeInternal(obj, { sync: false });
        }
        if (!snaps.length) return null;
        this._syncSelection();
        return { kind: 'remove-add', data: { snapshots: snaps } };
      }
      case 'remove-add':
      case 'remove': {
        const snaps = act.data.snapshots ?? (act.data.snapshot ? [act.data.snapshot] : []);
        const ids = [];
        for (const snap of snaps) {
          const obj = spawnFromData(snap);
          if (!obj) continue;
          this.group.add(obj);
          this.objects.push(obj);
          ids.push(obj.userData.id);
        }
        return { kind: 'add', data: { ids } };
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

  /** Remove one object from the roster, the selection and the scene (disposed). */
  _removeInternal(obj, { sync = true } = {}) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    const si = this.selection.indexOf(obj);
    if (si >= 0) {
      this.selection.splice(si, 1);
      if (sync) this._syncSelection();
    }
    this.group.remove(obj);
    disposeObj(obj);
  }

  _changed() {
    // a canvas drag / settle / reroll can move the members: keep the group
    // gizmo centred on the selection (never called mid-gizmo-drag)
    if (this.selection.length > 1) this._pivotFromSelection();
    this._refreshOutlines();
    this.onChange && this.onChange();
  }

  /** Replace all objects from save data. */
  loadAll(list) {
    this.selection = [];
    for (const o of [...this.objects]) this._removeInternal(o, { sync: false });
    for (const snap of list) {
      const obj = spawnFromData(snap);
      if (obj) {
        this.group.add(obj);
        this.objects.push(obj);
      }
    }
    this._syncSelection();
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
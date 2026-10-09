// Camera-aware "x-ray" culling for the dojo shell and display furniture.
//
// Anything registered here hides for as long as it stands between the camera
// and the tank: the four walls (with their wainscot and shoji), the coffered
// ceiling, the workbench, the corner plant clusters and still life. main.js
// calls tick() once per frame. The test:
//   · cast a grid of rays through the tank+stand's screen silhouette
//   · a handle blocks a sample when its geometry is hit before the tank/stand
//     along that ray; a handle that blocks ANY sample hides
//   · hiding is immediate; showing again requires a few consecutive clear
//     frames — that hysteresis absorbs boundary jitter without letting any
//     wall linger half-covering the tank (per-handle ratio thresholds would
//     leave a wall partially in front of the tank whenever two walls split
//     the silhouette on a diagonal orbit)
// Camera orbit, zoom and setStageY all fall out of the live-matrix math —
// rays are transformed into each handle's local frame, never rebuilt.
//
// Registration contract:
//  · register a subtree (usually a Group) — it is measured once, in its own
//    local space, so later parent motion (the stage lift) is free
//  · the subtree's world transform may rotate freely; it must not take a
//    non-uniform scale (rays move into its space via the inverse matrix, and
//    a skewed frame distorts distances along the ray)
//  · `link` couples a mounted piece to its host (the painting to the back
//    wall): while the host is hidden the piece hides too, so nothing floats
//    in mid-air when a wall disappears
//  · handles evaluate in registration order — register a host before the
//    dependents coupled to it
import * as THREE from "three";

const GRID = 6; // ray samples per screen axis (36 across the silhouette)
const CLEAR_FRAMES = 8; // consecutive unblocked frames before showing again

export class Occluder {
  constructor(camera) {
    this.camera = camera;
    this.tank = null;
    this.handles = [];
    // scratch
    this._ray = new THREE.Raycaster();
    this._localRay = new THREE.Ray();
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._tankBox = new THREE.Box3();
    this._standBox = new THREE.Box3();
    this._union = new THREE.Box3();
    this._world = new THREE.Box3();
    this._sil = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this._scr = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  /** main.js wires the tank in after creating it (room is built first). */
  setTank(tank) {
    this.tank = tank;
  }

  /**
   * Measure a subtree once and register it for per-frame culling.
   * One tight box per mesh (foliage subtrees included, instanced meshes
   * expanded instance-by-instance). Returns the handle.
   */
  add(root, { pad = 0 } = {}) {
    if (!root) return null;
    root.updateWorldMatrix(true, true); // make matrixWorlds current
    const inv = root.matrixWorld.clone().invert();
    const boxes = [];
    const box = new THREE.Box3();
    const one = new THREE.Box3();
    const im = new THREE.Matrix4();
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isInstancedMesh) {
        // precise=true skips instances — expand them manually
        box.makeEmpty();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, im);
          one.setFromBufferAttribute(o.geometry.attributes.position);
          one.applyMatrix4(im);
          box.union(one);
        }
        box.applyMatrix4(o.matrixWorld);
      } else {
        box.setFromObject(o, true);
      }
      box.applyMatrix4(inv); // world → root-local
      if (pad) box.expandByScalar(pad);
      boxes.push(box.clone());
    });
    if (!boxes.length) return null;
    const handle = {
      root,
      boxes,
      hidden: false,
      hideWith: null, // another handle this one follows (mounted decor)
      bounds: new THREE.Box3(),
      // per-frame scratch
      _inv: new THREE.Matrix4(),
      _tankL: new THREE.Box3(),
      _standL: new THREE.Box3(),
      _clear: CLEAR_FRAMES, // clear-frame streak (starts "ready to show")
      _cand: false,
    };
    for (const b of boxes) handle.bounds.union(b);
    this.handles.push(handle);
    return handle;
  }

  /** Couple a mount to its host: while the host is hidden, the mount hides
   *  too (a painting must not float on an invisible wall). Register hosts
   *  before their dependents — handles evaluate in registration order. */
  link(childHandle, hostHandle) {
    if (childHandle) childHandle.hideWith = hostHandle ?? null;
  }

  /** Screen AABB of a world-space box; false when fully behind the camera.
   *  Writes into `out` (minX/maxX/minY/maxY in NDC); corners behind the
   *  camera plane are skipped — their projection mirrors and would poison
   *  the bounds. */
  _screenBounds(box, out) {
    const cam = this.camera;
    let any = false;
    out.minX = 2;
    out.maxX = -2;
    out.minY = 2;
    out.maxY = -2;
    for (const sx of [box.min.x, box.max.x])
      for (const sy of [box.min.y, box.max.y])
        for (const sz of [box.min.z, box.max.z]) {
          this._point.set(sx, sy, sz);
          this._view.copy(this._point).applyMatrix4(cam.matrixWorldInverse);
          if (this._view.z >= 0) continue; // behind the camera plane
          this._point.project(cam);
          out.minX = Math.min(out.minX, this._point.x);
          out.maxX = Math.max(out.maxX, this._point.x);
          out.minY = Math.min(out.minY, this._point.y);
          out.maxY = Math.max(out.maxY, this._point.y);
          any = true;
        }
    return any;
  }

  /** Nearest positive entry distance of a local-space ray into the boxes.
   *  The handle's union bounds are used only as a cheap reject; the real
   *  distance comes from the per-mesh boxes (bounds contain gaps — e.g. the
   *  air above the bench worktop — which must not read as blocks). */
  _nearest(h, ray) {
    if (!ray.intersectBox(h.bounds, this._hit)) return Infinity;
    let best = Infinity;
    for (const b of h.boxes) {
      if (ray.intersectBox(b, this._hit)) {
        const d = this._hit.distanceTo(ray.origin);
        if (d > 0 && d < best) best = d;
      }
    }
    return best;
  }

  /** Per-frame pass: refresh tank extents, test each handle, flip states. */
  tick() {
    const cam = this.camera;
    const tank = this.tank;
    if (!cam || !tank) return;
    cam.updateMatrixWorld(); // projection/project need current matrices

    // live world extents: tank glass + interior, and the stand below it
    const t = tank.state;
    this._tankBox.min.set(-t.w / 2 - 2, -2, -t.d / 2 - 2);
    this._tankBox.max.set(t.w / 2 + 2, t.h + 2, t.d / 2 + 2);
    if (t.stand) {
      // stand footprint w+8; its top slab spans w+11 → half-width w/2 + 5.5
      this._standBox.min.set(-t.w / 2 - 6, -36, -t.d / 2 - 6);
      this._standBox.max.set(t.w / 2 + 6, 2, t.d / 2 + 6);
    } else {
      this._standBox.copy(this._tankBox); // no stand: harmless double-test
    }
    this._union.copy(this._tankBox).union(this._standBox);

    const sil = this._sil;
    const onScreen =
      this._screenBounds(this._union, sil) &&
      !(sil.maxX < -1 || sil.minX > 1 || sil.maxY < -1 || sil.minY > 1);

    // ---- per-handle frame prep: local frame + screen pre-cull ----
    const candidates = [];
    for (const h of this.handles) {
      h._cand = false;
      h._blocked = false; // fresh each frame (set true during sampling)
      if (h.hideWith && h.hideWith.hidden) continue; // follows its hidden host
      h.root.updateWorldMatrix(true, false);
      this._world.copy(h.bounds).applyMatrix4(h.root.matrixWorld);
      if (!this._screenBounds(this._world, this._scr)) continue;
      if (
        this._scr.maxX < sil.minX ||
        this._scr.minX > sil.maxX ||
        this._scr.maxY < sil.minY ||
        this._scr.minY > sil.maxY
      )
        continue;
      h._cand = true;
      h._inv.copy(h.root.matrixWorld).invert();
      h._tankL.copy(this._tankBox).applyMatrix4(h._inv);
      h._standL.copy(this._standBox).applyMatrix4(h._inv);
      candidates.push(h);
    }

    // ---- test each candidate against every silhouette sample ----
    // A sample is "blocked" for a handle when the handle is hit before the
    // tank/stand along that sample's ray (all tested in handle-local space).
    if (onScreen && candidates.length) {
      const entry = (box) => {
        if (!this._localRay.intersectBox(box, this._hit)) return Infinity;
        return this._hit.distanceTo(this._localRay.origin);
      };
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const x = sil.minX + (sil.maxX - sil.minX) * (gx / (GRID - 1));
          const y = sil.minY + (sil.maxY - sil.minY) * (gy / (GRID - 1));
          if (x < -0.97 || x > 0.97 || y < -0.97 || y > 0.97) continue;
          this._ndc.set(x, y);
          this._ray.setFromCamera(this._ndc, cam);

          for (const h of candidates) {
            if (h._blocked) continue; // already known to block this frame
            // move the ray into this handle's local frame; rigid maps keep
            // distances, and any uniform scale cancels between the two tests
            this._localRay.origin.copy(this._ray.ray.origin);
            this._localRay.direction.copy(this._ray.ray.direction);
            this._localRay.applyMatrix4(h._inv);
            const dView = Math.min(
              entry(h._tankL),
              entry(h._standL),
            );
            if (!(dView > 0) || !Number.isFinite(dView)) continue;
            const d = this._nearest(h, this._localRay);
            if (d > 0 && d < dView) h._blocked = true;
          }
        }
      }
    }

    // ---- flip states (registration order: hosts before dependents) ----
    for (const h of this.handles) {
      if (h.hideWith && h.hideWith.hidden) {
        // mounted piece follows its hidden host
        if (!h.hidden) {
          h.hidden = true;
          h.root.visible = false;
        }
        continue;
      }
      if (h.hidden) {
        if (h._blocked) {
          h._clear = 0;
        } else {
          h._clear++;
          if (h._clear >= CLEAR_FRAMES) {
            h.hidden = false;
            h.root.visible = true;
          }
        }
      } else if (h._blocked) {
        h.hidden = true;
        h._clear = 0;
        h.root.visible = false;
      }
      h._blocked = false; // fresh for next frame
    }
  }
}

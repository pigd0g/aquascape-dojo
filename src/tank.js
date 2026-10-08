// Parametric rimless tank + display stand, water fill, glass material.
import * as THREE from "three";

export class Tank {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "tankRoot";
    scene.add(this.group);

    this.state = {
      w: 60,
      d: 30,
      h: 36,
      glass: "clear",
      waterLevel: 0.8,
      waterOn: false,
      stand: true,
    };
    this.waterMat = null;
    this._surfPhase = 0;
    this._build();
  }

  get innerW() {
    return this.state.w;
  }
  get innerD() {
    return this.state.d;
  }
  get innerH() {
    return this.state.h;
  }

  /** Floor rectangle in group-local coords (tank centered on origin). */
  get floorRect() {
    return {
      x0: -this.state.w / 2,
      z0: -this.state.d / 2,
      w: this.state.w,
      d: this.state.d,
    };
  }

  rebuild(state) {
    Object.assign(this.state, state);
    this._build();
  }

  _build() {
    const g = this.group;
    for (let i = g.children.length - 1; i >= 0; i--) {
      disposeTree(g.children[i]);
      g.remove(g.children[i]);
    }

    const { w, d, h } = this.state;
    const x0 = -w / 2,
      z0 = -d / 2; // centered footprint
    const t = Math.max(0.6, Math.min(1.4, w * 0.014)); // glass thickness

    const glass =
      this.state.glass === "clear"
        ? { tint: 0xf2fbf7, op: 0.15 }
        : { tint: 0x9fd8cc, op: 0.2 };

    // faint-tint transparent glass WITHOUT reflection/refraction:
    // no transmission / ior / thickness / envmap → nothing behind it bends
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: glass.tint,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: glass.op,
      transmission: 0,
      thickness: 0,
      ior: 1.0,
      specularIntensity: 0.08,
      reflectivity: 0.2,
      side: THREE.FrontSide, // box panes: outer faces only — DoubleSided adds a
      // second layer whose gradient bands visibly crawl
      depthWrite: false,
      dithering: true,
    });
    this._glassMat = glassMat;

    // shell from 5 solid glass boxes (walls + bottom)
    const add = (geo, x, y, z, mat = glassMat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 5;
      g.add(mesh);
      return mesh;
    };
    // walls sit on top of the bottom plate (y 0..h), bottom plate spans y -t..0
    add(new THREE.BoxGeometry(w + 2 * t, h, t), 0, h / 2, z0 + d + t / 2); // front
    add(new THREE.BoxGeometry(w + 2 * t, h, t), 0, h / 2, z0 - t / 2); // back
    add(new THREE.BoxGeometry(t, h, d), x0 - t / 2, h / 2, 0); // left
    add(new THREE.BoxGeometry(t, h, d), x0 + w + t / 2, h / 2, 0); // right
    add(new THREE.BoxGeometry(w + 2 * t, t, d + 2 * t), 0, -t / 2, 0); // bottom

    // thin silicone seam along inside bottom edges (subtle dark line)
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0x15151a,
      roughness: 0.55,
      dithering: true,
    });
    const seam = (len, x, y, z, rz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.5), seamMat);
      m.position.set(x, y, z);
      if (rz) m.rotation.y = Math.PI / 2;
      g.add(m);
    };
    seam(w, 0, 0.25, z0 + 0.4);
    seam(w, 0, 0.25, z0 + d - 0.4);
    seam(d, x0 + 0.4, 0.25, 0, true);
    seam(d, x0 + w - 0.4, 0.25, 0, true);

    // stand
    if (this.state.stand) {
      const standH = Math.max(28, Math.round(h * 0.85));
      const sw = w + 8,
        sd = d + 8;
      const standMat = new THREE.MeshStandardMaterial({
        color: 0x17171b,
        roughness: 0.42,
        metalness: 0.25,
        dithering: true,
      });
      const standMat2 = new THREE.MeshStandardMaterial({
        color: 0x1e1e24,
        roughness: 0.5,
        metalness: 0.2,
        dithering: true,
      });
      const stand = new THREE.Group();
      // Cabinet top must NOT sit exactly on the plate's top plane: coincident
      // cast/receive faces z-fight + shadow-acne into hashed stripes across
      // the plate apron. Sink the cabinet 0.05 (0.5mm) into the plate — the
      // larger plate still covers the seam completely.
      const cabH = standH - 4;
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(sw, cabH, sd),
        standMat,
      );
      cabinet.position.set(0, -t - 0.05 - cabH / 2, 0);
      cabinet.castShadow = true;
      cabinet.receiveShadow = true;
      stand.add(cabinet);
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(sw + 3, 3, sd + 3),
        standMat2,
      );
      top.position.set(0, -t - 1.5, 0);
      top.castShadow = true;
      top.receiveShadow = true;
      stand.add(top);
      const kick = new THREE.Mesh(
        new THREE.BoxGeometry(sw - 8, 4, sd - 8),
        standMat2,
      );
      kick.position.set(0, -t - standH + 2, 0);
      stand.add(kick);
      g.add(stand);
    }

    // water body + surface
    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x7fb8c4,
      metalness: 0,
      roughness: 0.06,
      transmission: 0.9,
      thickness: 1.6,
      ior: 1.33,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      dithering: true,
    });
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(w - 1, 1, d - 1),
      this.waterMat,
    );
    water.position.set(0, 0, 0);
    water.scale.y = 0.001;
    water.visible = false;
    water.renderOrder = 6;
    water.name = "water";
    g.add(water);

    const surfGeo = new THREE.PlaneGeometry(w - 1, d - 1, 48, 24);
    const surfMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fd4de,
      metalness: 0,
      roughness: 0.12,
      transmission: 0.75,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      dithering: true,
    });
    this._surfBase = surfGeo.attributes.position.array.slice();
    const surf = new THREE.Mesh(surfGeo, surfMat);
    surf.rotation.x = -Math.PI / 2;
    surf.visible = false;
    surf.renderOrder = 7;
    surf.name = "waterSurf";
    g.add(surf);
  }

  setWater(on, level = this.state.waterLevel) {
    this.state.waterOn = on;
    this.state.waterLevel = level;
    const water = this.group.getObjectByName("water");
    const surf = this.group.getObjectByName("waterSurf");
    if (!water || !surf) return;
    const y = this.state.h * level;
    water.visible = on;
    surf.visible = on;
    if (on) {
      water.scale.y = y;
      water.position.y = y / 2;
      surf.position.y = y;
    }
  }

  /** Gentle ripple animation for the water surface. */
  tick(dt) {
    if (!this.state.waterOn) return;
    const surf = this.group.getObjectByName("waterSurf");
    if (!surf) return;
    this._surfPhase += dt * 1.4;
    const pos = surf.geometry.attributes.position;
    const base = this._surfBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3],
        y = base[i * 3 + 1]; // local plane coords (pre-rotation)
      pos.array[i * 3 + 2] =
        Math.sin(x * 0.25 + this._surfPhase) * 0.14 +
        Math.cos(y * 0.3 + this._surfPhase * 0.8) * 0.12;
    }
    pos.needsUpdate = true;
    surf.geometry.computeVertexNormals();
  }

  dispose() {
    disposeTree(this.group);
  }
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mtl) =>
        mtl.dispose(),
      );
    }
  });
}

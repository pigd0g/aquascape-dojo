// Plant generation — rosettes, ferns, grasses, ribbons, stems, moss fronds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANT_TYPES } from './presets.js';
import { mulberry32, clamp } from './noise.js';

const _up = new THREE.Vector3(0, 1, 0);

function bladeGeometry(len, width, bend, twist = 0, seg = 6) {
  // ribbon along +Y arching over, width in X
  const g = new THREE.BufferGeometry();
  const pos = [], nor = [], uvs = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = len * t;
    // arch: tip bends over
    const off = bend * len * t * t;
    const w = width * (1 - t * 0.65);
    // channel fold (V cross-section)
    for (const side of [-1, 1]) {
      const x = off + side * w * 0.5;
      const z = side * w * 0.18 + Math.sin(t * Math.PI) * twist * side;
      pos.push(x, y, z);
      const n = Math.hypot(w * 0.18, 1);
      nor.push(side * w * 0.18 / n, 0, 1 / n);
      uvs.push(0.5, t);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

function leafGeometryOval(len, width, seg = 5) {
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = len * t;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.08)) * (1 - t * 0.25);
    const off = len * 0.22 * t * t; // slight arch
    for (const side of [-1, 1]) {
      pos.push(off + side * w * 0.5, y, side * w * 0.16);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals(); // was missing → black leaves
  return g;
}

// scratch for mossFrondGeometry — no per-frond allocation
const _tangent = new THREE.Vector3();
const _side = new THREE.Vector3();
const _axisZ = new THREE.Vector3(0, 0, 1);
const _rollQ = new THREE.Quaternion();

/**
 * One java-moss strand: a hair-fine tapering ribbon that rises straight along
 * +Y, then leans over as t²·curl — the tip curling hardest, which is what makes
 * a clump read as draped fuzz instead of standing grass. `wander` sways the
 * centreline sideways and `roll` twists the ribbon cross-section, so strands
 * criss-cross and catch light from every angle; the caller yaws each strand
 * outward and leans it via a quaternion.
 */
function mossFrondGeometry(len, width, curl, wander, roll, seg = 6) {
  // 1) centreline — integrate a heading that curls harder toward the tip
  const cx = [], cy = [], cz = [];
  const step = len / seg;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i <= seg; i++) {
    cx.push(x); cy.push(y); cz.push(z);
    const t = (i + 0.5) / seg;
    const bend = curl * t * t;
    x += Math.sin(bend) * step;
    y += Math.cos(bend) * step;
    // lazy side-to-side wobble; `roll` seeds the phase so no two strands match
    z += Math.sin((i + 0.5) * 1.9 + roll) * wander * step;
  }
  // 2) ribbon cross-section along the centreline
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const i0 = Math.max(0, i - 1), i1 = Math.min(seg, i + 1);
    _tangent.set(cx[i1] - cx[i0], cy[i1] - cy[i0], cz[i1] - cz[i0]).normalize();
    _side.crossVectors(_tangent, _axisZ); // mostly-horizontal ribbon axis
    if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
    else _side.normalize();
    _rollQ.setFromAxisAngle(_tangent, roll * t);
    _side.applyQuaternion(_rollQ);
    const w = width * (0.35 + 0.65 * (1 - t)) * 0.5; // taper toward the tip
    pos.push(cx[i] - _side.x * w, cy[i] - _side.y * w, cz[i] - _side.z * w);
    pos.push(cx[i] + _side.x * w, cy[i] + _side.y * w, cz[i] + _side.z * w);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Rich aquarium-plant green, immune to the gallery rig's highlights.
// Every leaf material passes through here: hue is held inside the green band,
// lightness stays in a narrow dark window calibrated against the ACES response
// of the key/fill/rim/spot/lamp stack (measured pixel probes, not eyeballed):
// pale L>0.2 desaturates to yellow-white under any lit face, L<0.05 turns
// mossy black in shadow. Hue band centres on 0.35 because the warm evening
// lights pull rendered hue ~15° toward yellow — 0.35 lands back on true
// aquarium green (~120°) after lighting.
const GREEN_HUE = [0.30, 0.40];
const LEAF_L = [0.06, 0.105];
const LEAF_S = 0.86;
function makeLeafMaterial(col) {
  // the gallery rig (key+fill+rim+spot+amb) sums to ~4.5× on lit faces —
  // leaves must be authored dark to render rich green instead of clipping
  const hsl = {};
  col.getHSL(hsl);
  // hold hue in the green band (wrap-aware), saturate and darken into the
  // calibrated rich-green window
  let h = ((hsl.h % 1) + 1) % 1;
  if (h > 0.5) h = GREEN_HUE[0];   // reds/violets/magentas wrap to the band floor
  h = Math.max(GREEN_HUE[0], Math.min(GREEN_HUE[1], h));
  col.setHSL(h, Math.max(LEAF_S, hsl.s), Math.max(LEAF_L[0], Math.min(LEAF_L[1], hsl.l)));
  return new THREE.MeshStandardMaterial({
    color: col, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, dithering: true,
  });
}

function makePlant(typeKey, seed = (Math.random() * 1e9) | 0, scaleMul = 1) {
  const def = PLANT_TYPES[typeKey];
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'plantRoot';

  const hBase = def.h ? def.h[0] + rnd() * (def.h[1] - def.h[0]) : 10;
  const H = hBase * scaleMul;

  const green = def.green[0] + rnd() * (def.green[1] - def.green[0]);
  const hue = def.huer[0] + rnd() * (def.huer[1] - def.huer[0]);
  const sat = def.sat[0] + rnd() * (def.sat[1] - def.sat[0]);

  // two leaf tones per plant: base + slightly lighter highlight (both pushed
  // into the calibrated rich-green window by makeLeafMaterial)
  const mat = makeLeafMaterial(new THREE.Color().setHSL(green, sat, 0.095));
  const mat2 = makeLeafMaterial(new THREE.Color().setHSL(clamp(green + 0.03, 0, 1), sat, 0.125));

  const kind = def.kind ?? 'stem';
  const rndRange = (a, b) => a + rnd() * (b - a);

  // ---- kinds ----
  if (kind === 'sword') {
    const leaves = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    // ruffle: fern-style def (widthF >= 5) ruffles all leaves in one direction
    // (classic java-fern blade undulation); broad swords only get the old
    // mild random twist
    const ruffle = def.widthF[0] >= 5 ? 0.9 : 0;
    for (let i = 0; i < leaves; i++) {
      const t = i / leaves;
      const len = H * (0.55 + 0.45 * Math.sin(t * Math.PI) ** 0.7) * (0.8 + rnd() * 0.4);
      const wf = rndRange(def.widthF[0], def.widthF[1]);
      const arch = def.arch * (0.6 + rnd() * 0.8);
      const g = bladeGeometry(len, len / wf, arch, ruffle + (rnd() - 0.5) * 0.6, 7);
      const leaf = new THREE.Mesh(g, i % 3 === 0 ? mat2 : mat);
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
          // outer leaves arch outward, inner stay upright
      const outness = Math.abs(t - 0.5) * 2; // 0 center .. 1 edge
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = a;
      leaf.rotation.x = (rnd() - 0.5) * 0.35 + outness * 0.35;
      leaf.scale.setScalar(0.85);
      leaf.position.y = -0.3;
      leaf.castShadow = true;
      group.add(leaf);
    }
    // crown
    const crown = new THREE.Mesh(new THREE.SphereGeometry(H * 0.06, 8, 6), mat);
    crown.position.y = 0;
    crown.scale.y = 0.6;
    group.add(crown);
  } else if (kind === 'anubias') {
    const leaves = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    // rhizome
    const rzh = new THREE.CylinderGeometry(H * 0.05, H * 0.06, H * 0.5, 6);
    const rzhMesh = new THREE.Mesh(rzh, makeLeafMaterial(new THREE.Color().setHSL(0.28, 0.45, 0.09)));
    rzhMesh.rotation.z = Math.PI / 2;
    rzhMesh.position.y = H * 0.06;
    group.add(rzhMesh);
    for (let i = 0; i < leaves; i++) {
      const len = H * (0.7 + rnd() * 0.5);
      const g = leafGeometryOval(len, len / rndRange(def.widthF[0], def.widthF[1]), 5);
      const leaf = new THREE.Mesh(g, i % 2 ? mat2 : mat);
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.4;
      const tilt = 0.5 + rnd() * 0.5;
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = a;
      leaf.rotation.x = tilt * 0.6;
      leaf.position.y = H * 0.1 + rnd() * H * 0.06;
      leaf.castShadow = true;
      group.add(leaf);
    }
  } else if (kind === 'crypt') {
    const leaves = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    for (let i = 0; i < leaves; i++) {
      const len = H * (0.6 + rnd() * 0.55);
      const petiole = new THREE.Mesh(
        new THREE.CylinderGeometry(len * 0.02, len * 0.025, len * 0.3, 4),
        mat
      );
      const g = leafGeometryOval(len * 0.75, (len * 0.75) / rndRange(def.widthF[0], def.widthF[1]), 5);
      const leaf = new THREE.Mesh(g, i % 2 ? mat2 : mat);
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = a;
      leaf.rotation.x = 0.5 + rnd() * 0.55;
      const px = Math.cos(a) * len * 0.12, pz = Math.sin(a) * len * 0.12;
      leaf.position.set(px, len * 0.28, pz);
      petiole.position.set(px * 0.5, len * 0.15, pz * 0.5);
      petiole.rotation.z = Math.cos(a + Math.PI / 2) * 0.4;
      petiole.rotation.x = Math.sin(a + Math.PI / 2) * 0.4;
      leaf.castShadow = true;
      group.add(petiole, leaf);
    }
  } else if (kind === 'fern') {
    // no current species uses the pinnae fern — kept for save compat with
    // old layouts that spawned one before bolbitis/javafern were reworked
    const fronds = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    const rib = Math.round(rndRange(def.rib[0] ?? 6, def.rib[1] ?? 9));
    for (let i = 0; i < fronds; i++) {
      const len = H * (0.75 + rnd() * 0.4);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.015, len * 0.02, len, 4), mat);
      const a = (i / fronds) * Math.PI * 2 + rnd() * 0.3;
      const tilt = 0.55 + rnd() * 0.5;
      stem.rotation.order = 'YXZ';
      stem.rotation.y = a;
      stem.rotation.x = tilt;
      stem.position.set(Math.cos(a) * len * 0.18, len * 0.42, Math.sin(a) * len * 0.18);
      group.add(stem);
      // pinnae (ribbons along stem)
      const nPin = rib * 2;
      for (let s = 0; s < nPin; s++) {
        const t = 0.15 + (s / nPin) * 0.8;
        const plen = len * 0.34 * Math.sin(Math.PI * (t * 0.75 + 0.2));
        const pg = bladeGeometry(plen, plen * 0.16, 0.85, 0.2, 3);
        const pin = new THREE.Mesh(pg, s % 2 ? mat2 : mat);
        // position along stem
        const along = len * t;
        pin.position.set(
          stem.position.x + Math.cos(a) * along * 0.95,
          stem.position.y - len * 0.5 + along * Math.cos(tilt),
          stem.position.z + Math.sin(a) * along * 0.95
        );
        pin.rotation.y = a + Math.PI / 2 + (s % 2 ? 0.4 : -0.4);
        pin.rotation.z = 0.6;
        pin.castShadow = true;
        group.add(pin);
      }
    }
  } else if (kind === 'grass') {
    const blades = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    const spread = rndRange(def.spread[0], def.spread[1]) * H * 2.2;
    const inst = new THREE.InstancedMesh(bladeGeometry(1, 0.05, 0.5, 0, 4), mat, blades);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < blades; i++) {
      const len = H * (0.6 + rnd() * 0.7);
      const a = rnd() * Math.PI * 2;
      const r = rnd() * spread;
      q.setFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).normalize(), (rnd() - 0.5) * 0.4);
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, len / 2, Math.sin(a) * r),
        q,
        sc.set(len, len, len)
      );
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true;
    group.add(inst);
  } else if (kind === 'ribbon') {
    const leaves = Math.round(rndRange(def.leaves[0], def.leaves[1]));
    for (let i = 0; i < leaves; i++) {
      const len = H * (0.7 + rnd() * 0.5);
      const g = bladeGeometry(len, len * 0.055, (rnd() - 0.3) * 0.25, (rnd() - 0.5) * 1.8, 9);
      const leaf = new THREE.Mesh(g, i % 3 === 0 ? mat2 : mat);
      const a = (i / leaves) * Math.PI * 2 + rnd() * 0.4;
      leaf.rotation.order = 'YXZ';
      leaf.rotation.y = a;
      leaf.rotation.x = (rnd() - 0.5) * 0.25;
      leaf.castShadow = true;
      group.add(leaf);
    }
  } else if (kind === 'stem') {
    // Rotala / Ludwigia: several vertical stems with paired oval leaves
    const stemN = Math.round(rndRange(def.stemN[0], def.stemN[1]));
    const perStem = Math.round(rndRange(def.perStem[0], def.perStem[1]));
    const stemMat = makeLeafMaterial(new THREE.Color().setHSL(green * 0.9, sat, 0.10));
    for (let i = 0; i < stemN; i++) {
      const a = (i / stemN) * Math.PI * 2 + rnd() * 0.6;
      const r = H * 0.08 * rnd();
      const sh = H * (0.75 + rnd() * 0.45); // each stem differs
      const lean = (rnd() - 0.5) * 0.25;
      const stemMesh = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.014, H * 0.02, sh, 5), stemMat);
      stemMesh.position.set(Math.cos(a) * r, sh / 2, Math.sin(a) * r);
      stemMesh.rotation.x = lean;
      stemMesh.rotation.z = (rnd() - 0.5) * 0.2;
      stemMesh.castShadow = true;
      group.add(stemMesh);
      // node pairs along the stem, alternating leaf angle
      for (let n = 0; n < perStem; n++) {
        const t = 0.3 + (n / perStem) * 0.68;
        const llen = sh * (0.24 - t * 0.12) * (0.8 + rnd() * 0.5);
        for (const side of [-1, 1]) {
          const gl = leafGeometryOval(llen, llen * 0.45, 4);
          const leaf = new THREE.Mesh(gl, n % 2 ? mat2 : mat);
          // sit near the stem axis at height t
          const nodeY = sh * t;
          leaf.position.set(Math.cos(a) * r, nodeY, Math.sin(a) * r);
          leaf.rotation.order = 'YXZ';
          leaf.rotation.y = a + (side * (n % 2 ? 1 : -1) + 1) * Math.PI * 0.5 + (rnd() - 0.5) * 0.4;
          leaf.rotation.x = -0.5 - rnd() * 0.3; // upward sweep
          leaf.castShadow = true;
          group.add(leaf);
        }
      }
    }
  } else if (kind === 'moss') {
    // Java moss: a low tangled heap of hair-fine strands — closer to a pile of
    // spaghetti than to grass. Bases fill the upper half of a squashed
    // ellipsoid (so nothing sprouts under the substrate), and strands run
    // mostly HORIZONTALLY — lying across the pile, draping over its flanks —
    // with heavy curl so they loop back on themselves. The heap is
    // deliberately wider than it is tall. Strands merge into one
    // geometry per leaf tone (2 draw calls per patch): per-strand jitter isn't
    // possible with instancing, and it's far cheaper than the old blob patch.
    const Rc = rndRange(def.spread[0], def.spread[1]);   // pile radius (cm)
    const Hi = rndRange(def.height[0], def.height[1]);   // pile height (cm)
    const n = Math.round(rndRange(def.fronds[0], def.fronds[1]));
    const wispN = Math.round(n * 0.03);                   // stray outer threads
    const geos = [[], []];                               // [main tone, highlight]

    for (let i = 0; i < n + wispN; i++) {
      const wisp = i >= n;
      let bx, by, bz, dirX, dirY, dirZ, len, curl;
      if (wisp) {
        // loose threads escaping the heap, like the sprigs in the reference
        const phi = rnd() * Math.PI * 2;
        const rr = Rc * (0.8 + rnd() * 0.4);
        bx = Math.cos(phi) * rr;
        bz = Math.sin(phi) * rr;
        by = Hi * (0.1 + rnd() * 0.5);
        const lean = 0.75 + rnd() * 0.9;      // nearly horizontal: escape sideways
        dirX = Math.sin(lean) * Math.cos(phi + (rnd() - 0.5) * 0.8);
        dirY = Math.cos(lean) * 0.6;
        dirZ = Math.sin(lean) * Math.sin(phi + (rnd() - 0.5) * 0.8);
        len = Rc * (0.55 + rnd() * 0.5);
        curl = 0.5 + rnd() * 0.9;             // wisps stay mostly straight
      } else {
        // base points uniform in the half-ellipsoid volume: cbrt(u) keeps the
        // density even, and c = cosθ ∈ [0,1] trims the lower half so nothing
        // sprouts under the substrate
        const u = Math.cbrt(rnd());
        const c = rnd();
        const s = Math.sqrt(1 - c * c);
        const phi = rnd() * Math.PI * 2;
        bx = u * s * Math.cos(phi) * Rc;
        bz = u * s * Math.sin(phi) * Rc;
        by = u * c * Hi;
        const radial = u * s;                 // 0 core .. 1 rim
        // direction: lying across the pile. Any compass yaw; the height
        // component drops slightly toward the rim so edge strands drape
        // downward over the flanks.
        const yaw = rnd() * Math.PI * 2;
        dirX = Math.cos(yaw);
        dirY = 0.15 * (1 - radial) - 0.3 * radial + (rnd() - 0.5) * 0.25;
        dirZ = Math.sin(yaw);
        len = Rc * (0.3 + rnd() * 0.45);
        curl = 1.6 + rnd() * 2.4;             // tight spaghetti loops
      }
      const wander = 0.6 + rnd() * 1.3;
      const roll = rnd() * Math.PI * 2;
      const width = Rc * 0.009 * (0.7 + rnd() * 0.7);
      const g = mossFrondGeometry(len, width, curl, wander, roll, wisp ? 6 : 7);
      // point the strand along (dirX, dirY, dirZ); the geometry then curls to
      // one side of that axis, and the random extra roll spins which way
      const dir = new THREE.Vector3(dirX, dirY, dirZ).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, rnd() * Math.PI * 2));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(bx, by, bz), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      geos[wisp || rnd() < 0.4 ? 1 : 0].push(g);
    }

    for (let ti = 0; ti < geos.length; ti++) {
      if (!geos[ti].length) continue;
      const merged = mergeGeometries(geos[ti], false);
      geos[ti].forEach((gg) => gg.dispose());
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, ti ? mat2 : mat);
      mesh.castShadow = true;
      group.add(mesh);
    }
    group.userData.spreadR = Rc;
  }

  // overall bounding box
  const bb = new THREE.Box3().setFromObject(group);
  group.userData.kind = 'plant';
  group.userData.typeKey = typeKey;
  group.userData.seed = seed;
  group.userData.def = def;
  group.userData.sizeBase = new THREE.Vector3();
  bb.getSize(group.userData.sizeBase);
  return group;
}

export function createPlant(typeKey, seed, scaleMul) {
  return makePlant(typeKey, seed, scaleMul ?? 1);
}

export function rerollPlant(group, seed, scaleMul) {
  return makePlant(group.userData.typeKey, seed, scaleMul ?? group.scale.x);
}
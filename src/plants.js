// Plant generation — rosettes, ferns, grasses, ribbons, stems, moss fronds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANT_TYPES } from './presets.js';
import { mulberry32, clamp, smoothstep } from './noise.js';

const _up = new THREE.Vector3(0, 1, 0);

// ================= parametric leaf blade =================
// One lamina generator shared by every rosette / epiphyte / stem species.
// A leaf is a curved midrib spine (tip-weighted arch, sideways sway,
// lengthwise twist) skinned by a width profile; each cross-section ring gets
// a V-fold, a midrib keel, a gutter cup and a crisped-margin wave, and every
// vertex carries a baked greyscale value (pale midrib stripe, darker margin,
// soft mottle) that multiplies the calibrated material colour.
//
// Canonical frame: the blade base sits at the origin growing along +Y and
// arching toward +Z, width along ±X. Callers place it with bakeLeaf (the
// placement convention EULER 'YXZ': rotation.y = compass yaw, rotation.x =
// lean away from vertical — same convention the old rosette code used).

// Width profiles as a fraction of the blade's max width, t = 0 base → 1 tip.
const PROFILE = {
  // grass & tape plants: quick ramp out of the sheath, near-constant blade,
  // drawn out to a fine point
  strap: (t) => clamp(0.28 + t * 8, 0.28, 1) * (1 - smoothstep(0.78, 1, t)),
  // widest below the middle, pinched at both ends (sword, crypt, java fern)
  lanceolate: (t) => {
    const s = t < 0.36 ? 0.24 : 0.42;
    return Math.exp(-((t - 0.36) ** 2) / (2 * s * s)) * (1 - smoothstep(0.88, 1, t));
  },
  // broad round blade tapering to a drip tip (anubias, ludwigia)
  ovate: (t) => {
    const s = t < 0.28 ? 0.24 : 0.38;
    return Math.exp(-((t - 0.28) ** 2) / (2 * s * s)) * (1 - smoothstep(0.92, 1, t));
  },
};

function leafGeometry(rnd, o) {
  const seg = o.seg ?? 10;
  const segW = o.segW ?? 4;
  const len = o.len;
  const prof = PROFILE[o.profile] ?? PROFILE.lanceolate;
  const arch = o.arch ?? 0.4;
  const archPow = o.archPow ?? 2.2;
  const swayAmp = Math.abs(o.sway ?? 0) * len;
  const swayPh = o.swayPhase ?? 0;
  const twist = o.twist ?? 0;
  // per-leaf noise phases, drawn from the plant's seeded stream
  const motA = rnd() * Math.PI * 2, motB = rnd() * Math.PI * 2;
  const rufPh = rnd() * Math.PI * 2;
  const rufWaves = o.ruffleWaves ?? 3;
  const tone = o.tone ?? 1;

  // 1) midrib curve — curvature grows toward the tip (t^archPow), so blades
  //    stand up at the base and bow over at the end like real foliage
  const cx = [], cy = [], cz = [];
  let x = 0, y = 0, z = 0, ang = 0;
  const ds = len / seg;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    cx.push(x + swayAmp * Math.sin(t * Math.PI * 1.6 + swayPh) * Math.pow(t, 1.6));
    cy.push(y);
    cz.push(z);
    ang += (arch * archPow * Math.pow(Math.min(1, t + 0.5 / seg), archPow - 1)) / seg;
    y += Math.cos(ang) * ds;
    z += Math.sin(ang) * ds;
  }

  // 2) skin the blade: width profile × shaped cross-section per ring
  const pos = [], uvs = [], col = [], idx = [];
  const T = new THREE.Vector3(), W0 = new THREE.Vector3(), N0 = new THREE.Vector3();
  const Wt = new THREE.Vector3(), Nt = new THREE.Vector3();
  const rowLen = segW + 1;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const i0 = Math.max(0, i - 1), i1 = Math.min(seg, i + 1);
    T.set(cx[i1] - cx[i0], cy[i1] - cy[i0], cz[i1] - cz[i0]).normalize();
    W0.set(1, 0, 0);
    N0.crossVectors(T, W0).normalize(); // ≈ underside direction at the base
    const tau = twist * t;
    const cT = Math.cos(tau), sT = Math.sin(tau);
    // rotate the (width, surface-normal) frame around the midrib (strap twist)
    Wt.copy(W0).multiplyScalar(cT).addScaledVector(N0, sT).normalize();
    Nt.copy(N0).multiplyScalar(cT).addScaledVector(W0, -sT).normalize();

    const ruf = (o.ruffleAmp ?? 0) * o.width * Math.sin(t * rufWaves * Math.PI * 2 + rufPh);
    const wHalf = Math.max(0.004, 0.5 * o.width * prof(t) * (1 + 0.05 * Math.sin(t * 5.3 + motB)));
    for (let k = 0; k <= segW; k++) {
      const s = (k / segW) * 2 - 1; // -1 .. 1 across the blade
      const a = Math.abs(s);
      const zoff =
        (o.fold ?? 0) * o.width * a -                                  // V-fold: margins lift
        (o.rib ?? 0) * o.width * (1 - a) * (1 - a) * (1 - t * 0.4) +   // midrib keel
        (o.cup ?? 0) * o.width * s * s +                               // gutter cup
        ruf * s * a;                                                   // crisped margin wave
      pos.push(
        cx[i] + Wt.x * s * wHalf + Nt.x * zoff,
        cy[i] + Wt.y * s * wHalf + Nt.y * zoff,
        cz[i] + Wt.z * s * wHalf + Nt.z * zoff
      );
      uvs.push(k / segW, t);
      // per-vertex value (multiplies the material colour) — kept ≤1 so lit
      // faces never exceed the calibrated albedo window and clip to pale sage
      let v = (0.88 + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.06))) * tone;
      v *= 1 + 0.05 * Math.sin(t * 7.3 + motA + s * 2.1) * Math.cos(t * 2.9 - motB + s * 4.2);
      const ribW = 0.24 * (1 - t * 0.4);
      if (o.midrib && a < ribW) v += o.midrib * (1 - a / ribW) * 0.45;
      if (o.margin) v *= 1 - o.margin * smoothstep(0.7, 1, a);
      v = clamp(v, 0.3, 1.0);
      col.push(v, v, v);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < segW; k++) {
      const a0 = i * rowLen + k, b0 = a0 + 1, a1 = a0 + rowLen, b1 = a1 + 1;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// every geometry merged into a leaf bucket needs the same attribute set, so
// tubes/spheres get a constant (optionally channel-tinted) colour attribute
function fillColor(geo, r, g = r, b = g) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// bake a canonical leaf (+Y up, arching toward +Z) into world space
const _euler = new THREE.Euler();
function bakeLeaf(geo, x, y, z, yaw, lean, roll = 0) {
  _euler.set(lean, yaw, roll, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(_euler);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

function bakeQ(geo, pos, q) {
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

// arcing petiole/stipe: quadratic-bezier tube, midpoint lifted for a natural
// upward bow; built directly in world coordinates (no bake step). `shade` is
// the baked vertex value — petioles sit in each other's shade, keep them dark
function petioleGeometry(rnd, p0, dir, len, r, bow = 0.22, shade = 0.72) {
  const p1 = p0.clone().addScaledVector(dir, len);
  const ctrl = p0.clone().addScaledVector(dir, len * 0.55);
  ctrl.y += len * bow;
  ctrl.x += (rnd() - 0.5) * len * 0.12;
  ctrl.z += (rnd() - 0.5) * len * 0.12;
  const curve = new THREE.QuadraticBezierCurve3(p0, ctrl, p1);
  return fillColor(new THREE.TubeGeometry(curve, 7, r, 5, false), shade + rnd() * 0.1);
}

// creeping horizontal rhizome (anubias / java fern): a wandering curve near
// the substrate — returns the curve so callers can node leaves along it
function rhizomeCurve(rnd, len, y, yaw) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const p = new THREE.Vector3(
      (t - 0.5) * len,
      y * (0.6 + rnd() * 0.8),
      (rnd() - 0.5) * len * 0.22
    );
    p.applyAxisAngle(_up, yaw);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function mergeInto(group, geos, material) {
  if (!geos.length) return;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  group.add(mesh);
}

// ================= species builders =================
// Each writes into acc.A / acc.B (leaf blades, base/highlight tone) and acc.S
// (petioles, stems, rhizomes, crowns) in world space; makePlant merges the
// buckets into at most three meshes per plant.

const GOLDEN = 2.399963229728653; // phyllotactic golden angle

function dirOf(yaw, lean, out) {
  const sl = Math.sin(lean);
  return out.set(Math.sin(yaw) * sl, Math.cos(lean), Math.cos(yaw) * sl);
}

// Echinodorus: true rosette — leaf = petiole + lanceolate blade, outer leaves
// long & low, young inner leaves short & erect, golden-angle phyllotaxis
function growSword(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const leaves = Math.round(rr(def.leaves));
  const crownR = H * 0.045;
  const crown = fillColor(new THREE.SphereGeometry(crownR, 8, 6), 0.72);
  crown.scale(1, 0.55, 1);
  crown.translate(0, crownR * 0.45, 0);
  acc.S.push(crown);
  const p0 = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const t = i / Math.max(1, leaves - 1); // 0 outer/old → 1 inner/young
    const petLen = H * (0.26 + rnd() * 0.12);
    const bladeLen = H * (0.5 + 0.3 * Math.sin(Math.PI * clamp(0.18 + t * 0.72, 0, 1))) * (0.85 + rnd() * 0.3);
    const yaw = i * GOLDEN + (rnd() - 0.5) * 0.5;
    const lean = clamp(1.02 - t * 0.72 + (rnd() - 0.5) * 0.16, 0.12, 1.25);
    dirOf(yaw, lean, dir);
    const a2 = rnd() * Math.PI * 2;
    p0.set(Math.cos(a2) * crownR * 0.8, crownR * (0.4 + t * 1.2), Math.sin(a2) * crownR * 0.8);
    acc.S.push(petioleGeometry(rnd, p0, dir, petLen, Math.max(0.07, bladeLen * 0.011)));
    const p1 = p0.clone().addScaledVector(dir, petLen);
    const g = leafGeometry(rnd, {
      len: bladeLen,
      width: bladeLen / rr(def.widthF),
      profile: 'lanceolate',
      arch: (0.3 + rnd() * 0.4) * (def.arch ?? 0.6) * 1.5,
      archPow: 2.6,
      fold: 0.09 + rnd() * 0.05,
      cup: 0.06 + rnd() * 0.05,
      rib: 0.08,
      ruffleAmp: (def.rufAmp ?? 0.05) * (0.6 + rnd() * 0.8),
      ruffleWaves: def.rufWaves ?? 3,
      midrib: 0.15,
      margin: 0.05,
      twist: (rnd() - 0.5) * 0.4,
      tone: t > 0.5 ? 0.97 + rnd() * 0.06 : 0.9 + rnd() * 0.1,
      seg: 11, segW: 6,
    });
    bakeLeaf(g, p1.x, p1.y, p1.z, yaw, lean);
    acc[t > 0.5 ? (rnd() < 0.7 ? 'B' : 'A') : (rnd() < 0.25 ? 'B' : 'A')].push(g);
  }
}

// Java fern: leathery narrow fronds nodded alternately along a creeping
// rhizome, mildly crisped margins, even leathery droop
function growJavafern(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const leaves = Math.round(rr(def.leaves));
  const curve = rhizomeCurve(rnd, H * 0.55, H * 0.05, rnd() * Math.PI * 2);
  acc.S.push(fillColor(new THREE.TubeGeometry(curve, 14, H * 0.016 + 0.03, 6, false), 0.62, 0.6, 0.5));
  const dir = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const ti = 0.05 + (i / Math.max(1, leaves - 1)) * 0.92;
    const p0 = curve.getPoint(ti);
    const side = i % 2 ? 1 : -1;
    const yaw = Math.atan2(p0.x, p0.z) + side * (0.6 + rnd() * 1.0) + (rnd() - 0.5) * 0.4;
    const lean = 0.12 + rnd() * 0.4;
    const frond = H * (0.7 + rnd() * 0.55);
    dirOf(yaw, lean, dir);
    const stipe = frond * 0.08;
    acc.S.push(petioleGeometry(rnd, p0, dir, stipe, Math.max(0.04, frond * 0.004), 0.22, 0.62));
    const p1 = p0.clone().addScaledVector(dir, stipe);
    const g = leafGeometry(rnd, {
      len: frond,
      width: frond / rr(def.widthF),
      profile: 'lanceolate',
      arch: 0.3 + rnd() * 0.45 + (def.arch ?? 0.2),
      archPow: 1.9,
      fold: 0.2 + rnd() * 0.08,
      cup: 0.05,
      rib: 0.09,
      ruffleAmp: (def.rufAmp ?? 0.09) * (0.7 + rnd() * 0.6),
      ruffleWaves: def.rufWaves ?? 3.5,
      midrib: 0.12,
      margin: 0.06,
      twist: (rnd() - 0.5) * 0.6,
      tone: 0.9 + rnd() * 0.1,
      seg: 14, segW: 4,
    });
    bakeLeaf(g, p1.x, p1.y, p1.z, yaw, lean);
    acc[rnd() < 0.3 ? 'B' : 'A'].push(g);
  }
}

// Anubias: thick creeping rhizome, glossy ovate blades on long petioles held
// out in a fan, gutter-cupped with a drip tip
function growAnubias(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const leaves = Math.round(rr(def.leaves));
  const curve = rhizomeCurve(rnd, H * 0.7, H * 0.055, rnd() * Math.PI * 2);
  acc.S.push(fillColor(new THREE.TubeGeometry(curve, 14, H * 0.028, 6, false), 0.6, 0.62, 0.48));
  const dir = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const ti = 0.04 + (i / Math.max(1, leaves - 1)) * 0.94;
    const p0 = curve.getPoint(ti);
    const side = i % 2 ? 1 : -1;
    const yaw = Math.atan2(p0.x, p0.z) + side * (0.9 + rnd() * 0.8) + (rnd() - 0.5) * 0.4;
    const lean = 0.5 + rnd() * 0.45;
    const bladeLen = H * (0.42 + rnd() * 0.3);
    const petLen = bladeLen * (0.55 + rnd() * 0.4);
    dirOf(yaw, lean, dir);
    acc.S.push(petioleGeometry(rnd, p0, dir, petLen, Math.max(0.05, bladeLen * 0.014), 0.3, 0.6));
    const p1 = p0.clone().addScaledVector(dir, petLen);
    const g = leafGeometry(rnd, {
      len: bladeLen,
      width: bladeLen / rr(def.widthF),
      profile: 'ovate',
      arch: 0.16 + rnd() * 0.2,
      archPow: 3,
      fold: 0.09 + rnd() * 0.04,
      cup: 0.13 + rnd() * 0.06,
      rib: 0.06,
      ruffleAmp: 0.045 * (0.6 + rnd() * 0.8),
      ruffleWaves: 2.5,
      midrib: 0.12,
      margin: 0.07,
      twist: (rnd() - 0.5) * 0.2,
      tone: 0.9 + rnd() * 0.1,
      seg: 10, segW: 6,
    });
    bakeLeaf(g, p1.x, p1.y, p1.z, yaw, lean);
    acc[rnd() < 0.35 ? 'B' : 'A'].push(g);
  }
}

// Cryptocoryne: low sprawling rosette of petioled lanceolate leaves with the
// classic crisped (hammered) margins and a strong pale midrib
function growCrypt(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const leaves = Math.round(rr(def.leaves));
  const crownR = H * 0.03;
  const dir = new THREE.Vector3();
  for (let i = 0; i < leaves; i++) {
    const t = i / Math.max(1, leaves - 1);
    const bladeLen = H * (0.52 + rnd() * 0.42);
    const petLen = bladeLen * (0.3 + rnd() * 0.18);
    const yaw = i * GOLDEN + (rnd() - 0.5) * 0.5;
    const lean = clamp(1.18 - t * 0.6 + (rnd() - 0.5) * 0.2, 0.2, 1.35);
    dirOf(yaw, lean, dir);
    const p0 = new THREE.Vector3((rnd() - 0.5) * crownR, 0, (rnd() - 0.5) * crownR);
    acc.S.push(petioleGeometry(rnd, p0, dir, petLen, Math.max(0.045, bladeLen * 0.009), 0.22, 0.68));
    const p1 = p0.clone().addScaledVector(dir, petLen);
    const g = leafGeometry(rnd, {
      len: bladeLen,
      width: bladeLen / rr(def.widthF),
      profile: 'lanceolate',
      arch: (0.3 + rnd() * 0.35) * (def.arch ?? 0.55) + 0.12,
      archPow: 2.3,
      fold: 0.14 + rnd() * 0.08,
      cup: 0.06,
      rib: 0.12,
      ruffleAmp: (def.rufAmp ?? 0.15) * (0.7 + rnd() * 0.7),
      ruffleWaves: def.rufWaves ?? 4,
      midrib: 0.17,
      margin: 0.09,
      twist: (rnd() - 0.5) * 0.5,
      tone: 0.88 + rnd() * 0.12,
      seg: 13, segW: 6,
    });
    bakeLeaf(g, p1.x, p1.y, p1.z, yaw, lean);
    acc[t > 0.55 ? (rnd() < 0.65 ? 'B' : 'A') : (rnd() < 0.25 ? 'B' : 'A')].push(g);
  }
}

// Hairgrass / blyxa: a clump of individually-grown strap blades (merged, not
// instanced, so every blade arches, twists and leans differently)
function growGrass(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const blades = Math.round(rr(def.leaves));
  const clumpR = rr(def.spread) * H * 2.0;
  const wl = def.wl ?? [0.05, 0.09];
  const leanF = def.leanF ?? 0.3;
  const archR = def.archR ?? [0.3, 0.65];
  const twistF = def.twist ?? 0.4;
  const swayF = def.sway ?? 0.02;
  for (let i = 0; i < blades; i++) {
    const rr0 = Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const bx = Math.cos(a) * rr0 * clumpR;
    const bz = Math.sin(a) * rr0 * clumpR;
    const yaw = Math.atan2(bx, bz) + (rnd() - 0.5) * 0.9;
    const len = H * (0.62 + rnd() * 0.65);
    const lean = 0.06 + rr0 * leanF + rnd() * 0.13;
    const g = leafGeometry(rnd, {
      len,
      width: rr(wl),
      profile: 'strap',
      arch: rr(archR),
      archPow: def.archPow ?? 2.6,
      fold: 0.22 + rnd() * 0.1,
      cup: 0.04,
      rib: 0.05,
      ruffleAmp: 0.02 * rnd(),
      ruffleWaves: 2,
      twist: (rnd() - 0.5) * 2 * twistF,
      sway: swayF * (0.5 + rnd()),
      swayPhase: rnd() * Math.PI * 2,
      tone: 0.88 + rnd() * 0.14,
      seg: 8, segW: 4,
    });
    bakeLeaf(g, bx, 0, bz, yaw, lean);
    acc[rnd() < 0.3 ? 'B' : 'A'].push(g);
  }
}

// Vallisneria: a rosette of long tape straps, nearly erect, spiralling gently
// with a soft S-sway and only the tips bowing over; young heart-leaves short
function growRibbon(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const leaves = Math.round(rr(def.leaves));
  const wl = def.wl ?? [0.55, 0.85];
  for (let i = 0; i < leaves + 2; i++) {
    const young = i >= leaves;
    const a = rnd() * Math.PI * 2;
    const r0 = Math.sqrt(rnd()) * H * 0.03 + (young ? 0 : 0.1);
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const yaw = i * GOLDEN + (rnd() - 0.5) * 0.6;
    const lean = young ? 0.02 + rnd() * 0.05 : (rnd() - 0.5) * 0.22 + 0.06;
    const len = H * (young ? 0.42 + rnd() * 0.12 : 0.78 + rnd() * 0.4);
    const g = leafGeometry(rnd, {
      len,
      width: rr(wl) * (young ? 0.7 : 1),
      profile: 'strap',
      arch: young ? 0.08 : 0.16 + rnd() * 0.4,
      archPow: 3.4,
      fold: 0.12 + rnd() * 0.06,
      cup: 0.03,
      rib: 0.07,
      ruffleAmp: 0.02 + rnd() * 0.03,
      ruffleWaves: 2.5,
      midrib: 0.1,
      margin: 0.03,
      twist: (0.6 + rnd() * 1.6) * (rnd() < 0.5 ? -1 : 1),
      sway: 0.05 + rnd() * 0.09,
      swayPhase: rnd() * Math.PI * 2,
      tone: (young ? 1.0 : 0.9) + rnd() * 0.1,
      seg: 14, segW: 4,
    });
    bakeLeaf(g, bx, 0, bz, yaw, lean);
    acc[young || rnd() < 0.25 ? 'B' : 'A'].push(g);
  }
}

// Ludwigia: several gently-leaning stems with decussate leaf pairs (each node
// rotated 90° from the last), leaves shrinking ups stem, apical whorl at tip
function growStem(rnd, def, H, acc) {
  const rr = (r) => r[0] + rnd() * (r[1] - r[0]);
  const stemN = Math.round(rr(def.stemN));
  const perStem = Math.round(rr(def.perStem));
  const dir = new THREE.Vector3(), pt = new THREE.Vector3(), tan = new THREE.Vector3();
  const ldir = new THREE.Vector3(), hdir = new THREE.Vector3();
  for (let s = 0; s < stemN; s++) {
    const a0 = rnd() * Math.PI * 2;
    const r0 = H * (0.02 + rnd() * 0.08);
    const p0 = new THREE.Vector3(Math.cos(a0) * r0, 0, Math.sin(a0) * r0);
    const sh = H * (0.78 + rnd() * 0.42);
    const yaw = Math.atan2(p0.x, p0.z) + (rnd() - 0.5) * 1.2;
    const lean = 0.05 + rnd() * 0.22;
    dirOf(yaw, lean, dir);
    const p1 = p0.clone().addScaledVector(dir, sh);
    const ctrl = p0.clone().addScaledVector(dir, sh * 0.55);
    ctrl.y += sh * 0.07;
    ctrl.x += (rnd() - 0.5) * sh * 0.08;
    ctrl.z += (rnd() - 0.5) * sh * 0.08;
    const curve = new THREE.QuadraticBezierCurve3(p0, ctrl, p1);
    acc.S.push(fillColor(
      new THREE.TubeGeometry(curve, 12, Math.max(0.035, H * 0.012), 5, false),
      0.62 + rnd() * 0.1, 0.58, 0.55
    ));
    const baseYaw = rnd() * Math.PI * 2;
    for (let n = 0; n < perStem; n++) {
      const t = 0.16 + (n / perStem) * 0.8;
      curve.getPoint(t, pt);
      curve.getTangent(t, tan);
      const llen = sh * (0.15 - 0.06 * t) * (0.85 + rnd() * 0.35);
      for (let side = 0; side < 2; side++) {
        const yawL = baseYaw + n * (Math.PI / 2) + side * Math.PI + (rnd() - 0.5) * 0.25;
        const el = 0.38 + rnd() * 0.35; // leaf elevation above horizontal
        hdir.set(Math.sin(yawL), 0, Math.cos(yawL));
        ldir.copy(hdir).multiplyScalar(Math.cos(el)).addScaledVector(tan, Math.sin(el)).normalize();
        const g = leafGeometry(rnd, {
          len: llen,
          width: llen / (1.8 + rnd() * 0.6),
          profile: 'ovate',
          arch: 0.1 + rnd() * 0.2,
          archPow: 2.4,
          fold: 0.1 + rnd() * 0.06,
          cup: 0.09 + rnd() * 0.06,
          rib: 0.05,
          ruffleAmp: 0.03 + rnd() * 0.03,
          ruffleWaves: 2.5,
          midrib: 0.07,
          margin: 0.04,
          twist: (rnd() - 0.5) * 0.3,
          tone: 0.9 + rnd() * 0.12,
          seg: 7, segW: 4,
        });
        const q = new THREE.Quaternion().setFromUnitVectors(_up, ldir);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, (rnd() - 0.5) * 1.2));
        bakeQ(g, pt, q);
        acc[n % 2 ? (rnd() < 0.7 ? 'B' : 'A') : 'A'].push(g);
      }
    }
    // apical whorl — four short pale leaves crowding the stem tip
    const tip = curve.getPoint(0.98);
    curve.getTangent(0.98, tan);
    for (let k = 0; k < 4; k++) {
      const yawL = baseYaw + k * (Math.PI / 2) + (rnd() - 0.5) * 0.3;
      hdir.set(Math.sin(yawL), 0, Math.cos(yawL));
      ldir.copy(hdir).multiplyScalar(0.45).addScaledVector(tan, 0.9).normalize();
      const llen = sh * 0.08 * (0.8 + rnd() * 0.4);
      const g = leafGeometry(rnd, {
        len: llen,
        width: llen / 1.7,
        profile: 'ovate',
        arch: 0.08, archPow: 2.4,
        fold: 0.08, cup: 0.08, rib: 0.04,
        midrib: 0.06,
        tone: 0.98 + rnd() * 0.05,
        seg: 6, segW: 4,
      });
      const q = new THREE.Quaternion().setFromUnitVectors(_up, ldir);
      bakeQ(g, tip, q);
      acc.B.push(g);
    }
  }
}

// ================= moss (unchanged) =================
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
function makeLeafMaterial(col, opts = {}) {
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
    color: col,
    roughness: opts.roughness ?? 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
    dithering: true,
    vertexColors: !!opts.vertexColors,
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

  const rndRange = (a, b) => a + rnd() * (b - a);
  // old saves may name the removed pinnae-fern kind; grow java fern instead
  let kind = def.kind ?? 'stem';
  if (kind === 'fern') kind = 'javafern';

  // two leaf tones per plant: base + slightly lighter highlight (both pushed
  // into the calibrated rich-green window by makeLeafMaterial). Moss keeps
  // flat albedo materials; every other kind gets vertex-colored blades whose
  // baked per-vertex shading multiplies these tones.
  const mat = makeLeafMaterial(new THREE.Color().setHSL(green, sat, 0.095),
    kind === 'moss' ? {} : { vertexColors: true, roughness: def.rough ?? 0.8 });
  const mat2 = makeLeafMaterial(new THREE.Color().setHSL(clamp(green + 0.03, 0, 1), sat, 0.125),
    kind === 'moss' ? {} : { vertexColors: true, roughness: def.rough ?? 0.8 });
  const stemMat = kind === 'moss' ? null : makeLeafMaterial(
    new THREE.Color().setHSL(clamp(green + hue - 0.02, 0, 1), sat * 0.92, 0.085),
    { vertexColors: true, roughness: Math.min(0.95, (def.rough ?? 0.8) + 0.15) }
  );

  // ---- kinds ----
  const acc = { A: [], B: [], S: [] };
  if (kind === 'moss') {
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
  } else {
    if (kind === 'sword') growSword(rnd, def, H, acc);
    else if (kind === 'javafern') growJavafern(rnd, def, H, acc);
    else if (kind === 'anubias') growAnubias(rnd, def, H, acc);
    else if (kind === 'crypt') growCrypt(rnd, def, H, acc);
    else if (kind === 'grass') growGrass(rnd, def, H, acc);
    else if (kind === 'ribbon') growRibbon(rnd, def, H, acc);
    else if (kind === 'stem') growStem(rnd, def, H, acc);
    mergeInto(group, acc.A, mat);
    mergeInto(group, acc.B, mat2);
    mergeInto(group, acc.S, stemMat);
  }

  // overall bounding box
  const bb = new THREE.Box3().setFromObject(group);
  group.userData.kind = 'plant';
  group.userData.typeKey = typeKey;
  group.userData.seed = seed;
  group.userData.def = def;
  group.userData.sizeBase = new THREE.Vector3();
  bb.getSize(group.userData.sizeBase);
  if (!Number.isFinite(group.userData.sizeBase.x)) group.userData.sizeBase.set(H, H, H);
  return group;
}

export function createPlant(typeKey, seed, scaleMul) {
  return makePlant(typeKey, seed, scaleMul ?? 1);
}

export function rerollPlant(group, seed, scaleMul) {
  return makePlant(group.userData.typeKey, seed, scaleMul ?? group.scale.x);
}

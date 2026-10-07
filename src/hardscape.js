// Procedural rock generation — noise-displaced icospheres with per-type character.
import * as THREE from 'three';
import { ROCK_TYPES } from './presets.js';
import { mulberry32, fbm, ridge, clamp, smoothstep, hueShiftRGB } from './noise.js';

const _c = new THREE.Color();

export function createRock(typeKey, seed = (Math.random() * 1e9) | 0, opts = {}) {
  const def = ROCK_TYPES[typeKey];
  const rnd = mulberry32(seed);
  // IcosahedronGeometry subdivides each edge `detail` times → 20*(detail+1)^2
  // triangles. 30 ≈ 19.2k tris / 57k verts — smooth-shaded rounded rocks.
  const detail = opts.detail ?? 30;

  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  // cache unit direction + base radius per vertex
  const dirs = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    dirs[i * 3] = v.x; dirs[i * 3 + 1] = v.y; dirs[i * 3 + 2] = v.z;
  }

  const sc = def.scaleNoise;
  const strataF = def.strata ? def.strataFreq : 0;
  const strataA = def.strata ? def.strataAmp : 0;
  const angular = def.angular ?? 0.3;
  const crev = def.crevices ?? 0.3;
  const smoothAmt = def.smooth ?? 0.2;

  // per-seed noise offset — different seeds sample different regions of the
  // noise field, so rerolling genuinely regrows the silhouette
  const ox = rnd() * 250, oy = rnd() * 250, oz = rnd() * 250;
  // per-seed squash: flatten or elongate along random axes
  // (flattened types like river pebbles keep the squash horizontal only,
  //  and never let Y exceed X so they always read as lying flat)
  const squashY = def.flatten ? 0.15 : 0.55;
  let sqx = 1 + (rnd() - 0.5) * 0.55;
  let sqy = 1 + (rnd() - 0.5) * squashY;
  if (def.flatten && sqy > sqx) sqy = sqx * 0.92;
  const sq = new THREE.Vector3(sqx, sqy, 1 + (rnd() - 0.5) * 0.55);

  for (let i = 0; i < pos.count; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    const sx = dx * sc + 10 + ox, sy = dy * sc + 10 + oy, sz = dz * sc + 10 + oz;
    let dr = 0;

    // base lumpiness
    let lump = fbm(sx, sy, sz, 4) - 0.5;
    dr += lump * 0.62;

    // faceting: quantize direction to create flat-ish planes (angular stones)
    if (angular > 0.01) {
      const q = 2.0 + angular * 5.5;
      const qx = Math.round(dx * q) / q, qy = Math.round(dy * q) / q, qz = Math.round(dz * q) / q;
      const dotp = dx * qx + dy * qy + dz * qz;
      dr += (dotp - 1) * angular * 0.9;
    }

    // strata layers (horizontal bands / vertical for slate)
    if (strataF) {
      const coord = def.strataY ? dy : Math.abs(dy) * 0.4 + (dz * 0.3 + dx * 0.2);
      const band = Math.sin(coord * strataF) * 0.5 + 0.5;
      dr -= (1 - band) * strataA;
      dr += band > 0.8 ? 0.02 : 0;
    }

    // ridged crevices
    const rv = ridge(sx * 0.8, sy * 0.8, sz * 0.8, 3);
    dr -= (1 - rv) * crev * 0.55;

    // fine grain
    dr += (fbm(sx * 3.2, sy * 3.2, sz * 3.2, 2) - 0.5) * 0.07 * smoothAmt + smoothAmt * 0.04;

    let r = 1 + dr;
    pos.array[i * 3] = dx * r * sq.x;
    pos.array[i * 3 + 1] = dy * r * sq.y;
    pos.array[i * 3 + 2] = dz * r * sq.z;
  }

  // waterworn flattening (river pebbles): squash vertically & relax lumpiness
  if (def.flatten) {
    for (let i = 0; i < pos.count; i++) {
      // relax displacement toward a smooth ellipsoid, then squash
      pos.array[i * 3 + 1] = pos.array[i * 3 + 1] * 0.25 + 0.75 * dirs[i * 3 + 1] * sq.y * 0.48;
    }
  }
  geo.computeVertexNormals();

  // vertex colors: strata banding, veins, dirt pooling
  const colors = new Float32Array(pos.count * 3);
  const tintChoices = def.tints;
  const tintIdx = tintChoices.length > 1 ? (rnd() * tintChoices.length) | 0 : 0;
  const baseCol = new THREE.Color(def.base);
  const tintCol = new THREE.Color(tintChoices[tintIdx]);
  const mixCol = baseCol.clone().lerp(tintCol, 0.45);
  const hueJitter = (rnd() - 0.5) * 0.04;

  for (let i = 0; i < pos.count; i++) {
    const dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
    const sx = dx * sc + 10 + ox, sy = dy * sc + 10 + oy, sz = dz * sc + 10 + oz;
    const shade = fbm(dx * 5 + 31, dy * 5, dz * 5, 3);
    _c.copy(mixCol);
    // strata dark banding (lower frequency than the geometry's so bands stay
    // readable at high poly — color banding, not per-vertex noise)
    if (def.strata && strataF) {
      const coord = def.strataY ? dy : Math.abs(dy) * 0.4 + (dz * 0.3 + dx * 0.2);
      const band = Math.sin(coord * strataF * 0.45) * 0.5 + 0.5;
      _c.multiplyScalar(0.72 + band * 0.38);
    }
    // subtle hue jitter
    const [r1, g1, b1] = hueShiftRGB(_c.r, _c.g, _c.b, hueJitter);
    _c.set(r1, g1, b1);
    if (def.colorFlat) {
      // smooth waterworn stones: only a whisper of variation, no blotches —
      // blotchy shading + low roughness reads as metal, not mineral
      _c.multiplyScalar(0.94 + shade * 0.09);
    } else {
      // crevice darkening: sample same shifted noise field as the displacement
      const rv = ridge(sx * 0.8, sy * 0.8, sz * 0.8, 3);
      const dark = 1 - (1 - rv) * crev * 0.8;
      _c.multiplyScalar(clamp(0.38 + shade * 0.58, 0.24, 1.05) * dark);
      // dirt pooling on upward faces
      const up = smoothstep(0.55, 1, dy);
      _c.lerp(new THREE.Color(0x4a3b2c).convertSRGBToLinear(), up * 0.15);
    }
    // vertex colors are consumed as linear-sRGB by the renderer — we authored
    // in sRGB, so convert once or everything renders washed-out pale
    _c.convertSRGBToLinear();
    colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: def.rough,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;

  // rest orientation
  mesh.rotation.y = rnd() * Math.PI * 2;
  if (typeKey === 'seiryu') mesh.rotation.z = (rnd() - 0.5) * 0.2;

  // bounding data
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);

  mesh.userData = {
    kind: 'rock', typeKey, seed,
    def,
    sizeBase: size.clone(),
    kgPerL: def.kgPerL,
  };
  return mesh;
}

/** Re-roll an existing rock's shape in place (keeps transform). */
export function rerollRock(mesh, seed) {
  const fresh = createRock(mesh.userData.typeKey, seed);
  fresh.position.copy(mesh.position);
  fresh.rotation.copy(mesh.rotation);
  fresh.scale.copy(mesh.scale);
  return fresh;
}
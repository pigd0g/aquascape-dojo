// Procedural rock generation — simplex-noise displaced solids with per-type
// character. The shape formulas mirror the design prototype; every knob lives
// in `ROCK_TYPES[type].params` (presets.js) and is editable live in the
// inspector (Geometry & noise / Transform / Material).
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROCK_TYPES } from './presets.js';
import { mulberry32, clamp } from './noise.js';

// One shared noise field, seeded once: shapes must rebuild identically after a
// save/load, so nothing may depend on Math.random(). Per-stone variety comes
// from `seedOffset`, which samples a different region of the same field.
const noise3D = createNoise3D(mulberry32(0x5eed));

const SEED_SPAN = 100;      // Random seed slider range (matches the prototype)
const RES_MIN = 8;
const RES_MAX = 128;

/** Spawn seed (integer) → Random-seed slider value, 0..100. Stable per seed. */
export function seedToOffset(seed) {
  return (((seed ?? 0) >>> 0) % (SEED_SPAN * 1000)) / 1000;
}

function clampRes(v) {
  const r = Math.round(+v);
  return Number.isFinite(r) ? Math.max(RES_MIN, Math.min(RES_MAX, r)) : RES_MIN;
}

/** Type defaults + saved overrides, normalised (seed-derived offset last). */
export function resolveRockParams(typeKey, seed, overrides) {
  const def = ROCK_TYPES[typeKey] ?? ROCK_TYPES.ohko;
  const p = { ...def.params, ...(overrides ?? {}) };
  if (overrides?.seedOffset == null) p.seedOffset = seedToOffset(seed);
  p.resolution = clampRes(p.resolution);
  return p;
}

// ---------------- shape formulas ----------------
// Each returns a radius multiplier for a unit direction. `seedOffset` shifts
// the sampled noise region; all other values come straight from params.

const SPHERE_SHAPES = {
  ohko(v, p) {
    const noise = noise3D(
      v.x * p.baseFrequency + p.seedOffset, v.y * p.baseFrequency, v.z * p.baseFrequency
    ) * p.baseAmplitude;
    let crevice = Math.abs(noise3D(
      v.x * p.detailFrequency, v.y * (p.detailFrequency * 1.5), v.z * p.detailFrequency
    ));
    crevice = Math.pow(crevice, 2.5) * p.detailAmplitude;
    return 1.2 + noise - crevice;
  },
  seiryu(v, p) {
    let ridge = 1 - Math.abs(noise3D(
      v.x * p.detailFrequency + p.seedOffset,
      v.y * p.detailFrequency,
      v.z * p.detailFrequency
    ));
    ridge = Math.pow(ridge, 3) * p.detailAmplitude;
    const noise = noise3D(
      v.x * p.baseFrequency, v.y * p.baseFrequency, v.z * p.baseFrequency
    ) * p.baseAmplitude;
    return 1.0 + ridge + noise;
  },
  lava(v, p) {
    const base = noise3D(
      v.x * p.baseFrequency + p.seedOffset, v.y * p.baseFrequency, v.z * p.baseFrequency
    ) * p.baseAmplitude;
    let pore = noise3D(v.x * p.detailFrequency, v.y * p.detailFrequency, v.z * p.detailFrequency);
    pore = pore > 0.2 ? pore * p.detailAmplitude : 0;
    return 1.0 + base - pore;
  },
  river(v, p) {
    const noise = noise3D(
      v.x * p.baseFrequency + p.seedOffset, v.y * p.baseFrequency, v.z * p.baseFrequency
    ) * p.baseAmplitude;
    return 1.0 + noise;
  },
};

// ---------------- geometry ----------------

/** Un-displaced base mesh: welded icosphere, or a flat cylinder shard (slate). */
function makeBaseGeometry(typeKey, p) {
  const res = clampRes(p.resolution);
  if (typeKey === 'slate') {
    const cyl = new THREE.CylinderGeometry(1, 1, 0.15, res, 1, false);
    cyl.deleteAttribute('uv');
    const g = mergeVertices(cyl, 1e-5);
    if (g !== cyl) cyl.dispose();
    return g;
  }
  const ico = new THREE.IcosahedronGeometry(1, res);
  ico.deleteAttribute('uv'); // unused; drops merge cost + memory
  // weld → indexed geometry, ~6x fewer vertices to displace and REAL smooth
  // normals when flatShading is off (the raw icosphere is non-indexed)
  const g = mergeVertices(ico, 1e-5);
  if (g !== ico) ico.dispose();
  return g;
}

/**
 * Push each vertex to `dir * shape(dir)` (sphere types) or warp the shard's
 * edge band (slate). Reads from `base` (un-displaced positions) so it can be
 * re-run any number of times on the same geometry, whatever the params.
 * Fills `disp` with the radius change, used for cavity shading.
 */
function displace(geo, typeKey, p, base) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const disp = new Float32Array(n);
  const shape = SPHERE_SHAPES[typeKey] ?? SPHERE_SHAPES.ohko;
  const v = new THREE.Vector3();

  if (typeKey === 'slate') {
    for (let i = 0; i < n; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      let x = bx, y = by, z = bz;
      if (Math.abs(by) < 0.08) { // only the shard's edge band warps
        const edgeNoise = noise3D(
          bx * p.baseFrequency + p.seedOffset, 0, bz * p.baseFrequency
        ) * p.baseAmplitude;
        x += bx * edgeNoise;
        z += bz * edgeNoise;
      }
      y += noise3D(x * p.detailFrequency, y, z * p.detailFrequency) * p.detailAmplitude;
      pos.setXYZ(i, x, y, z);
      // cavity shading on the shard comes from normal direction only
      disp[i] = 0;
    }
    pos.needsUpdate = true;
    return disp;
  }

  for (let i = 0; i < n; i++) {
    v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]).normalize();
    const r = shape(v, p);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    disp[i] = r - 1;
  }
  pos.needsUpdate = true; // in-place edits must reach the GPU
  return disp;
}

/**
 * Subtle AO: a grey multiplier from sky occlusion (up-facing normals) and
 * cavity depth (radius below the stone's own baseline). Average ≈ 1.0 so the
 * Material colour still decides the rock's actual colour.
 */
function paintAO(geo, disp, p) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = pos.count;
  const relief = Math.min(1, (Math.abs(p.baseAmplitude) + Math.abs(p.detailAmplitude)) / 0.35);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += disp[i];
  mean /= n || 1;

  let colors = geo.getAttribute('color');
  if (!colors || colors.count !== n) {
    colors = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('color', colors);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const up = clamp(nrm.getY(i) * 0.5 + 0.5, 0, 1);
    const cavity = clamp(1 + (disp[i] - mean) * 1.5 * relief, 0.34, 1.12);
    const mottle = noise3D(v.x * 0.7 + 11, v.y * 0.7, v.z * 0.7) * 0.5 + 0.5;
    const g = clamp((0.84 + up * 0.32) * cavity * (0.93 + mottle * 0.14), 0.22, 1.18);
    colors.setXYZ(i, g, g, g);
  }
  colors.needsUpdate = true;
}

/** Full geometry build: base mesh → displacement → proportions → normals/AO. */
function buildGeometry(typeKey, p, baseOut) {
  const geo = makeBaseGeometry(typeKey, p);
  const base = geo.attributes.position.array.slice();
  const disp = displace(geo, typeKey, p, base);
  geo.scale(p.scaleX, p.scaleY, p.scaleZ);
  geo.computeVertexNormals();
  paintAO(geo, disp, p);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  if (baseOut) {
    baseOut.base = base;
    baseOut.disp = disp;
  }
  return geo;
}

/** Re-displace an existing geometry in place (same vertex count & type). */
function refurbishGeometry(geo, typeKey, p, base) {
  const disp = displace(geo, typeKey, p, base);
  geo.scale(p.scaleX, p.scaleY, p.scaleZ);
  geo.computeVertexNormals();
  paintAO(geo, disp, p);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function makeMaterial(p) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: p.color,
    roughness: p.roughness,
    metalness: p.metalness,
    flatShading: !!p.flatShading,
    dithering: true,
  });
}

function updateSizeBase(mesh) {
  const bb = mesh.geometry.boundingBox;
  if (!bb) mesh.geometry.computeBoundingBox();
  mesh.userData.sizeBase = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(mesh.userData.sizeBase);
}

// ---------------- public API ----------------

/**
 * Build a rock. `opts.params` overrides the type defaults (used by load).
 * Shape is fully determined by `typeKey` + resolved params, so a saved rock
 * rebuilds identically.
 */
export function createRock(typeKey, seed = (Math.random() * 1e9) | 0, opts = {}) {
  const key = ROCK_TYPES[typeKey] ? typeKey : 'ohko';
  const def = ROCK_TYPES[key];
  const params = resolveRockParams(key, seed, opts.params);

  const held = {};
  const geo = buildGeometry(key, params, held);

  const mesh = new THREE.Mesh(geo, makeMaterial(params));
  mesh.castShadow = mesh.receiveShadow = true;

  // rest orientation (seeded, so a save/load rebuilds the same pose)
  const rnd = mulberry32(seed);
  mesh.rotation.y = rnd() * Math.PI * 2;

  mesh.userData = {
    kind: 'rock', typeKey: key, seed,
    def,
    params,
    _base: held.base, // un-displaced positions, for in-place rebuilds
    _res: params.resolution, // resolution the geometry was actually built at
    sizeBase: new THREE.Vector3(),
    kgPerL: def.kgPerL,
  };
  updateSizeBase(mesh);
  return mesh;
}

/**
 * Apply a params patch to an existing rock IN PLACE: geometry, AO and material
 * are updated on the same mesh, so id, transform, selection and the gizmo all
 * survive. Returns the mesh.
 */
export function rebuildRock(mesh, patch = {}) {
  const u = mesh.userData;
  const p = { ...u.params, ...patch };
  p.resolution = clampRes(p.resolution);
  if (patch.seed != null) u.seed = patch.seed;

  const sameTopology = u._base && p.resolution === u._res;
  if (sameTopology) {
    refurbishGeometry(mesh.geometry, u.typeKey, p, u._base);
  } else {
    const held = {};
    const geo = buildGeometry(u.typeKey, p, held);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    u._base = held.base;
    u._res = p.resolution;
  }

  const mat = mesh.material;
  mat.color.set(p.color);
  mat.roughness = p.roughness;
  mat.metalness = p.metalness;
  if (mat.flatShading !== !!p.flatShading) {
    mat.flatShading = !!p.flatShading;
    mat.needsUpdate = true; // flatShading is baked into the program
  }

  u.params = p;
  updateSizeBase(mesh);
  return mesh;
}

/**
 * Restore a rock to its type defaults (shape + material). The Random seed
 * offset is deliberately preserved — resetting shape params shouldn't re-roll
 * the stone you're looking at.
 */
export function resetRockToDefaults(mesh) {
  const u = mesh.userData;
  return rebuildRock(mesh, {
    ...resolveRockParams(u.typeKey, u.seed),
    seedOffset: u.params.seedOffset,
  });
}
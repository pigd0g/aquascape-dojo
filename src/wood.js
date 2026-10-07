// Procedural driftwood generator — recursive branch skeleton → tapered tubes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WOOD_TYPES } from './presets.js';
import { mulberry32, fbm, clamp } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);

function taperTube(points, radius0, radius1, radial = 7, flare = true) {
  const curve = new THREE.CatmullRomCurve3(points);
  const n = Math.max(10, points.length * 3);
  const frames = curve.computeFrenetFrames(n, false);
  const positions = [], normals = [], indices = [];
  const v = new THREE.Vector3(), nrm = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = frames.tangents[i], nn = frames.normals[i], bb = frames.binormals[i];
    let r = radius0 + (radius1 - radius0) * t;
    if (flare && t < 0.25) r *= 1 + (1 - t / 0.25) * 0.45; // root flare
    // gnarl: slight radial noise
    r *= 1 + (fbm(t * 9, points[0].x * 3, points[0].z * 3, 2) - 0.5) * 0.25;
    const center = curve.getPointAt ? curve.getPoint(t) : points[0];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sin = Math.sin(a), cos = -Math.cos(a);
      nrm.set(cos * nn.x + sin * bb.x, cos * nn.y + sin * bb.y, cos * nn.z + sin * bb.z);
      v.copy(center).addScaledVector(nn, cos * r).addScaledVector(bb, sin * r);
      positions.push(v.x, v.y, v.z);
      normals.push(nrm.x, nrm.y, nrm.z);
    }
  }
  const seg = radial + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * seg + j, b = a + seg, c = a + 1, d = b + 1;
      indices.push(a, b, c, c, b, d);
    }
  }
  // cap tip roughly
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function growBranch(rnd, opts, depth, origin, dir, len, rad, sink, out) {
  const segs = [];
  const steps = 4 + ((rnd() * 3) | 0);
  let p = origin.clone();
  let d = dir.clone();

  for (let s = 0; s < steps; s++) {
    segs.push(p.clone());
    d.x += (rnd() - 0.5) * opts.gnarble;
    d.y += (rnd() - 0.5) * opts.gnarble * 0.7;
    d.z += (rnd() - 0.5) * opts.gnarble;
    if (d.lengthSq() < 1e-6) d.set(0, 1, 0);
    d.normalize();
    p = p.clone().addScaledVector(d, len / steps);
  }
  segs.push(p.clone());
  out.geos.push(taperTube(segs, rad, rad * 0.45, 7, depth === 0));

  if (depth >= opts.maxDepth) {
    // tip tip: tiny nub
    return;
  }

  const kids = depth === 0 ? opts.branches + ((rnd() * 2) | 0) : 2 + ((rnd() * 2) | 0);
  for (let k = 0; k < kids; k++) {
    const t = 0.35 + (k / kids) * 0.55 + rnd() * 0.12;
    const at = origin.clone().addScaledVector(dir, len * clamp(t, 0.2, 0.95));
    const nd = dir.clone();
    // rotate away by spread angle
    const ang = opts.spread * (0.5 + rnd() * 0.8) / (depth + 1);
    const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    nd.applyAxisAngle(axis, ang);
    nd.y += opts.upBias * (0.4 + rnd() * 0.6);
    nd.normalize();
    growBranch(rnd, opts, depth + 1, at, nd, len * (0.55 + rnd() * 0.2), rad * 0.55, sink, out);
  }
}

export function createWood(typeKey, seed = (Math.random() * 1e9) | 0, opts = {}) {
  const def = WOOD_TYPES[typeKey];
  const rnd = mulberry32(seed);
  const out = { geos: [] };

  const trunkH = def.trunkH[0] + rnd() * (def.trunkH[1] - def.trunkH[0]);
  const trunkR = def.trunkR[0] + rnd() * (def.trunkR[1] - def.trunkR[0]);

  const o = {
    maxDepth: opts.maxDepth ?? def.branchLv ?? 2,
    branches: def.branches,
    spread: def.spread ?? 1,
    gnarble: 0.55 + (def.bend ?? 0.4) * 0.9,
    upBias: typeKey === 'bonsai' ? 0.34 : typeKey === 'malay' ? -0.16 : 0.06,
  };

  // trunk starts slightly tilted
  const tilt = (rnd() - 0.5) * (def.bend ?? 0.4);
  const trunkDir = new THREE.Vector3(Math.sin(tilt), 1, Math.cos(tilt) * (rnd() - 0.5)).normalize();
  growBranch(rnd, o, 0, new THREE.Vector3(0, 0, 0), trunkDir, trunkH, trunkR, 0, out);

  // tendrils (spiderwood root fingers)
  const tendrilN = def.tendrilN ?? 0;
  for (let i = 0; i < tendrilN; i++) {
    const a = rnd() * Math.PI * 2;
    const pts = [];
    let p = new THREE.Vector3((rnd() - 0.5) * 0.3, trunkH * 0.25, (rnd() - 0.5) * 0.3);
    let d = new THREE.Vector3(Math.cos(a), 0.25 + rnd() * 0.5, Math.sin(a)).normalize();
    const steps = 7;
    const plen = trunkH * (def.tendril ?? 0.5) * (0.6 + rnd() * 0.7) / steps;
    for (let s = 0; s <= steps; s++) {
      pts.push(p.clone());
      d.y -= 0.14; // curl downward
      d.x += (rnd() - 0.5) * 0.35;
      d.z += (rnd() - 0.5) * 0.35;
      d.normalize();
      p = p.clone().addScaledVector(d, plen);
    }
    out.geos.push(taperTube(pts, trunkR * 0.4, trunkR * 0.08, 5, false));
  }

  // merge
  const geometries = out.geos;
  let geo;
  if (geometries.length > 1) {
    geo = mergeGeometries(geometries, false);
  } else {
    geo = geometries[0];
  }
  geometries.forEach((gg) => gg !== geo && gg.dispose());

  // compute bounds → lift so minY = 0
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const lift = -bb.min.y + 0;
  geo.translate(0, lift, 0);

  // bark texture via canvas
  const tex = makeBarkTexture(seed);
  const mat = new THREE.MeshStandardMaterial({
    color: def.barkColor ?? def.bark,
    map: tex,
    roughness: 0.9,
    metalness: 0.0,
    bumpMap: tex,
    bumpScale: 0.8,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;

  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);

  mesh.userData = { kind: 'wood', typeKey, seed, def, sizeBase: size.clone(), kgPerL: 0.62 };
  return mesh;
}

function makeBarkTexture(seed) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed ^ 0x5eed);
  // base
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, S, S);
  // vertical streaks
  for (let i = 0; i < 340; i++) {
    const x = rnd() * S;
    const w = 1 + rnd() * 3;
    const h = 20 + rnd() * 200;
    const y = rnd() * S;
    const v = 150 + rnd() * 90;
    ctx.fillStyle = `rgba(${v | 0},${(v * 0.94) | 0},${(v * 0.86) | 0},0.4)`;
    ctx.fillRect(x, y, w, h);
  }
  // knots
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(40,30,22,0.55)');
    g.addColorStop(1, 'rgba(40,30,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
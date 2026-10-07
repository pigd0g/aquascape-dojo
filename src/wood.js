// Procedural driftwood generator — seed-driven solid logs & branch skeletons.
// Every limb is anchored to a point sampled on its parent's actual curved
// backbone (CatmullRom), so rerolling never produces floating branches.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WOOD_TYPES } from './presets.js';
import { mulberry32, fbm, clamp } from './noise.js';

/**
 * Tapered tube along a CatmullRom spine with a radius callback.
 * opts: { radial, flare, jag, gnarl, capStart, capEnd, rnd }
 * Jag adds torn, asymmetric end caps (stumps / snaps).
 * Positions + indices only; caller runs computeVertexNormals.
 */
function tubeAlong(points, radiusFn, opts = {}) {
  const radial = opts.radial ?? 7;
  const flare = opts.flare ?? false;
  const jag = opts.jag ?? 0;
  const gnarl = opts.gnarl ?? 0.22;
  const rnd = opts.rnd ?? mulberry32(12345);
  const curve = new THREE.CatmullRomCurve3(points);
  const n = Math.max(10, points.length * 3);
  const frames = curve.computeFrenetFrames(n, false);
  const positions = [], indices = [], uvs = [];
  const v = new THREE.Vector3(), nrm = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = frames.tangents[i], nn = frames.normals[i], bb = frames.binormals[i];
    let r = radiusFn(t);
    if (flare && t < 0.22) r *= 1 + (1 - t / 0.22) * 0.5; // root flare
    r *= 1 + (fbm(t * 9, points[0].x * 3.7, points[0].z * 3.1, 2) - 0.5) * gnarl;
    const center = curve.getPoint(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const sin = Math.sin(a), cos = -Math.cos(a);
      nrm.set(cos * nn.x + sin * bb.x, cos * nn.y + sin * bb.y, cos * nn.z + sin * bb.z);
      v.copy(center).addScaledVector(nn, cos * r).addScaledVector(bb, sin * r);
      positions.push(v.x, v.y, v.z);
      // u around (radial repeats), v along with ~1 repeat per unit length so
      // bark density stays constant at any branch length (mesh scaled ~9x)
      uvs.push((j / radial) * 2, t * curve.getLength() * 1.4);
    }
  }
  const seg = radial + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * seg + j, b = a + seg, c2 = a + 1, d = b + 1;
      indices.push(a, b, c2, c2, b, d);
    }
  }

  // torn end caps: an inset ring + jittered inner point creates a
  // concave, splintered hollow instead of a flat disk
  const capAt = (atStart) => {
    const ti = atStart ? 0 : n;
    const t = atStart ? 0 : 1;
    const r = radiusFn(t);
    const center = curve.getPoint(t);
    const tan = frames.tangents[ti];
    const nn2 = frames.normals[ti], bb2 = frames.binormals[ti];
    const dir = atStart ? -1 : 1;
    const seg = radial + 1;
    const base = atStart ? 0 : n * seg;
    // inner ring: pulled along the tube and shrunk, wobbled per-vertex
    const ringStart = positions.length / 3;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cos = -Math.cos(a), sin = Math.sin(a);
      const wobble = 1 + (rnd() - 0.5) * 0.7 * (0.4 + jag);
      const rr = r * 0.55 * wobble;
      const px = center.x + (nn2.x * cos + bb2.x * sin) * rr + tan.x * dir * r * (0.3 + rnd() * 0.5);
      const py = center.y + (nn2.y * cos + bb2.y * sin) * rr + tan.y * dir * r * (0.3 + rnd() * 0.5);
      const pz = center.z + (nn2.z * cos + bb2.z * sin) * rr + tan.z * dir * r * (0.3 + rnd() * 0.5);
      positions.push(px, py, pz);
      uvs.push(j / radial, t);
    }
    // ring→rim (outer edge of the tube opening)
    for (let j = 0; j < radial; j++) {
      const o1 = base + j, o2 = base + j + 1, i1 = ringStart + j, i2 = ringStart + j + 1;
      if (atStart) indices.push(o1, i1, o2, o2, i1, i2);
      else indices.push(o2, i1, o1, i1, i2, o2);
    }
    // splinter heart: jittered point deep inside, ring fans to it
    const ci = positions.length / 3;
    const deep = 0.45 + rnd() * 0.75;
    positions.push(
      center.x + nn2.x * (rnd() - 0.5) * r * 0.5 + tan.x * dir * r * deep + bb2.x * (rnd() - 0.5) * r * 0.5,
      center.y + nn2.y * (rnd() - 0.5) * r * 0.5 + tan.y * dir * r * deep + bb2.y * (rnd() - 0.5) * r * 0.5,
      center.z + nn2.z * (rnd() - 0.5) * r * 0.5 + tan.z * dir * r * deep + bb2.z * (rnd() - 0.5) * r * 0.5
    );
    for (let j = 0; j < radial; j++) {
      if (atStart) indices.push(ringStart + j, ci, ringStart + j + 1);
      else indices.push(ringStart + j, ringStart + j + 1, ci);
    }
  };
  if (opts.capStart !== false) capAt(true);
  if (opts.capEnd !== false) capAt(false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Linear taper factor shared by trunk tubes & child-radius math. */
const TAPER = 0.55;
const radiusAt = (base, t) => base * (1 - (1 - TAPER) * t);

/**
 * Recursive branch: grows a segmented spine, emits its tube, then grows
 * children anchored at exact points ON that spine's curve.
 */
function growBranch(rnd, opts, depth, origin, dir, len, rad, out, parentPiece = -1) {
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

  const last = depth >= opts.maxDepth;
  out.geos.push(tubeAlong(segs, (t) => radiusAt(rad, t), {
    flare: depth === 0,
    jag: last ? 1.0 : 0.2,   // dead twigs end in torn snaps
    radial: 7,
    rnd,
  }));
  out.pieces.push({ spine: segs.map((q) => q.toArray()), r: rad * 1.05, parent: parentPiece });
  const myIdx = out.pieces.length - 1;
  const curve = new THREE.CatmullRomCurve3(segs);

  if (last) return;

  const kids = depth === 0 ? opts.branches + ((rnd() * 2) | 0) : 2 + ((rnd() * 2) | 0);
  for (let k = 0; k < kids; k++) {
    const t = clamp(0.3 + (k / kids) * 0.55 + rnd() * 0.12, 0.25, 0.95);
    // exact backbone point + tangent — children always grow FROM the trunk
    const at = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const nd = tan.clone();
    const ang = opts.spread * (0.5 + rnd() * 0.8) / (depth + 1);
    const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    nd.applyAxisAngle(axis, ang);
    nd.y += opts.upBias * (0.4 + rnd() * 0.6);
    nd.normalize();
    // child base radius starts inside the parent tube → joints stay hidden
    const parentR = radiusAt(rad, t);
    const childR = Math.min(parentR * (0.5 + rnd() * 0.2), parentR * 0.95);
    growBranch(rnd, opts, depth + 1, at, nd, len * (0.55 + rnd() * 0.2), childR, out, myIdx);
  }
}

/**
 * Driftwood log: a large horizontal trunk chunk — wandering spine, root-end
 * flare, random bulges, 1-2 big forks and several snapped stub branches.
 */
function makeLog(def, rnd, out) {
  const len = def.trunkH[0] + rnd() * (def.trunkH[1] - def.trunkH[0]);
  const rBase = def.trunkR[0] + rnd() * (def.trunkR[1] - def.trunkR[0]);
  const rootAtStart = rnd() < 0.5;

  // wandering horizontal spine (bows and S-curves, never perfectly straight)
  const npts = 6 + ((rnd() * 3) | 0);
  const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28;
  const fY = 0.7 + rnd() * 1.2, fZ = 0.5 + rnd() * 1.1;
  const aY = len * 0.12, aZ = len * 0.16;
  const spine = [];
  for (let i = 0; i < npts; i++) {
    const t = i / (npts - 1);
    const x = (t - 0.5) * len;
    const arch = Math.sin(t * Math.PI); // gentle bow over the length
    const y = (Math.sin(t * fY * Math.PI * 2 + ph1) * 0.5 + arch * 0.55 - 0.32) * aY;
    const z = Math.sin(t * fZ * Math.PI * 2 + ph2) * aZ;
    spine.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(spine);
  out.logSpine = spine.map((q) => q.toArray());
  out.logCurveT = (p3) => curve.getPoint(p3).toArray();

  const prof = (t) => {
    let r = rBase * (1 - 0.3 * t);
    r *= 1 + (fbm(t * 4.5, rBase * 37.7, len * 19.3, 3) - 0.5) * 0.7; // bulges
    r *= 1 + (fbm(t * 11.3, rBase * 7.1, len * 43.7, 2) - 0.5) * 0.3; // wrinkles
    const e = rootAtStart ? t : 1 - t;
    r *= 1 + Math.exp(-e * 5) * 0.85; // buttress flare at the root end
    return r;
  };
  out.logProf = prof;
  out.geos.push(tubeAlong(spine, prof, { radial: 9, jag: 1.0, gnarl: 0.5, rnd }));
  out.pieces.push({ spine: out.logSpine, r: rBase * 1.2, parent: -1 });

  // large forks splitting off the trunk (the dramatic Y-shapes)
  const forkN = 1 + ((rnd() * 2) | 0);
  for (let i = 0; i < forkN; i++) {
    const t = 0.25 + rnd() * 0.55;
    const at = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const dir = new THREE.Vector3(rnd() - 0.5, 0.15 + rnd() * 0.65, rnd() - 0.5).normalize();
    dir.addScaledVector(tan, (rnd() - 0.35) * 0.8).normalize();
    const flen = len * (0.2 + rnd() * 0.28);
    const frad = Math.max(prof(t) * (0.68 + rnd() * 0.28), rBase * 0.34);
    growBranch(rnd, { maxDepth: 1, gnarble: 0.4, spread: 0.6, upBias: 0.1, branches: 1 },
      0, at, dir, flen, frad, out, 0); // parent 0 = the trunk
  }

  // snapped stub branches along the length
  const stubN = 2 + ((rnd() * 3) | 0);
  for (let i = 0; i < stubN; i++) {
    const t = 0.12 + rnd() * 0.76;
    const at = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const dir = new THREE.Vector3(rnd() - 0.5, 0.35 + rnd(), rnd() - 0.5).normalize();
    dir.addScaledVector(tan, -dir.dot(tan)).normalize(); // stick out sideways
    const bl = prof(t) * (1.1 + rnd() * 1.4);
    const pts = [at, at.clone().addScaledVector(dir, bl)];
    out.geos.push(tubeAlong(
      pts,
      (tt) => prof(t) * (0.62 - tt * 0.34),
      { radial: 6, jag: 1.0, gnarl: 0.3, rnd }
    ));
    out.pieces.push({ spine: pts.map((q) => q.toArray()), r: prof(t) * 0.66, parent: 0 });
  }
}

export function createWood(typeKey, seed = (Math.random() * 1e9) | 0, opts = {}) {
  // unknown typeKeys (e.g. old saves with 'bonsai') fall back to a log
  const def = WOOD_TYPES[typeKey] ?? WOOD_TYPES.log;
  const key = WOOD_TYPES[typeKey] ? typeKey : 'log';
  const rnd = mulberry32(seed);
  const out = { geos: [], pieces: [] };

  if (key === 'log') {
    makeLog(def, rnd, out);
  } else {
    const trunkH = def.trunkH[0] + rnd() * (def.trunkH[1] - def.trunkH[0]);
    const trunkR = def.trunkR[0] + rnd() * (def.trunkR[1] - def.trunkR[0]);

    const o = {
      maxDepth: opts.maxDepth ?? def.branchLv ?? 2,
      branches: def.branches,
      spread: def.spread ?? 1,
      gnarble: 0.55 + (def.bend ?? 0.4) * 0.9,
      upBias: key === 'spider' ? 0.3 : key === 'malay' ? -0.16 : 0.06,
    };

    // trunk starts slightly tilted
    const tilt = (rnd() - 0.5) * (def.bend ?? 0.4);
    const trunkDir = new THREE.Vector3(Math.sin(tilt), 1, Math.cos(tilt) * (rnd() - 0.5)).normalize();
    const trunkOrigin = new THREE.Vector3(0, 0, 0);
    growBranch(rnd, o, 0, trunkOrigin, trunkDir, trunkH, trunkR, out, -1);

    // tendrils (spiderwood root fingers) — anchored ON the trunk curve
    const tendrilN = def.tendrilN ?? 0;
    if (tendrilN) {
      const trunkPiece = out.pieces[out.pieces.length - 1];
      const tCurve = new THREE.CatmullRomCurve3(trunkPiece.spine.map((a) => new THREE.Vector3(a[0], a[1], a[2])));
      for (let i = 0; i < tendrilN; i++) {
        const a = rnd() * Math.PI * 2;
        const t0 = 0.1 + rnd() * 0.5;
        const base = tCurve.getPoint(t0);
        const pts = [];
        let p = base.clone();
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
        out.geos.push(tubeAlong(pts, (t) => trunkR * 0.4 * (1 - t * 0.82), { radial: 5, gnarl: 0.12, jag: 0.6, rnd }));
        out.pieces.push({ spine: pts.map((q) => q.toArray()), r: trunkR * 0.45, parent: out.pieces.length - 1 });
      }
    }
  }

  // merge into one solid mesh
  const geometries = out.geos;
  let geo;
  if (geometries.length > 1) {
    geo = mergeGeometries(geometries, false);
  } else {
    geo = geometries[0];
  }
  geo.computeVertexNormals();
  geometries.forEach((gg) => gg !== geo && gg.dispose());

  // compute bounds → lift so minY = 0
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const lift = -bb.min.y;
  geo.translate(0, lift, 0);

  // per-seed tint choice (reroll swaps colour family too)
  const tints = def.tints ?? [def.barkColor ?? def.bark];
  const tintIdx = tints.length > 1 ? (rnd() * tints.length) | 0 : 0;

  // bark texture via canvas
  const tex = makeBarkTexture(seed);
  const mat = new THREE.MeshStandardMaterial({
    color: tints[tintIdx],
    map: tex,
    roughness: 0.92,
    metalness: 0.0,
    bumpMap: tex,
    bumpScale: 0.8,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;

  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);

  mesh.userData = { kind: 'wood', typeKey: key, seed, def, sizeBase: size.clone(), kgPerL: 0.62 };
  mesh.userData.pieces = out.pieces; // limb spines for tooling/tests
  return mesh;
}

/** Re-roll an existing wood piece's shape in place (keeps transform). */
export function rerollWood(mesh, seed) {
  const fresh = createWood(mesh.userData.typeKey, seed);
  fresh.position.copy(mesh.position);
  fresh.rotation.copy(mesh.rotation);
  fresh.scale.copy(mesh.scale);
  return fresh;
}

/**
 * Bark texture: neutral grey ramps so `material.color` supplies the hue.
 * High-contrast grooves + knots so bark reads at any range.
 */
function makeBarkTexture(seed) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(seed ^ 0x5eed);
  // mid-grey base keeps material.color dominant
  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, 0, S, S);
  // long wavy grooves (bark fissures) — run along the grain
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x0 = rnd() * S;
    const amp = 3 + rnd() * 7;
    const ph = rnd() * 6.28;
    const w = 1 + rnd() * 3.5;
    const dark = rnd() < 0.72;
    ctx.strokeStyle = dark
      ? `rgba(28,20,14,${0.35 + rnd() * 0.4})`
      : `rgba(235,225,210,${0.14 + rnd() * 0.25})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let y = 0; y <= S; y += 8) {
      const x = x0 + Math.sin(y * 0.02 + ph) * amp;
      if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // knots & hollows
  for (let i = 0; i < 30; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(15,10,7,0.7)');
    g.addColorStop(1, 'rgba(15,10,7,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fine grain speckle
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * S;
    const v = rnd() < 0.5 ? 30 : 215;
    ctx.fillStyle = `rgba(${v},${v},${v},0.12)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
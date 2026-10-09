// Display furniture & decor for the dojo room:
//   · front-wall catalogue workbench (seeded samples of every wood/rock/plant)
//   · potted plant clusters in the two back-wall corners
//   · back-wall still life: framed scroll-style painting (the kanji 魚 "fish",
//     inscription columns, faint landscape wash) flanked by vase arrangements
//     with flowers, like a tokonoma display.
// Pure decoration: these meshes never enter placement.objects, so they are not
// pickable, editable or serialised, and fixed seeds keep everything identical
// on every load. Items are placed from measured bounding boxes and clamped a
// safe margin inside the walls / shelf edges, so nothing overlaps.
// Every piece registers with the shared Occluder (occlusion.js) so it hides
// while it would block the camera's view of the tank — see buildDecor().
import * as THREE from "three";
import { createRock } from "./hardscape.js";
import { createWood } from "./wood.js";
import { createPlant } from "./plants.js";
import { mulberry32 } from "./noise.js";
import { RX, RZ } from "./shell.js";

const TATAMI_TOP = 2.4; // tatami mat surface height

// ---- workbench dimensions (all cm; the front wall sits at z +150) ----
const ZC = 126; // bench centre line
const LEN = 304; // top x extent
const DEP = 38; // top z extent
const TOP = 43; // main work-surface height (top of lower slab)
const RISER_Y = 58; // rear display-shelf surface height
const RISER_D = 16; // rear shelf depth (flush with the bench back)
const RISER_Z = ZC + DEP / 2 - RISER_D / 2;
const GAP = 2.2; // minimum gap between two items in a row
const SECTION_GAP = 9; // visual break between the wood / rock / plant sections

// standable bands per tier (absolute z bounds, slightly inside the slab edges;
// zMax is the wall side)
const LANE_RISER = { y: RISER_Y, z: RISER_Z, zMin: 129.4, zMax: 144.6 };
const LANE_MAIN = { y: TOP, z: 118, zMin: 107.4, zMax: 128.6 };

// wainscot slats protrude ~1.7 cm and the base rail ~3 cm from each wall —
// wall decor keeps this much clearance so nothing grazes the panelling
const WALL_MARGIN = 3.5;

// ================= catalogue coverage =================
// fp   — target footprint (max horizontal extent, cm) for rocks & upright wood
// len  — target x length for the horizontal logs (long axis = generated X)
// scale — species scaleMul for potted plants; maxW caps the measured width so
//         a broad rosette can never grow into its neighbour
const SECTIONS = [
  {
    key: "wood",
    riser: [
      { fam: "wood", type: "spider", seed: 710011, fp: 13.5 },
      { fam: "wood", type: "malay", seed: 720022, fp: 14.5 },
      { fam: "wood", type: "spider", seed: 730033, fp: 12.5 },
      { fam: "wood", type: "malay", seed: 740044, fp: 13 },
    ],
    main: [
      { fam: "wood", type: "log", seed: 750055, len: 30 },
      { fam: "wood", type: "spider", seed: 760066, fp: 17.5 },
      { fam: "wood", type: "malay", seed: 770077, fp: 18 },
      { fam: "wood", type: "log", seed: 780088, len: 25 },
    ],
  },
  {
    key: "rock",
    riser: [
      { fam: "rock", type: "seiryu", seed: 810011, fp: 14.5 },
      { fam: "rock", type: "ohko", seed: 820022, fp: 13 },
      { fam: "rock", type: "slate", seed: 830033, fp: 13, tip: 1 },
      { fam: "rock", type: "lava", seed: 840044, fp: 13.5 },
      { fam: "rock", type: "seiryu", seed: 850055, fp: 10.5 },
    ],
    main: [
      { fam: "rock", type: "ohko", seed: 860066, fp: 10 },
      { fam: "rock", type: "river", seed: 870077, fp: 8 },
      { fam: "rock", type: "slate", seed: 880088, fp: 9.5, tip: 1 },
      { fam: "rock", type: "river", seed: 890099, fp: 6.5 },
      { fam: "rock", type: "lava", seed: 900111, fp: 9.5 },
      { fam: "rock", type: "river", seed: 910122, fp: 7.5 },
    ],
  },
  {
    key: "plant",
    riser: [
      { fam: "pot", type: "vallis", seed: 610011, scale: 0.9, potR: 6.4, potH: 9.5, maxW: 17 },
      { fam: "pot", type: "sword", seed: 620022, scale: 0.62, potR: 6, potH: 8.5, maxW: 17 },
      { fam: "pot", type: "javafern", seed: 630033, scale: 0.85, potR: 5.5, potH: 8.5, maxW: 17 },
      { fam: "pot", type: "ludwigia", seed: 640044, scale: 1, potR: 5, potH: 8.5, maxW: 16 },
    ],
    main: [
      { fam: "pot", type: "anubias", seed: 650055, scale: 1, potR: 4.6, potH: 7.5, maxW: 15 },
      { fam: "pot", type: "crypt", seed: 660066, scale: 1, potR: 5, potH: 7.5, maxW: 15 },
      { fam: "pot", type: "blyxa", seed: 670077, scale: 1.05, potR: 5, potH: 7.5, maxW: 15 },
      { fam: "pot", type: "hairgrass", seed: 680088, scale: 1.35, potR: 5.6, potH: 7.5, maxW: 15 },
      { fam: "pot", type: "moss", seed: 690099, scale: 2.4, potR: 5, potH: 7.5, maxW: 15 },
    ],
  },
];

// ================= corner clusters =================
// Potted plant groups in the two back-wall corners, staggered triangles: the
// tallest species tucked into the corner, mid-size beside it, short species
// toward the room. `u` / `v` are distances from the corner's two walls; each
// side gets its own species mix and seeds, and every footprint is clamped a
// WALL_MARGIN inside the room.
const CORNER_CLUSTERS = [
  {
    side: -1, // back-left corner (wall at x = -RX)
    pots: [
      { type: "vallis", seed: 421001, scale: 0.9, potR: 6.5, potH: 9.5, u: 16, v: 15, maxW: 22 },
      { type: "crypt", seed: 422002, scale: 1, potR: 5, potH: 7.5, u: 36, v: 17, maxW: 15 },
      { type: "anubias", seed: 423003, scale: 1, potR: 4.6, potH: 7.5, u: 15, v: 34, maxW: 14 },
      { type: "hairgrass", seed: 424004, scale: 1.2, potR: 4.6, potH: 6.5, u: 35, v: 33, maxW: 13 },
    ],
  },
  {
    side: 1, // back-right corner (wall at x = +RX)
    pots: [
      { type: "sword", seed: 431001, scale: 0.6, potR: 6, potH: 8.5, u: 16, v: 15, maxW: 20 },
      { type: "javafern", seed: 432002, scale: 0.85, potR: 5.5, potH: 8.5, u: 36, v: 17, maxW: 15 },
      { type: "ludwigia", seed: 433003, scale: 0.95, potR: 5, potH: 8, u: 15, v: 34, maxW: 14 },
      { type: "blyxa", seed: 434004, scale: 1.1, potR: 4.6, potH: 6.5, u: 35, v: 33, maxW: 13 },
    ],
  },
];

/** World bbox with the object still detached (origin-centred). Vertex-precise:
 *  the default AABB-of-AABB inflates yawed/rotated pieces (a yawed lathe's
 *  box grows ~40%), which would leave phantom gaps in the rows. */
function measure(o) {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}
const bbW = (bb) => bb.max.x - bb.min.x;
const bbD = (bb) => bb.max.z - bb.min.z;

// ================= shared helpers =================
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();

/** Axis-aligned unit-box mesh (room-shell style) into `parent`. */
function placeBox(parent, mat, x, y, z, sx, sy, sz, cast = true) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Potted plant: black ceramic pot + soil disc, plant rooted at the soil line. */
function makePotted(spec, potMat, soilMat) {
  const slot = new THREE.Group();
  const r = spec.potR,
    h = spec.potH;
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.82, h, 20),
    potMat,
  );
  pot.position.y = h / 2;
  pot.castShadow = pot.receiveShadow = true;
  slot.add(pot);
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(r - 0.8, r - 0.8, 1, 20),
    soilMat,
  );
  soil.position.y = h - 1.35;
  slot.add(soil);

  const plant = createPlant(spec.type, spec.seed, spec.scale);
  plant.position.y = h - 0.9 - measure(plant).min.y; // lowest point on the soil
  slot.add(plant);

  // cap the footprint: broad species shrink (pot included) rather than overlap
  const bb = measure(slot);
  const w = Math.max(bbW(bb), bbD(bb));
  if (w > spec.maxW) slot.scale.setScalar(spec.maxW / w);
  return slot;
}

function buildItem(spec, potMat, soilMat) {
  let obj;
  if (spec.fam === "wood") {
    obj = createWood(spec.type, spec.seed);
    const rnd = mulberry32(spec.seed ^ 0x5eed);
    // logs lie along the bench (their generated long axis is X); upright
    // pieces get a seeded yaw so the row still reads as hand-arranged
    obj.rotation.y =
      spec.type === "log"
        ? (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.1
        : rnd() * Math.PI * 2;
  } else if (spec.fam === "rock") {
    obj = createRock(spec.type, spec.seed); // generator picks its own seeded yaw
    // `tip` stands a flat shard on its edge (slate), leaning back toward the
    // wall (+z) — a paper-thin pancake lying flat reads as a stain on the slab
    if (spec.tip) {
      const rnd = mulberry32(spec.seed ^ 0x71b);
      obj.rotation.x = -(1.05 + rnd() * 0.15);
    }
    let bb0 = measure(obj);
    obj.scale.setScalar(spec.fp / Math.max(bbW(bb0), bbD(bb0)));
  } else {
    obj = makePotted(spec, potMat, soilMat);
  }
  if (spec.fam === "wood") {
    // scale after the (possibly yaw'd) shape is known: fp or log length
    const bb0 = measure(obj);
    obj.scale.setScalar(
      spec.len ? spec.len / bbW(bb0) : spec.fp / Math.max(bbW(bb0), bbD(bb0)),
    );
  }
  return { obj, bb: measure(obj) };
}

/**
 * Lay a row out starting at `left`, centring each item's bbox on its slot and
 * resting its lowest point on the lane surface. Items are clamped inside the
 * lane band (zMin..zMax); when a piece is deeper than the band it anchors its
 * wall-side edge instead, so its foliage overhangs the open front, never the
 * wall. Returns the row width.
 */
function placeRow(items, lane, left, group) {
  const rowW =
    items.reduce((n, it) => n + bbW(it.bb), 0) + GAP * (items.length - 1);
  let cursor = left;
  for (const { obj, bb } of items) {
    const w = bbW(bb),
      hz = bbD(bb) / 2;
    const cx = (bb.min.x + bb.max.x) / 2,
      cz = (bb.min.z + bb.max.z) / 2;
    const zc =
      hz * 2 >= lane.zMax - lane.zMin
        ? lane.zMax - hz
        : THREE.MathUtils.clamp(lane.z, lane.zMin + hz, lane.zMax - hz);
    // +0.06: skim just above the surface so flat bases never z-fight the slab
    obj.position.set(cursor + w / 2 - cx, lane.y - bb.min.y + 0.06, zc - cz);
    group.add(obj);
    cursor += w + GAP;
  }
  return rowW;
}

// ================= painting texture =================
// Rounded-rect path (ctx.roundRect is still spotty on older browsers).
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** One ink character with worn-brush erosion, composited onto `ctx`. */
function inkChar(ctx, ch, cx, cy, px, fontStack, seed, alpha) {
  const S = Math.ceil(px * 1.5);
  const off = document.createElement("canvas");
  off.width = off.height = S;
  const c = off.getContext("2d");
  c.font = `${px}px ${fontStack}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = `rgba(43,39,33,${alpha})`;
  c.fillText(ch, S / 2, S / 2);
  // poke soft holes through the glyph so the ink reads as brushed, not printed
  const rnd = mulberry32(seed);
  c.globalCompositeOperation = "destination-out";
  const n = (S * S) / 650;
  for (let i = 0; i < n; i++) {
    c.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.5})`;
    c.beginPath();
    c.arc(rnd() * S, rnd() * S, px * (0.004 + rnd() * 0.012), 0, Math.PI * 2);
    c.fill();
  }
  ctx.drawImage(off, cx - S / 2, cy - S / 2);
}

/** Faint misty-landscape wash + blossom branch for the lower third. */
function drawLandscape(ctx, W, H, rnd) {
  // pale valley wash
  const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
  g.addColorStop(0, "rgba(238,231,213,0)");
  g.addColorStop(0.45, "rgba(226,216,193,0.5)");
  g.addColorStop(1, "rgba(214,200,172,0.72)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);

  // layered hill silhouettes — soft greys, back to front
  const hills = [
    { y: H * 0.7, h: H * 0.075, a: 0.2 },
    { y: H * 0.75, h: H * 0.1, a: 0.26 },
    { y: H * 0.81, h: H * 0.13, a: 0.32 },
  ];
  hills.forEach((hl, i) => {
    ctx.fillStyle = `rgba(104,93,75,${hl.a})`;
    const n = 6;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const x = -20 + (k / n) * (W + 40);
      const y =
        hl.y + Math.sin(k * 1.7 + i * 2.3) * hl.h * 0.45 + (rnd() - 0.5) * hl.h * 0.25;
      pts.push([x, y]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], H);
    ctx.lineTo(pts[0][0], pts[0][1]);
    for (let k = 1; k <= n; k++) {
      const [x0, y0] = pts[k - 1];
      const [x1, y1] = pts[k];
      ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - hl.h * 0.35, x1, y1);
    }
    ctx.lineTo(pts[n][0], H);
    ctx.closePath();
    ctx.fill();
  });

  // mist streaks floating over the hills
  for (let i = 0; i < 3; i++) {
    const y = H * (0.68 + 0.06 * i) + rnd() * 12;
    const grd = ctx.createLinearGradient(0, y - 14, 0, y + 14);
    grd.addColorStop(0, "rgba(240,234,218,0)");
    grd.addColorStop(0.5, "rgba(240,234,218,0.45)");
    grd.addColorStop(1, "rgba(240,234,218,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(-10, y - 14, W + 20, 28);
  }

  // blossom branch climbing from the lower left
  const bx = 70;
  ctx.strokeStyle = "rgba(74,60,46,0.7)";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx - 28, H * 0.985);
  ctx.quadraticCurveTo(bx + 46, H * 0.88, bx + 152, H * 0.705);
  ctx.quadraticCurveTo(bx + 238, H * 0.585, bx + 342, H * 0.6);
  ctx.stroke();
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 5; i++) {
    const t = 0.2 + i * 0.15;
    const px = bx - 28 + t * 370;
    const py = H * (0.96 - t * 0.34);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + 10, py - 26, px + 26, py - 40);
    ctx.stroke();
  }
  // blossoms along the upper branch
  for (let i = 0; i < 18; i++) {
    const t = 0.12 + rnd() * 0.85;
    const px = bx - 28 + t * 370 + (rnd() - 0.5) * 46;
    const py = H * (0.955 - t * 0.33) - rnd() * 44;
    ctx.fillStyle = `rgba(244,237,224,${0.55 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(px, py, 2 + rnd() * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(96,78,58,0.5)";
    ctx.beginPath();
    ctx.arc(px, py, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makePaintingTexture() {
  const W = 640,
    H = 1043; // matches the 54×88 panel aspect
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const rnd = mulberry32(20261006);

  // aged paper
  ctx.fillStyle = "#eae1c9";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 120; i++) {
    const x = rnd() * W,
      y = rnd() * H,
      r = 40 + rnd() * 160;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(
      0,
      rnd() < 0.5
        ? `rgba(255,250,236,${0.03 + rnd() * 0.05})`
        : `rgba(206,190,158,${0.03 + rnd() * 0.05})`,
    );
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1400; i++) {
    const v = rnd() < 0.5 ? 255 : 120;
    ctx.fillStyle = `rgba(${v},${v},${v - 14},${0.04 + rnd() * 0.05})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
  }
  // aged edges
  const edgeGrad = (x0, y0, dx, dy) => {
    const g = ctx.createLinearGradient(x0, y0, x0 + dx, y0 + dy);
    g.addColorStop(0, "rgba(150,132,100,0.16)");
    g.addColorStop(1, "rgba(150,132,100,0)");
    return g;
  };
  ctx.fillStyle = edgeGrad(0, 0, 70, 0);
  ctx.fillRect(0, 0, 70, H); // left edge → fades right
  ctx.fillStyle = edgeGrad(W, 0, -70, 0);
  ctx.fillRect(W - 70, 0, 70, H); // right edge → fades left
  ctx.fillStyle = edgeGrad(0, 0, 0, 70);
  ctx.fillRect(0, 0, W, 70); // top edge → fades down
  ctx.fillStyle = edgeGrad(0, H, 0, -70);
  ctx.fillRect(0, H - 70, W, 70); // bottom edge → fades up

  const CJK =
    '"Yu Mincho","Hiragino Mincho ProN","MS Mincho","SimSun","Songti SC","Noto Serif CJK JP","Noto Serif JP",serif';

  drawLandscape(ctx, W, H, rnd);

  // inscription columns: the dojo's materials down the left, the year right
  "道場水草石木".split("").forEach((ch, i) =>
    inkChar(ctx, ch, 80, 152 + i * 64, 46, CJK, 31 + i, 0.85),
  );
  "二〇二六年".split("").forEach((ch, i) =>
    inkChar(ctx, ch, W - 82, 120 + i * 58, 42, CJK, 71 + i, 0.85),
  );

  // centrepiece: 魚 (fish) in heavy ink
  inkChar(ctx, "魚", 348, 555, 420, CJK, 5, 0.93);
  inkChar(ctx, "魚", 346, 557, 420, CJK, 6, 0.18); // second pass: pooled edge

  // red seal under the left inscription
  ctx.fillStyle = "rgba(170,58,44,0.88)";
  rrect(ctx, 63, 537, 34, 46, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(240,233,216,0.92)";
  ctx.font = `26px ${CJK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("魚", 80, 561);

  // faint mounting borders
  ctx.strokeStyle = "rgba(178,160,126,0.5)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = "rgba(178,160,126,0.28)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(25, 25, W - 50, H - 50);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Coil-weave canvas for the round vase (neutral tones, material tints). */
function makeWeaveTexture() {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const rnd = mulberry32(0x71ea);
  ctx.fillStyle = "#e7dfcc";
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = "round";
  for (let r = 0; r < 19; r++) {
    const y = 8 + r * 14;
    const off = (r % 2) * 6;
    for (let c = 0; c < 20; c++) {
      const x = -6 + off + c * 12;
      ctx.strokeStyle = `rgba(255,252,240,${0.4 + rnd() * 0.2})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 8);
      ctx.stroke();
      ctx.strokeStyle = `rgba(126,108,82,${0.28 + rnd() * 0.16})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 5);
      ctx.lineTo(x + 5, y + 14);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ================= vase still life =================
function latheMesh(profile, mat, segs = 26) {
  const geo = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Thin stems as one InstancedMesh of unit cylinders between points. */
function addStems(parent, mat, segs) {
  const im = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 5, 1, false),
    mat,
    segs.length,
  );
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  segs.forEach((sg, i) => {
    dir.subVectors(sg.b, sg.a);
    const len = dir.length();
    dir.normalize();
    q.setFromUnitVectors(_UP, dir);
    mid.addVectors(sg.a, sg.b).multiplyScalar(0.5);
    s.set(sg.r, len, sg.r);
    _m4.compose(mid, q, s);
    im.setMatrixAt(i, _m4);
  });
  im.castShadow = true;
  parent.add(im);
}

/** Flower/seed heads as one InstancedMesh of squashed icosahedra. */
function addHeads(parent, mat, heads) {
  const im = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    mat,
    heads.length,
  );
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  heads.forEach((h, i) => {
    q.setFromAxisAngle(_UP, h.rot ?? 0);
    s.set(h.r, h.r * (h.ry ?? 0.8), h.r);
    _m4.compose(h.pos, q, s);
    im.setMatrixAt(i, _m4);
  });
  im.castShadow = true;
  parent.add(im);
}

/** Dried flower sprays fanning out of a vase mouth (kept off the wall). */
function driedSprays(parent, mats, mouthY, seed) {
  const rnd = mulberry32(seed);
  const segs = [],
    tan = [],
    light = [];
  const origin = new THREE.Vector3(0, mouthY - 0.5, 0);
  const scatter = (at, n) => {
    for (let k = 0; k < n; k++) {
      const p = at
        .clone()
        .add(
          new THREE.Vector3(
            (rnd() - 0.5) * 2.6,
            (rnd() - 0.5) * 2.2,
            (rnd() - 0.3) * 1.6,
          ),
        );
      const r = 0.65 + rnd() * 0.75;
      (rnd() < 0.55 ? tan : light).push({
        pos: p,
        r,
        ry: 0.7 + rnd() * 0.3,
        rot: rnd() * 6.28,
      });
    }
  };
  for (let i = 0; i < 6; i++) {
    const az = (i / 6) * Math.PI * 2 + rnd() * 0.9;
    const tilt = 0.28 + rnd() * 0.34;
    const st = Math.sin(tilt),
      ct = Math.cos(tilt);
    // +z bias: stems always fan toward the room (+z), even after the vase's
    // own yaw rotates the whole fan, so no stem tip can graze the wall/shoji
    const dir = new THREE.Vector3(
      Math.cos(az) * st,
      ct,
      (0.6 + 0.4 * Math.abs(Math.sin(az))) * st,
    ).normalize();
    const start = origin.clone().addScaledVector(dir, 1.5 + rnd() * 2);
    const tip = start.clone().addScaledVector(dir, 15 + rnd() * 13);
    segs.push({ a: start, b: tip, r: 0.2 + rnd() * 0.08 });
    const nSub = 1 + ((rnd() * 2) | 0);
    for (let b = 0; b < nSub; b++) {
      const at = start.clone().lerp(tip, 0.45 + rnd() * 0.4);
      const bd = dir.clone();
      bd.x += (rnd() - 0.5) * 0.9;
      bd.y += (rnd() - 0.5) * 0.6;
      bd.z += (rnd() - 0.4) * 0.8;
      if (bd.z < 0.05) bd.z = 0.05;
      bd.normalize();
      const bt = at.clone().addScaledVector(bd, 4.5 + rnd() * 6);
      segs.push({ a: at, b: bt, r: 0.13 });
      scatter(bt, 1 + ((rnd() * 2) | 0));
    }
    scatter(tip, 2 + ((rnd() * 2) | 0));
  }
  addStems(parent, mats.stemTan, segs);
  addHeads(parent, mats.blobTan, tan);
  addHeads(parent, mats.blobLight, light);
}

/** Pom-pom blossom bunch (white/cream) above a small vase. */
function blossomBunch(parent, mats, mouthY, seed) {
  const rnd = mulberry32(seed);
  const segs = [],
    white = [],
    cream = [];
  const origin = new THREE.Vector3(0, mouthY - 0.4, 0);
  const N = 7;
  for (let i = 0; i < N; i++) {
    const az = (i / N) * Math.PI * 2 + rnd() * 0.7;
    const tilt = 0.15 + rnd() * 0.5;
    const st = Math.sin(tilt),
      ct = Math.cos(tilt);
    const dir = new THREE.Vector3(
      Math.cos(az) * st,
      ct,
      (0.55 + 0.45 * Math.abs(Math.sin(az))) * st,
    ).normalize();
    const head = origin.clone().addScaledVector(dir, 6.5 + rnd() * 4.5);
    const r = 2.0 + rnd() * 1.1;
    segs.push({
      a: origin.clone().addScaledVector(dir, 0.6),
      b: head.clone().addScaledVector(dir, -r * 0.8),
      r: 0.17,
    });
    (rnd() < 0.7 ? white : cream).push({
      pos: head,
      r,
      ry: 0.72 + rnd() * 0.2,
      rot: rnd() * 6.28,
    });
    if (rnd() < 0.6) {
      white.push({
        pos: origin.clone().addScaledVector(dir, 4 + rnd() * 3),
        r: 1.1 + rnd() * 0.5,
        ry: 0.8,
        rot: rnd() * 6.28,
      });
    }
  }
  addStems(parent, mats.stemGreen, segs);
  addHeads(parent, mats.bloomWhite, white);
  addHeads(parent, mats.bloomCream, cream);
}

// ================= materials =================
function makeMats() {
  // fixed colours (like the potted plant's pot/leaves): the theme tables only
  // drive the room shell, and these warm tones sit comfortably in both themes
  const std = (color, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, dithering: true, ...extra });
  return {
    oak: std(0x87643c, 0.72),
    dark: std(0x5a4026, 0.8),
    div: std(0x33241a, 0.7),
    pot: std(0x141416, 0.25, { metalness: 0.1 }),
    soil: std(0x2a2118, 1),
    // painting
    frameWood: std(0xa9865c, 0.6),
    paperBack: std(0xe8dfc8, 0.95),
    paintPaper: new THREE.MeshStandardMaterial({
      map: makePaintingTexture(),
      roughness: 0.92,
      dithering: true,
    }),
    // vases & still life
    vaseCream: std(0xe9e1cf, 0.85),
    vaseWeave: new THREE.MeshStandardMaterial({
      map: makeWeaveTexture(),
      roughness: 0.9,
      dithering: true,
    }),
    vaseStone: std(0x54402f, 0.5),
    boxWood: std(0xc9a771, 0.7),
    boxLid: std(0xb6966a, 0.7),
    stemTan: std(0x9c8a68, 0.95),
    stemGreen: std(0x7d8a64, 0.95),
    blobTan: std(0xd9cda6, 0.9, { flatShading: true }),
    blobLight: std(0xe8dfc4, 0.9, { flatShading: true }),
    bloomWhite: std(0xf3efe4, 0.85, { flatShading: true }),
    bloomCream: std(0xe7e0cc, 0.85, { flatShading: true }),
  };
}

// ================= assemblies =================
function buildWorkbench(parent, mats) {
  // own subgroup: the render loop hides it as one unit when the bench would
  // block the camera's view of the tank (see the occlusion test below)
  const bench = new THREE.Group();
  bench.name = "workbench";
  parent.add(bench);

  const LEG_XS = [-145, -72.5, 0, 72.5, 145];
  const LEG_BOT = 2.35, // sinks 5 mm into the tatami (its top is at 2.4) —
    LEG_TOP = TOP - 2.5; //                  avoids a coplanar z-fight

  placeBox(bench, mats.oak, 0, TOP - 1.25, ZC, LEN, 2.5, DEP); // main top
  placeBox(bench, mats.oak, 0, RISER_Y - 1, RISER_Z, LEN, 2, RISER_D); // rear shelf
  // apron rails under the main top
  placeBox(bench, mats.dark, 0, 38, ZC - DEP / 2 + 1.9, LEN - 8, 4, 3);
  placeBox(bench, mats.dark, 0, 38, ZC + DEP / 2 - 1.9, LEN - 8, 4, 3);
  for (const x of LEG_XS) {
    placeBox(bench, mats.dark, x, (LEG_BOT + LEG_TOP) / 2, ZC - DEP / 2 + 6, 4.4, LEG_TOP - LEG_BOT, 4.4);
    placeBox(bench, mats.dark, x, (LEG_BOT + LEG_TOP) / 2, ZC + DEP / 2 - 6, 4.4, LEG_TOP - LEG_BOT, 4.4);
    // cross tie joining each front/back leg pair
    placeBox(bench, mats.dark, x, 13, ZC, 3, 3, 17.5);
    // rear shelf support post (standing on the main top, wall side)
    placeBox(bench, mats.dark, x, 49.45, ZC + DEP / 2 - 4, 3, 13.1, 3);
  }
  // long stretcher along the wall-side leg line
  placeBox(bench, mats.dark, 0, 13, ZC + DEP / 2 - 6, LEN - 10, 3, 3);

  // ---- display items ----
  const built = SECTIONS.map((s) => ({
    riser: s.riser.map((spec) => buildItem(spec, mats.pot, mats.soil)),
    main: s.main.map((spec) => buildItem(spec, mats.pot, mats.soil)),
  }));
  const rowW = (items) =>
    items.reduce((n, it) => n + bbW(it.bb), 0) + GAP * (items.length - 1);
  const widths = built.map((s) => Math.max(rowW(s.riser), rowW(s.main)));
  const total =
    widths.reduce((a, b) => a + b, 0) + SECTION_GAP * (built.length - 1);

  let x0 = -total / 2; // centre the whole arrangement on the tank axis
  const dividers = [];
  built.forEach((s, i) => {
    const w = widths[i];
    placeRow(s.riser, LANE_RISER, x0 + (w - rowW(s.riser)) / 2, bench);
    placeRow(s.main, LANE_MAIN, x0 + (w - rowW(s.main)) / 2, bench);
    x0 += w;
    if (i < built.length - 1) {
      dividers.push(x0 + SECTION_GAP / 2);
      x0 += SECTION_GAP;
    }
  });

  // section breaks: a slim batten across each tier
  for (const bx of dividers) {
    placeBox(bench, mats.div, bx, TOP + 0.7, LANE_MAIN.z, 1.4, 1.5, 21);
    placeBox(bench, mats.div, bx, RISER_Y + 0.7, RISER_Z, 1.4, 1.5, 15);
  }

  return bench;
}

function buildCornerClusters(parent, mats) {
  const pots = [];
  for (const cluster of CORNER_CLUSTERS) {
    for (const spec of cluster.pots) {
      const pot = makePotted(spec, mats.pot, mats.soil);
      const bb = measure(pot);
      const hx = bbW(bb) / 2,
        hz = bbD(bb) / 2;
      const cx = (bb.min.x + bb.max.x) / 2,
        cz = (bb.min.z + bb.max.z) / 2;
      // desired anchor: spec.u / spec.v from the corner's walls; clamped so
      // the whole footprint keeps WALL_MARGIN clearance (wainscot slats)
      const x = THREE.MathUtils.clamp(
        cluster.side * (RX - spec.u),
        -(RX - WALL_MARGIN - hx),
        RX - WALL_MARGIN - hx,
      );
      const z = Math.max(-RZ + spec.v, -RZ + WALL_MARGIN + hz);
      pot.position.set(x - cx, TATAMI_TOP - bb.min.y + 0.06, z - cz);
      parent.add(pot);
      pots.push(pot);
    }
  }
  return pots;
}

/**
 * Back-wall still life around a centred painting, like a tokonoma display:
 *   · framed scroll painting (kanji 魚) hanging on the shoji band, its back
 *     face ~1 cm clear of the shoji kumiko/pillars
 *   · left: round woven vase with dried sprays + dark stoneware bottle
 *   · right: small vase with white blossoms + tiny wooden box
 * Every vase keeps its whole footprint a touch in front of the wainscot rails,
 * and the flower fans are z-biased into the room so they never touch the wall.
 */
function buildBackWall(parent, mats) {
  const wall = new THREE.Group();
  wall.name = "backWall";

  // ---- painting: outer 60×94, panel 54×88, hung centred at y 100 (lowered
  // ---- from the original 112 hang so it reads as a seated tokonoma piece) ----
  const painting = new THREE.Group();
  painting.name = "painting";
  painting.position.set(0, 100, -146); // frame centre depth
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(54, 88, 0.8),
    [
      mats.paperBack, mats.paperBack, mats.paperBack, mats.paperBack,
      mats.paintPaper, // +z face carries the canvas
      mats.paperBack,
    ],
  );
  panel.position.set(0, 0, -1.1); // back face -147.5 (clear of shoji front -148.45)
  panel.receiveShadow = true;
  painting.add(panel);
  placeBox(painting, mats.frameWood, -28.5, 0, 0, 3, 94, 3, false);
  placeBox(painting, mats.frameWood, 28.5, 0, 0, 3, 94, 3, false);
  placeBox(painting, mats.frameWood, 0, 45.5, 0, 54, 3, 3, false);
  placeBox(painting, mats.frameWood, 0, -45.5, 0, 54, 3, 3, false);
  wall.add(painting);

  const floorY = TATAMI_TOP + 0.06;

  // ---- left: round woven vase with dried sprays ----
  const round = new THREE.Group();
  round.name = "vaseRound";
  round.position.set(-50.5, floorY, -137.2); // max r 9.2 → rear edge -146.4
  round.rotation.y = 0.25; // small yaw only: keeps the spray fan off the wall
  round.add(
    latheMesh(
      [
        [0, 0], [5.6, 0.5], [8.2, 2.6], [9.2, 7.6], [8.9, 12.6],
        [7.4, 17], [5.4, 20.5], [4.3, 22.6], [4.0, 24.2], [4.5, 25.4], [4.1, 26.0],
      ],
      mats.vaseWeave,
    ),
  );
  driedSprays(round, mats, 25.8, 0xd1ed);
  wall.add(round);

  // ---- left: dark stoneware bottle beside it ----
  const bottle = new THREE.Group();
  bottle.name = "vaseBottle";
  bottle.position.set(-28, floorY, -140.3); // max r 6.1 → rear edge -146.4
  bottle.rotation.y = -0.4;
  bottle.add(
    latheMesh(
      [
        [0, 0], [3.4, 0.3], [5.6, 2], [6.1, 6], [5.9, 9.5], [4.9, 12.5],
        [3.6, 14.6], [2.6, 16.2], [2.2, 17.6], [2.5, 18.8], [2.2, 19.4],
      ],
      mats.vaseStone,
    ),
  );
  wall.add(bottle);

  // ---- right: small cream vase with white blossom bunch ----
  const small = new THREE.Group();
  small.name = "vaseSmall";
  small.position.set(37, floorY, -140.8); // max r 5.0 → rear edge -145.8
  small.rotation.y = 0.3; // small yaw only: keeps the blossoms off the wall
  small.add(
    latheMesh(
      [
        [0, 0], [2.6, 0.3], [4.2, 2], [5.0, 6], [4.6, 9.5],
        [3.7, 11.4], [3.3, 12.6], [3.6, 13.4],
      ],
      mats.vaseCream,
    ),
  );
  blossomBunch(small, mats, 12.8, 0xb105);
  wall.add(small);

  // ---- right: little lidded wooden box ----
  // unrotated: a yawed 10 cm box's corner reaches ~6.4 cm back, deep enough
  // to bite the wainscot rails
  const box = new THREE.Group();
  box.name = "woodBox";
  box.position.set(54, floorY, -141.6);
  placeBox(box, mats.boxWood, 0, 3.75, 0, 9.5, 7.5, 9.5);
  placeBox(box, mats.boxLid, 0, 8.35, 0, 10, 1.7, 10);
  placeBox(box, mats.boxLid, 0, 9.5, 0, 6.4, 0.9, 6.4); // raised centre panel
  wall.add(box);

  parent.add(wall);
  return { painting, stillLife: [round, bottle, small, box] };
}

// ================= decor assembly =================
/**
 * Build all static display decor and register it with the occlusion culler:
 * every piece hides while it would block the camera's view of the tank.
 * Coupled pieces follow their hosts via `link`: the painting rides the back
 * wall, so it never floats once that wall has been culled away.
 * `wallHandles` comes from scene.js (it registers the shell first).
 */
export function buildDecor(room, culler, wallHandles = {}) {
  const group = new THREE.Group();
  group.name = "decor";
  const mats = makeMats();
  const bench = buildWorkbench(group, mats);
  const pots = buildCornerClusters(group, mats);
  const backWall = buildBackWall(group, mats);
  room.add(group);

  const handles = {};
  if (culler) {
    handles.bench = culler.add(bench);
    handles.cornerPots = pots.map((p) => culler.add(p)).filter(Boolean);
    // back-wall still life: vases/box are floor-standing, so they cull on
    // their own; the painting follows the wall it is mounted on
    handles.stillLife = backWall.stillLife.map((p) => culler.add(p)).filter(Boolean);
    handles.painting = culler.add(backWall.painting);
    culler.link(handles.painting, wallHandles.back ?? null);
  }

  return { group, bench, handles };
}

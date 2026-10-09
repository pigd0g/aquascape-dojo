// Room shell: the four walls (each with its wainscot and shoji screen), the
// coffered beam ceiling and the ceiling plane. Each wall lives in its own
// group so the occlusion culler in occlusion.js can hide one wall as a unit;
// the ceiling is likewise grouped (its beams + plane hide together so a
// top-down camera gets an open roof).
import * as THREE from "three";

// ---------------- room dimensions ----------------
// All values in cm (world unit = cm). Human-scale hall: the roof sits 3 m
// above the floor, so even a 100 cm tank on its stand clears it with headroom.
export const RX = 170,
  RZ = 150,
  RH = 300; // half extents + wall/roof height
const WAIN = 27; // wainscot cap height
const PY = WAIN,
  PH = RH - PY - 16; // shoji band: base y, panel height — top rail tucks
// under the ceiling coffer (whose lowest bars hang at RH-15)

/** Pack a list of {x,y,z,sx,sy,sz} world-aligned boxes into one InstancedMesh.
 *  sx / sz are extents along the world X / Z axes (no rotation support needed —
 *  walls, wainscot, shoji frames and beams are all axis-aligned). */
export function makeInstanced(boxes, material, { cast = false, receive = true } = {}) {
  const im = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    boxes.length,
  );
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  boxes.forEach((b, i) => {
    p.set(b.x, b.y, b.z);
    s.set(b.sx, b.sy, b.sz);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = receive;
  return im;
}

/** Split a wall length into n shoji panels with pillars between + at the ends. */
function layoutPanels(len, n, pw = 56, pil = 6) {
  const m = (len - (n * pw + (n + 1) * pil)) / 2;
  const panels = [],
    pillars = [];
  for (let i = 0; i < n; i++)
    panels.push(-len / 2 + m + pil + pw / 2 + i * (pw + pil));
  for (let i = 0; i <= n; i++)
    pillars.push(-len / 2 + m + pil / 2 + i * (pw + pil));
  return { panels, pillars };
}

export function buildShell(room, mats) {
  const { wallMat, wainscotMat, frameMat, beamMat, ceilMat, paperMat } = mats;

  // ---- walls (inward-facing planes), each in its own group ----
  // The group also owns the wall's wainscot and shoji (added below), so the
  // occlusion culler can hide one wall as a unit when it blocks the tank.
  const wallDefs = [
    { key: "back", cx: 0, cz: -RZ, nx: 0, nz: 1 }, // behind the tank
    { key: "front", cx: 0, cz: RZ, nx: 0, nz: -1 },
    { key: "left", cx: -RX, cz: 0, nx: 1, nz: 0 },
    { key: "right", cx: RX, cz: 0, nx: -1, nz: 0 },
  ];
  const wallGroups = {};
  for (const w of wallDefs) {
    const g = new THREE.Group();
    g.name = `wall-${w.key}`;
    wallGroups[w.key] = g;
    room.add(g);

    const alongX = w.nz !== 0;
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(alongX ? 2 * RX : 2 * RZ, RH),
      wallMat,
    );
    wall.position.set(w.cx, RH / 2, w.cz);
    wall.rotation.y = alongX
      ? w.nz > 0
        ? 0
        : Math.PI
      : w.nx > 0
        ? Math.PI / 2
        : -Math.PI / 2;
    wall.receiveShadow = true;
    g.add(wall);

    // ---- wainscoting: base rail + cap rail + vertical slats on this wall ----
    const wain = [];
    const len = alongX ? 2 * RX : 2 * RZ;
    for (const y of [2, WAIN - 2]) {
      wain.push({
        x: w.cx + w.nx * 1.5,
        y,
        z: w.cz + w.nz * 1.5,
        sx: alongX ? len : 3,
        sy: 4,
        sz: alongX ? 3 : len,
      });
    }
    const n = Math.max(6, Math.round(len / 7));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / n) * (i + 0.5);
      wain.push({
        x: w.cx + w.nx * 0.85 + (alongX ? u : 0),
        y: 13.5,
        z: w.cz + w.nz * 0.85 + (alongX ? 0 : u),
        sx: alongX ? 1.3 : 1.7,
        sy: 19,
        sz: alongX ? 1.7 : 1.3,
      });
    }
    g.add(makeInstanced(wain, wainscotMat)); // shell: receives, never casts
  }

  // ---- shoji screens: back wall (5 panels) + both side walls (4 each) ----
  // Lattice: pillars between panels, top & bottom rails, then a fine kumiko
  // grid (5 cols × ~25 rows — cells stay square via the auto-computed rows)
  // over glowing paper.
  const PAPER_W = 50,
    BAR = 1.2;
  const paperGeo = new THREE.PlaneGeometry(PAPER_W, PH - 6);

  function addShojiWall(cx, cz, nx, nz, len, n, target) {
    const alongX = nz !== 0;
    const outward = alongX ? nz : nx; // +1 if wall faces +z/+x
    const off = 0.6 * outward; // lift frames/paper off the wall
    // helper: place a box at (u = along-wall coord, y, v = depth offset from wall)
    const frameBoxes = [];
    const at = (u, y, v, sx, sy, sz) =>
      frameBoxes.push({
        x: cx + (alongX ? u : v),
        y,
        z: cz + (alongX ? v : u),
        sx,
        sy,
        sz,
      });
    const { panels, pillars } = layoutPanels(len, n, PAPER_W, 6);
    // pillars frame each panel
    for (const u of pillars)
      at(
        u,
        PY + PH / 2,
        off,
        alongX ? 6 : 1.4 + 0.6,
        PH,
        alongX ? 1.4 + 0.6 : 6,
      );
    // top & bottom rails
    at(0, PY + 0.8, off, alongX ? len : 3, 3, alongX ? 3 : len);
    at(0, PY + PH - 0.8, off, alongX ? len : 3, 3, alongX ? 3 : len);
    // per panel: paper plane + a fine kumiko grid of vertical & horizontal bars
    for (const u of panels) {
      const paper = new THREE.Mesh(paperGeo, paperMat);
      paper.position.set(
        cx + (alongX ? u : off + 0.4 * outward),
        PY + PH / 2,
        cz + (alongX ? off + 0.4 * outward : u),
      );
      paper.rotation.y = alongX
        ? nz > 0
          ? 0
          : Math.PI
        : nx > 0
          ? Math.PI / 2
          : -Math.PI / 2;
      target.add(paper);
      const pw = PAPER_W,
        phh = PH - 6,
        cols = 5,
        rows = Math.max(4, Math.round(phh / (pw / cols))); // cells stay square
      // vertical bars
      for (let i = 1; i < cols; i++) {
        const bu = u - pw / 2 + (pw / cols) * i;
        at(
          bu,
          PY + PH / 2,
          off + 0.05 * outward,
          alongX ? BAR : BAR + 0.6,
          phh,
          alongX ? BAR + 0.6 : BAR,
        );
      }
      // horizontal bars
      for (let j = 1; j < rows; j++) {
        const by = PY + 3 + (phh / rows) * j;
        at(
          u,
          by,
          off + 0.05 * outward,
          alongX ? pw : BAR + 0.6,
          BAR,
          alongX ? BAR + 0.6 : pw,
        );
      }
    }
    // Shoji paper diffuses light — the room shell must NOT throw hard slat or
    // beam shadows into the tank area (they read as crawling bands while
    // orbiting). The shell still RECEIVES shadows from the tank and plant.
    target.add(makeInstanced(frameBoxes, frameMat));
  }

  addShojiWall(0, -RZ, 0, 1, 2 * RX, 5, wallGroups.back); // back — the hero wall
  addShojiWall(-RX, 0, 1, 0, 2 * RZ, 4, wallGroups.left);
  addShojiWall(RX, 0, -1, 0, 2 * RZ, 4, wallGroups.right);

  // ---- ceiling: coffered kumiko beam grid + plane, in one hideable group ----
  // Offsets hang below the roof line RH, so the coffer keeps identical bar
  // sizes/spacing (and the kumiko cells their scale) at any room height.
  const ceilingGroup = new THREE.Group();
  ceilingGroup.name = "ceiling";
  room.add(ceilingGroup);

  const beamBoxes = [];
  // primary beams spanning X (thick) at intervals along Z
  for (const z of [-120, -60, 0, 60, 120])
    beamBoxes.push({ x: 0, y: RH - 9.5, z, sx: 2 * RX, sy: 5, sz: 4.4 });
  // primary beams spanning Z — world extents, no rotation needed
  for (const x of [-136, -68, 0, 68, 136])
    beamBoxes.push({ x, y: RH - 11.4, z: 0, sx: 3, sy: 3.4, sz: 2 * RZ });
  // fine secondary lattice: thin bars between each pair of primary beams
  for (const [a, b] of [
    [-120, -60],
    [-60, 0],
    [0, 60],
    [60, 120],
  ]) {
    const step = (b - a) / 3;
    for (let i = 1; i <= 2; i++) {
      const z = a + step * i;
      beamBoxes.push({ x: 0, y: RH - 13.6, z, sx: 2 * RX, sy: 1.8, sz: 1.4 });
    }
  }
  for (const [a, b] of [
    [-136, -68],
    [-68, 0],
    [0, 68],
    [68, 136],
  ]) {
    const step = (b - a) / 3;
    for (let i = 1; i <= 2; i++) {
      const x = a + step * i;
      beamBoxes.push({ x, y: RH - 14.2, z: 0, sx: 1.4, sy: 1.8, sz: 2 * RZ });
    }
  }
  // perimeter rail where walls meet the ceiling
  beamBoxes.push({ x: 0, y: RH - 5.5, z: -RZ + 1.5, sx: 2 * RX, sy: 3, sz: 3 });
  beamBoxes.push({ x: 0, y: RH - 5.5, z: RZ - 1.5, sx: 2 * RX, sy: 3, sz: 3 });
  beamBoxes.push({ x: -RX + 1.5, y: RH - 5.5, z: 0, sx: 3, sy: 3, sz: 2 * RZ });
  beamBoxes.push({ x: RX - 1.5, y: RH - 5.5, z: 0, sx: 3, sy: 3, sz: 2 * RZ });
  ceilingGroup.add(makeInstanced(beamBoxes, beamMat)); // shell: receives, never casts

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * RX, 2 * RZ),
    ceilMat,
  );
  ceiling.rotation.x = Math.PI / 2; // faces down
  ceiling.position.y = RH;
  ceilingGroup.add(ceiling);

  return { wallGroups, ceilingGroup };
}

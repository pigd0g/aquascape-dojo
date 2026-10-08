// Renderer, lighting, dojo room (shoji walls, coffered beam ceiling, tatami
// border floor), camera + controls.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mulberry32 } from "./noise.js";

// ---------------- dojo themes ----------------
// One table drives every surface colour and every light, so the ☀️/🌙 toggle
// reshades the whole room: glowing shoji by day, lantern-lit wood by night.
const EVENING = {
  bg: 0x171310,
  wall: 0x59422b,
  wainscot: 0x4a3320,
  frame: 0x39281c,
  beam: 0x3c2a1a,
  ceil: 0x453122,
  paper: 0x9c8e76,
  paperGlow: 0x6b4520,
  paperGlowI: 0.15,
  floorWood: 0x57422c,
  tatami: 0x79684c,
  hemiSky: 0x39415a,
  hemiGnd: 0x201810,
  hemi: 0.95,
  amb: 0.72,
  ambColor: 0x8a7a68,
  key: 0.8,
  keyColor: 0xffc487,
  fill: 0.35,
  rim: 0.85,
  lamp: 2600,
  exposure: 1.22,
};
const DAY = {
  bg: 0xd0cbbd,
  wall: 0xc2a67e,
  wainscot: 0x9e7342,
  frame: 0x8a5e32,
  beam: 0x8a5e32,
  ceil: 0x9a7849,
  paper: 0xf6f0dd,
  paperGlow: 0xfff3d0,
  paperGlowI: 0.38,
  floorWood: 0xa98054,
  tatami: 0xdac286,
  hemiSky: 0xf2ead8,
  hemiGnd: 0x8a7a5e,
  hemi: 1.05,
  amb: 0.4,
  ambColor: 0xffffff,
  key: 3.1,
  keyColor: 0xfff3dc,
  fill: 0.95,
  rim: 1.15,
  lamp: 0,
  exposure: 1.1,
};

// ---------------- room dimensions ----------------
// All values in cm (world unit = cm). Human-scale hall: the roof sits 3 m
// above the floor, so even a 100 cm tank on its stand clears it with headroom.
const RX = 170,
  RZ = 150,
  RH = 300; // half extents + wall/roof height
const WAIN = 27; // wainscot cap height
const PY = WAIN,
  PH = RH - PY - 16; // shoji band: base y, panel height — top rail tucks
// under the ceiling coffer (whose lowest bars hang at RH-15)

// ---------------- canvas textures ----------------

/** One tatami mat: woven rush fill + dark heri fabric border (neutral ramps —
 *  material.color supplies the gold tint per theme). */
function makeTatamiTexture() {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const rnd = mulberry32(77);
  ctx.fillStyle = "#d6d4c6";
  ctx.fillRect(0, 0, S, S);
  // rush weave: fine horizontal + vertical lines
  for (let y = 0; y < S; y += 3) {
    ctx.fillStyle = `rgba(72,68,52,${0.05 + rnd() * 0.07})`;
    ctx.fillRect(0, y, S, 1.4);
  }
  for (let x = 0; x < S; x += 3) {
    ctx.fillStyle = `rgba(255,255,240,${0.04 + rnd() * 0.06})`;
    ctx.fillRect(x, 0, 1.2, S);
  }
  for (let i = 0; i < 400; i++) {
    const v = rnd() < 0.5 ? 60 : 235;
    ctx.fillStyle = `rgba(${v},${v},${v - 8},0.10)`;
    ctx.fillRect(rnd() * S, rnd() * S, 1.6, 1.6);
  }
  // dark heri border around the mat
  const B = 20;
  ctx.fillStyle = "#3c362c";
  ctx.fillRect(0, 0, S, B);
  ctx.fillRect(0, S - B, S, B);
  ctx.fillRect(0, 0, B, S);
  ctx.fillRect(S - B, 0, B, S);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < S; i += 5) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, B);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, S - B);
    ctx.lineTo(i, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(B, i);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(S - B, i);
    ctx.lineTo(S, i);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(18,16,12,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(B - 1, B - 1, S - 2 * B + 2, S - 2 * B + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wide oak planks, horizontal grain — the training floor. Neutral ramps. */
function makePlankTexture(aniso) {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const rnd = mulberry32(4242);
  const rows = 6,
    rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    const v = 0.82 + rnd() * 0.18;
    ctx.fillStyle = `rgb(${Math.round(200 * v)},${Math.round(188 * v)},${Math.round(170 * v)})`;
    ctx.fillRect(0, y0, S, rh);
    // long wavy grain
    for (let i = 0; i < 11; i++) {
      const gy = y0 + rnd() * rh;
      const dark = rnd() < 0.7;
      ctx.strokeStyle = dark
        ? `rgba(80,60,42,${0.07 + rnd() * 0.14})`
        : `rgba(255,248,232,${0.08 + rnd() * 0.1})`;
      ctx.lineWidth = 0.8 + rnd() * 1.6;
      const amp = 1 + rnd() * 2,
        ph = rnd() * 6.28;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 16) {
        const yy = gy + Math.sin(x * 0.03 + ph) * amp;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // occasional knot
    if (rnd() < 0.5) {
      const kx = rnd() * S,
        ky = y0 + rh * (0.25 + rnd() * 0.5);
      ctx.fillStyle = "rgba(70,52,36,0.5)";
      ctx.beginPath();
      ctx.ellipse(kx, ky, 2 + rnd() * 3, 1.2 + rnd() * 2, 0, 0, 6.29);
      ctx.fill();
    }
    // butt joint + gap seam
    const jx = rnd() * S;
    ctx.fillStyle = "rgba(70,55,40,0.8)";
    ctx.fillRect(jx, y0, 2.4, rh);
    ctx.fillStyle = "rgba(52,42,32,0.9)";
    ctx.fillRect(0, y0 + rh - 1.6, S, 1.6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

/** Broad tropical leaf for the potted plant: base at origin, leans toward +z. */
function makeLeafGeo() {
  const geo = new THREE.PlaneGeometry(4.8, 13, 2, 9);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i); // -2.4 .. 2.4
    const t = (pos.getY(i) + 6.5) / 13; // 0 base → 1 tip
    const w = Math.sin(t * Math.PI) * 0.9 + 0.1;
    pos.setX(i, lx * w);
    pos.setY(i, t * 13 * (1 - 0.1 * t));
    pos.setZ(i, Math.pow(t, 1.7) * 10.5);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Pack a list of {x,y,z,sx,sy,sz} world-aligned boxes into one InstancedMesh.
 *  sx / sz are extents along the world X / Z axes (no rotation support needed —
 *  walls, wainscot, shoji frames and beams are all axis-aligned). */
function makeInstanced(boxes, material, { cast = false, receive = true } = {}) {
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

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EVENING.exposure;
  renderer.domElement.classList.add("gl");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(EVENING.bg);
  scene.fog = new THREE.Fog(EVENING.bg, 260, 560);

  const camera = new THREE.PerspectiveCamera(
    40,
    container.clientWidth / container.clientHeight,
    0.1,
    1200,
  );
  camera.position.set(-40, 70, 95);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 18, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.492;
  controls.minDistance = 14;
  controls.maxDistance = 320;

  // left mouse stays free for object dragging & sculpting:
  // RMB = orbit around the tank · Shift+RMB = pan · wheel / MMB = zoom
  // (OrbitControls natively swaps ROTATE->PAN when shiftKey/ctrlKey is held)
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.zoomSpeed = 1.15;
  controls.panSpeed = 1.6;

  // ---- lights ----
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(-38, 70, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // snug ortho frustum + soft blur: texels stay dense over the tank & stand,
  // and PCF blur keeps the dojo's shadow edges gentle
  key.shadow.camera.left = -70;
  key.shadow.camera.right = 70;
  key.shadow.camera.top = 70;
  key.shadow.camera.bottom = -60;
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 220;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.05;
  key.shadow.blurSamples = 12;
  key.shadow.radius = 4;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbbd0ff, 1.1);
  fill.position.set(45, 34, -40);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9a3, 1.3);
  rim.position.set(8, 22, 68);
  scene.add(rim);

  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(amb);

  // display light over the tank (aquarium-style)
  // wide cone with near-max penumbra: tall sculpted terrain must not get a
  // hard lit/unlit cone-edge line crawling across faces while orbiting.
  // 4300/d² ≈ 0.22-0.8 across the tank: spot-lit leaf faces stay rich green
  // (sweep-calibrated; higher clips flat top leaves to pale sage after ACES).
  const spot = new THREE.SpotLight(0xfff6e4, 4300, 320, Math.PI / 3.1, 0.9, 2);
  spot.position.set(0, 96, 12);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  // tight near/far = better depth precision → no dapple on the stand top
  spot.shadow.camera.near = 40;
  spot.shadow.camera.far = 200;
  spot.shadow.bias = -0.0002;
  spot.shadow.normalBias = 0.04;
  spot.shadow.blurSamples = 12;
  spot.shadow.radius = 4;
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 0, 0);
  scene.add(spotTarget);
  spot.target = spotTarget;
  scene.add(spot);

  // ================================================================
  // ---- dojo room ----
  // All planes face inward, so orbiting outside the room gives a clean
  // dollhouse view (backfaces are culled) instead of blank walls.
  // ================================================================
  const room = new THREE.Group();

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tatamiTex = makeTatamiTexture();
  const plankTex = makePlankTexture(aniso);
  plankTex.repeat.set(230 / 60, 190 / 60);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    dithering: true,
  });
  const wainscotMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    dithering: true,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    dithering: true,
  });
  const beamMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    dithering: true,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    dithering: true,
  });
  const paperMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    dithering: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const tatamiMat = new THREE.MeshStandardMaterial({
    map: tatamiTex,
    color: 0xffffff,
    roughness: 0.95,
    dithering: true,
  });
  const woodFloorMat = new THREE.MeshStandardMaterial({
    map: plankTex,
    color: 0xffffff,
    roughness: 0.8,
    dithering: true,
  });
  const baseFloorMat = new THREE.MeshStandardMaterial({
    color: 0x2a2018,
    roughness: 1,
    dithering: true,
  });

  // ---- floor: tatami border + raised wood training area ----
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * RX, 2 * RZ),
    baseFloorMat,
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.02;
  base.receiveShadow = true;
  room.add(base);

  const woodFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(230, 190),
    woodFloorMat,
  );
  woodFloor.rotation.x = -Math.PI / 2;
  woodFloor.position.y = 0.3;
  woodFloor.receiveShadow = true;
  room.add(woodFloor);

  // tatami mats: 8 along front/back walls (85×55), 4 along sides (55×95)
  const matBoxes = [];
  for (const z of [RZ - 27.5, -RZ + 27.5])
    for (const x of [-127.5, -42.5, 42.5, 127.5])
      matBoxes.push({ x, y: 1.2, z, sx: 85, sy: 2.4, sz: 55 });
  for (const x of [RX - 27.5, -RX + 27.5])
    for (const z of [-47.5, 47.5])
      matBoxes.push({ x, y: 1.2, z, sx: 55, sy: 2.4, sz: 95 });
  // tatami is floor — it receives tank shadows but never casts (its own edge
  // shadows would stripe the wood floor at glancing light)
  room.add(makeInstanced(matBoxes, tatamiMat));

  // ---- walls (inward-facing planes) ----
  const wallDefs = [
    { cx: 0, cz: -RZ, nx: 0, nz: 1 }, // back
    { cx: 0, cz: RZ, nx: 0, nz: -1 }, // front
    { cx: -RX, cz: 0, nx: 1, nz: 0 }, // left
    { cx: RX, cz: 0, nx: -1, nz: 0 }, // right
  ];
  for (const w of wallDefs) {
    const alongX = w.nz !== 0;
    const geo = new THREE.PlaneGeometry(alongX ? 2 * RX : 2 * RZ, RH);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.set(w.cx, RH / 2, w.cz);
    wall.rotation.y = alongX
      ? w.nz > 0
        ? 0
        : Math.PI
      : w.nx > 0
        ? Math.PI / 2
        : -Math.PI / 2;
    wall.receiveShadow = true;
    room.add(wall);
  }

  // ---- wainscoting: base rail + cap rail + vertical slats on every wall ----
  const wain = [];
  for (const w of wallDefs) {
    const alongX = w.nz !== 0;
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
  }
  room.add(makeInstanced(wain, wainscotMat)); // shell: receives, never casts

  // ---- shoji screens: back wall (5 panels) + both side walls (4 each) ----
  // Lattice: pillars between panels, top & bottom rails, then a fine kumiko
  // grid (5 cols × ~25 rows — cells stay square via the auto-computed rows)
  // over glowing paper.
  const frameBoxes = [];
  const PAPER_W = 50,
    BAR = 1.2;
  const paperGeo = new THREE.PlaneGeometry(PAPER_W, PH - 6);

  function addShojiWall(cx, cz, nx, nz, len, n) {
    const alongX = nz !== 0;
    const outward = alongX ? nz : nx; // +1 if wall faces +z/+x
    const off = 0.6 * outward; // lift frames/paper off the wall
    // helper: place a box at (u = along-wall coord, y, v = depth offset from wall)
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
      room.add(paper);
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
  }

  addShojiWall(0, -RZ, 0, 1, 2 * RX, 5); // back — the hero wall
  addShojiWall(-RX, 0, 1, 0, 2 * RZ, 4); // left
  addShojiWall(RX, 0, -1, 0, 2 * RZ, 4); // right
  // Shoji paper diffuses light — the room shell must NOT throw hard slat/beam
  // shadows into the tank area (they read as crawling bands when orbiting).
  // The shell still RECEIVES shadows from the tank and plant.
  room.add(makeInstanced(frameBoxes, frameMat));

  // warm point lights in the upper room — the evening lamp glow
  // (in day mode their intensity drops to 0; the glowing shoji paper takes over)
  // Heights left at their original values: the sources are invisible, and
  // moving them with the roof would change the calibrated plant/room shading.
  const lampA = new THREE.PointLight(0xffb36b, 0, 240, 1.6);
  lampA.position.set(-60, 96, 30);
  scene.add(lampA);
  const lampB = new THREE.PointLight(0xffb36b, 0, 240, 1.6);
  lampB.position.set(60, 96, -30);
  scene.add(lampB);

  // ---- potted plant: black ceramic pot + broad tropical leaves ----
  const plant = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({
    color: 0x141416,
    roughness: 0.25,
    metalness: 0.1,
    dithering: true,
  });
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 5, 11, 18),
    potMat,
  );
  pot.position.y = 5.5;
  pot.castShadow = true;
  pot.receiveShadow = true;
  plant.add(pot);
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x2a2118,
    roughness: 1,
    dithering: true,
  });
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(6.1, 6.1, 1, 18),
    soilMat,
  );
  soil.position.y = 10.8;
  plant.add(soil);
  const leafGeo = makeLeafGeo();
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x2e5c33,
    roughness: 0.68,
    side: THREE.DoubleSide,
    dithering: true,
  });
  const leafRnd = mulberry32(9182);
  for (let i = 0; i < 14; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    // fan leaves radially: YXZ order = spin to heading first, then pitch the
    // leaf's +z lean outward from the pot centre, small roll for variety
    const a = (i / 14) * Math.PI * 2 + leafRnd() * 0.4;
    leaf.rotation.order = "YXZ";
    leaf.rotation.y = -a;
    leaf.rotation.x = 0.22 + leafRnd() * 0.45;
    leaf.rotation.z = (leafRnd() - 0.5) * 0.25;
    leaf.position.set(0, 10, 0);
    const s = 0.75 + leafRnd() * 0.7;
    leaf.scale.setScalar(s);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  plant.position.set(RX - 33, 2.4, RZ - 62); // resting on the tatami ring, front-right
  room.add(plant);

  // ---- ceiling: coffered kumiko beam grid ----
  // Offsets hang below the roof line RH, so the coffer keeps identical bar
  // sizes/spacing (and the kumiko cells their scale) at any room height.
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
  room.add(makeInstanced(beamBoxes, beamMat)); // shell: receives, never casts

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * RX, 2 * RZ),
    ceilMat,
  );
  ceiling.rotation.x = Math.PI / 2; // faces down
  ceiling.position.y = RH;
  room.add(ceiling);

  scene.add(room);

  function setStageY(y) {
    room.position.y = y;
  }
  setStageY(0);

  function setTankFocus(x, y, z) {
    spot.position.set(x, y + 86, z + 14);
    spotTarget.position.set(x, y, z);
  }

  function setTheme(light) {
    const T = light ? DAY : EVENING;
    scene.background.set(T.bg);
    scene.fog.color.set(T.bg);
    wallMat.color.set(T.wall);
    wainscotMat.color.set(T.wainscot);
    frameMat.color.set(T.frame);
    beamMat.color.set(T.beam);
    ceilMat.color.set(T.ceil);
    paperMat.color.set(T.paper);
    paperMat.emissive.set(T.paperGlow);
    paperMat.emissiveIntensity = T.paperGlowI;
    woodFloorMat.color.set(T.floorWood);
    tatamiMat.color.set(T.tatami);
    hemi.color.set(T.hemiSky);
    hemi.groundColor.set(T.hemiGnd);
    hemi.intensity = T.hemi;
    amb.color.set(T.ambColor);
    amb.intensity = T.amb;
    key.color.set(T.keyColor);
    key.intensity = T.key;
    fill.intensity = T.fill;
    rim.intensity = T.rim;
    lampA.intensity = T.lamp;
    lampB.intensity = T.lamp;
    renderer.toneMappingExposure = T.exposure;
  }
  setTheme(false);

  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", resize);

  return {
    renderer,
    scene,
    camera,
    controls,
    resize,
    setStageY,
    setTankFocus,
    setTheme,
    key,
  };
}

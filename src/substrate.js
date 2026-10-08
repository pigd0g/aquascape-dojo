// Sculptable substrate heightfield with painted top-dress layer.
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { SUBSTRATES } from './presets.js';
import { mulberry32, clamp, smoothstep } from './noise.js';

// Seeded dune noise — the shared `fbm()` helper in noise.js is broken (its
// integer hash overflows JS float precision and always returns 0, so it has no
// gradient at all). Dunes use simplex-noise directly with a fixed seed, which
// keeps them deterministic like the rest of the repo without silently
// changing the wood generator, which is the other `fbm` consumer.
const duneNoise = createNoise3D(mulberry32(0x0d0e));

/**
 * Paintbrush glyph for the paint/erase cursor. The canvas is drawn with the
 * brush TIP at the exact centre, so a centre-anchored sprite puts the tip on
 * the cursor point — the same point `paintDress()` paints.
 */
let _brushCursorTex = null;
function brushCursorTexture() {
  if (_brushCursorTex) return _brushCursorTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-Math.PI / 4); // leans up-right, leaving the cursor point clear
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  // bristles — tip sits exactly at the canvas centre (the cursor point)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(20, -11, 44, -11);
  ctx.lineTo(50, -11);
  ctx.lineTo(50, 11);
  ctx.lineTo(44, 11);
  ctx.quadraticCurveTo(20, 11, 0, 0);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
  // ferrule
  rr(50, -12, 21, 24, 4);
  ctx.fillStyle = '#cfcfcf';
  ctx.fill();
  ctx.stroke();
  // handle
  rr(71, -10, 52, 20, 10);
  ctx.fillStyle = '#9a9a9a';
  ctx.fill();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _brushCursorTex = tex;
  return tex;
}

export class Substrate {
  constructor(scene, tank) {
    this.tank = tank;
    this.baseType = 'soil';
    this.dressType = 'sand';
    this.baseTint = 0;
    this.dressTint = 0;
    // custom colour overrides (hex strings); null = use the swatch tints
    this.baseCustom = null;
    this.dressCustom = null;

    this.brush = { kind: 'raise', tool: 'sculpt', radius: 8, strength: 1.1 };
    this.grainSeed = 1234;

    this.group = new THREE.Group();
    this.group.name = 'substrate';
    scene.add(this.group);

    this._splatter = null;
    this._build();
    this._makeTextures();
    this._makeMaterial();
    this.reset(this._baseDepth, true);
  }

  get _baseDepth() { return clamp(this.tank.state.h * 0.14, 3, 10); }

  get segW() { return clamp(Math.round(this.tank.state.w * 1.4), 48, 176); }
  get segD() { return clamp(Math.round(this.tank.state.d * 1.4), 40, 140); }

  get volumeLitres() {
    // integrate cell heights (cm) × cell area (cm²) → cm³ → L
    const { w, d } = this.tank.state;
    const sw = this.segW, sd = this.segD;
    const cw = w / sw, cd = d / sd;
    let sum = 0;
    const H = this.heights, W = sw + 1;
    for (let j = 0; j < sd; j++) {
      for (let i = 0; i < sw; i++) {
        const h00 = H[j * W + i], h10 = H[j * W + i + 1];
        const h01 = H[(j + 1) * W + i], h11 = H[(j + 1) * W + i + 1];
        sum += ((h00 + h10 + h01 + h11) * 0.25) * cw * cd;
      }
    }
    return sum / 1000;
  }

  _build() {
    // cursors are rebuilt with every mesh; dispose their materials & geometries
    // first so tank resizes don't leak GPU memory
    if (this.cursor) {
      this.cursor.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.cursor = null;
    }
    this.brushCursor?.material.dispose();
    this.brushCursor = null;

    for (let i = this.group.children.length - 1; i >= 0; i--) this.group.remove(this.group.children[i]);
    const { w, d } = this.tank.state;
    const sw = this.segW, sd = this.segD;
    const x0 = -w / 2, z0 = -d / 2;

    const vertCount = (sw + 1) * (sd + 1);
    this.heights = new Float32Array(vertCount);
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = [];
    for (let j = 0; j <= sd; j++) {
      for (let i = 0; i <= sw; i++) {
        const k = j * (sw + 1) + i;
        positions[k * 3] = x0 + (i / sw) * w;
        positions[k * 3 + 1] = 0;
        positions[k * 3 + 2] = z0 + (j / sd) * d;
        uvs[k * 2] = i / sw;
        uvs[k * 2 + 1] = j / sd;
      }
    }
    for (let j = 0; j < sd; j++) {
      for (let i = 0; i < sw; i++) {
        const a = j * (sw + 1) + i, b = a + 1, c = a + sw + 1, e = c + 1;
        indices.push(a, c, b, b, c, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    // ---- skirts: border edges drop to just under the interior floor so the
    // substrate reads as a solid block meeting the tank bottom, not a sheet.
    const skirtY = -0.35;
    const W1 = sw + 1;
    const rimTopIdx = [
      ...Array.from({ length: sw + 1 }, (_, i) => i),                       // front j=0
      ...Array.from({ length: sd + 1 }, (_, j) => j * W1 + sw),             // right i=sw
      ...Array.from({ length: sw + 1 }, (_, i) => sd * W1 + (sw - i)),      // back
      ...Array.from({ length: sd + 1 }, (_, j) => (sd - j) * W1 + 0),       // left
    ];
    // Skirt with DEDICATED vertices: quads below the rim must not reuse the
    // rim's top-surface verts, because those carry the granular top UVs
    // (v spanning the whole tiled texture) — a tall thin strip minifying the
    // full grain texture collapses to per-column averages = the vertical
    // barcode banding that shimmers on every camera move. So: ring A = copy
    // of rim (tracks heights, side-texture UVs), ring B = bottom edge at
    // skirtY. Skirt quads use only A/B verts; the top surface keeps the
    // originals. Group 0 = top (granular mat) · group 1 = skirt (side mat).
    const bottomStart = vertCount;
    const skirtTopStart = vertCount + rimTopIdx.length;
    const totalVerts = vertCount + rimTopIdx.length * 2;
    const allPositions = new Float32Array(totalVerts * 3);
    allPositions.set(positions);
    const skirtBaseU = new Float32Array(rimTopIdx.length);  // arc-length param
    let acc = 0;
    for (let s = 0; s < rimTopIdx.length; s++) {
      const t = rimTopIdx[s];
      if (s > 0) {
        const p = rimTopIdx[s - 1];
        acc += Math.hypot(positions[t * 3] - positions[p * 3], positions[t * 3 + 2] - positions[p * 3 + 2]);
      }
      skirtBaseU[s] = acc;
      // ring A: same x/y/z as rim (updated in _refresh)
      allPositions[(skirtTopStart + s) * 3] = positions[t * 3];
      allPositions[(skirtTopStart + s) * 3 + 1] = positions[t * 3 + 1];
      allPositions[(skirtTopStart + s) * 3 + 2] = positions[t * 3 + 2];
      // ring B: bottom edge at skirtY
      allPositions[(bottomStart + s) * 3] = positions[t * 3];
      allPositions[(bottomStart + s) * 3 + 1] = skirtY;
      allPositions[(bottomStart + s) * 3 + 2] = positions[t * 3 + 2];
    }
    const perimeter = acc || 1;
    let geoFinal = geo;
    {
      const skirtIdx = [];
      const R = rimTopIdx.length;
      for (let s = 0; s < R; s++) {
        const s2 = (s + 1) % R;
        const a0 = skirtTopStart + s, a1 = skirtTopStart + s2;
        const b0 = bottomStart + s, b1 = bottomStart + s2;
        // winding matches the original skirt strip (outward faces)
        skirtIdx.push(a0, a1, b0, a1, b1, b0);
      }
      // The skirt (vertical cut face) gets its OWN material via geometry
      // groups: group 0 = top granular, group 1 = skirt side texture.
      const topCount = indices.length;
      const newIdx = new Uint32Array(indices.length + skirtIdx.length);
      newIdx.set(indices, 0);
      newIdx.set(skirtIdx, indices.length);
      geoFinal.addGroup(0, topCount, 0);
      geoFinal.addGroup(topCount, skirtIdx.length, 1);
      // skirt UVs: u = arc length / tile (≈ one side-texture tile per 30cm),
      // v: ring A at the top of the side texture, ring B at its bottom
      const V_TOP = 0.92, V_BOT = 0.04;
      const allUv = new Float32Array(totalVerts * 2);
      allUv.set(uvs);
      for (let s = 0; s < rimTopIdx.length; s++) {
        const uSide = (skirtBaseU[s] / perimeter) * Math.max(1, Math.round((w) / 30));
        allUv[(skirtTopStart + s) * 2] = uSide;
        allUv[(skirtTopStart + s) * 2 + 1] = V_TOP;
        allUv[(bottomStart + s) * 2] = uSide;
        allUv[(bottomStart + s) * 2 + 1] = V_BOT;
      }
      geoFinal.setAttribute('position', new THREE.BufferAttribute(allPositions, 3));
      geoFinal.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
      geoFinal.setIndex(new THREE.BufferAttribute(newIdx, 1));
    }

    this._topVertCount = vertCount;
    this._botStart = bottomStart;
    this._skirtTopStart = skirtTopStart;
    this._skirtCount = rimTopIdx.length;
    geo.userData.rimTopIdx = rimTopIdx;

    this.mesh = new THREE.Mesh(geoFinal, null);
    this.mesh.name = 'substrateMesh';
    this.mesh.receiveShadow = true;
    // Never cast: the mesh is fully enclosed by the glass, so its only exterior
    // shadow is projected through the tank onto the stand top, where the
    // heightfield's per-texel steps alias into hashed stripes under the
    // overhead lights. Interior hardscape/plant shadows still land on it.
    this.mesh.castShadow = false;
    this.group.add(this.mesh);

    // brush cursor
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xd9b36a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 20;
    ring.visible = false;
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 12),
      new THREE.MeshBasicMaterial({ color: 0xd9b36a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
    );
    // NO rotation on the dot: it is parented to the already floor-rotated ring,
    // so a second -90° X would stand the disc upright (it read as a vertical
    // "tick" inside the flat ring). Radii don't overlap, so no z-fighting.
    dot.renderOrder = 21;
    ring.add(dot);
    this.cursor = ring;
    this.cursorDot = dot;
    this.group.add(ring);

    // Paint/erase adds a brush glyph on top of the footprint ring — the tip
    // sits exactly on the cursor point (the canvas glyph is centred on its
    // tip), so "paints where you point" is visible, and like the ring it
    // scales with the brush radius via [ ] / the size slider.
    const brushTex = brushCursorTexture();
    this.brushCursor = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: brushTex, transparent: true, depthTest: false, depthWrite: false })
    );
    this.brushCursor.renderOrder = 22;
    this.brushCursor.visible = false;
    this.brushCursor.center.set(0.5, 0.5);
    this.group.add(this.brushCursor);
  }

  _makeTextures() {
    this._splatCanvas = document.createElement('canvas');
    this._splatCanvas.width = 512;
    this._splatCanvas.height = 512;
    this._splatCtx = this._splatCanvas.getContext('2d');
    this._clearSplat();
    this.splatTex = new THREE.CanvasTexture(this._splatCanvas);
    this.splatTex.wrapS = this.splatTex.wrapT = THREE.ClampToEdgeWrapping;

    this._dressTex = this._grainTexture(this.dressType, this.dressTint, this.dressCustom);
    this._baseTex = this._grainTexture(this.baseType, this.baseTint, this.baseCustom);
  }

  /**
   * Procedural grain texture for one substrate layer. `customHex`, when set,
   * replaces the tint swatch as the base colour (the Custom picker path);
   * pass `null`/undefined to use the tint list.
   */
  _grainTexture(typeKey, tint, customHex = null) {
    const def = SUBSTRATES[typeKey];
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const rnd = mulberry32((this.grainSeed || 1234) + tint * 77 + typeKey.length * 31);
    const col = new THREE.Color(customHex || (tint >= 0 ? def.tints[tint % def.tints.length] : def.base));
    const [r, g, b] = [col.r * 255, col.g * 255, col.b * 255];

    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(0, 0, S, S);

    // broad mottling
    for (let i = 0; i < 130; i++) {
      const x = rnd() * S, y = rnd() * S, rad = 40 + rnd() * 220;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const shade = (rnd() - 0.5) * 0.22 * 255;
      gr.addColorStop(0, `rgba(${clamp(r + shade, 0, 255) | 0},${clamp(g + shade, 0, 255) | 0},${clamp(b + shade, 0, 255) | 0},0.16)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // grains — soft alpha-blended dots keep per-grain contrast low: hard 1px
    // speckle is what aliases into crawl-stripe noise at glancing angles
    const n = 52000 * (0.6 + def.granularity * 0.7);
    for (let i = 0; i < n; i++) {
      const x = rnd() * S, y = rnd() * S;
      const s = 1.2 + rnd() * (1.6 + def.grain * 1.1);
      const v = (rnd() - 0.5) * 2 * def.contrast * 255 * 0.55;
      ctx.fillStyle = `rgba(${clamp(r + v, 0, 255) | 0},${clamp(g + v, 0, 255) | 0},${clamp(b + v, 0, 255) | 0},${0.25 + rnd() * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.6, 0, 6.29);
      ctx.fill();
    }
    // sparkle — bigger, fainter dots (single-texel sparkles are shimmer fuel)
    if (def.sparkle > 0.01) {
      for (let i = 0; i < 2400 * def.sparkle; i++) {
        const x = rnd() * S, y = rnd() * S, s = 1.6 + rnd() * 1.4;
        ctx.fillStyle = `rgba(255,252,240,${0.12 + rnd() * 0.28})`;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, 6.29);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;   // vertical faces + glancing angles need max SISO
    return tex;
  }

  _makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      map: this._baseTex,
      // bump adds grain sparkle up close, but at room-view distance a strong
      // bump makes faces crawl/shimmer while orbiting: keep a whisper of it
      bumpMap: this._baseTex,
      bumpScale: 0.35,
      roughness: SUBSTRATES[this.baseType].rough,
      metalness: 0,
      dithering: true,   // breaks up 8-bit contour banding on smooth light gradients
    });
    const uniforms = {
      splatMap: { value: this.splatTex },
      dressMap: { value: this._dressTex },
      uDressRepeat: { value: new THREE.Vector2(8, 8) },
      uDressRough: { value: SUBSTRATES[this.dressType].rough },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      // The splat mask covers the tank exactly once, so it must sample the
      // plain mesh UV. vMapUv carries the base map's repeat (rx×ry) — sampling
      // the splat with it shifted/multiplied every painted blob away from the
      // cursor (a dot painted at the centre appeared near the back-left edge).
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSplatUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplatUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D splatMap;\nuniform sampler2D dressMap;\nuniform vec2 uDressRepeat;\nuniform float uDressRough;\nvarying vec2 vSplatUv;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float splat = texture2D( splatMap, vSplatUv ).r;
          vec3 dressCol = texture2D( dressMap, vMapUv * uDressRepeat ).rgb;
          diffuseColor.rgb = mix( diffuseColor.rgb, dressCol, splat );`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          float splatR = texture2D( splatMap, vSplatUv ).r;
          roughnessFactor = mix( roughnessFactor, uDressRough, splatR );`
        );
    };
    mat.customProgramCacheKey = () => 'substrate';
    this.material = mat;
    this._uniforms = uniforms;
    // side material for the vertical cut face (group 1): soft horizontal
    // banding — reads as compacted substrate layers, immune to minification
    // streaks because its features are wide & low-contrast
    if (!this._sideMat) {
      this._sideMat = new THREE.MeshStandardMaterial({
        map: Substrate._makeSideTexture(this.baseType, this.baseTint, this.grainSeed, this.baseCustom),
        roughness: SUBSTRATES[this.baseType].rough,
        metalness: 0,
        dithering: true,
      });
    } else {
      this._sideMat.map = Substrate._makeSideTexture(this.baseType, this.baseTint, this.grainSeed, this.baseCustom);
      this._sideMat.needsUpdate = true;
    }
    this._sideMat.roughness = SUBSTRATES[this.baseType].rough;
    this.mesh.material = [mat, this._sideMat];
    this._updateRepeat();
  }

  /** Side-cut texture: dark base with soft horizontal stratification bands. */
  static _makeSideTexture(typeKey, tint, grainSeed = 1234, customHex = null) {
    const def = SUBSTRATES[typeKey];
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const rnd = mulberry32((grainSeed || 1234) + tint * 31 + typeKey.length * 17 + 977);
    const col = new THREE.Color(customHex || (tint >= 0 ? def.tints[tint % def.tints.length] : def.base));
    // sides read darker than the lit top face
    col.multiplyScalar(0.55);
    const [r, g, b] = [col.r * 255, col.g * 255, col.b * 255];
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(0, 0, S, S);
    // soft horizontal strata bands (compacted layers)
    for (let i = 0; i < 26; i++) {
      const y = rnd() * S;
      const h = 6 + rnd() * 26;
      const shade = (rnd() - 0.5) * 0.16 * 255;
      const gr = ctx.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, `rgba(${clamp(r + shade, 0, 255) | 0},${clamp(g + shade, 0, 255) | 0},${clamp(b + shade, 0, 255) | 0},0.5)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, y, S, h);
    }
    // faint grain speckle (low contrast, soft)
    for (let i = 0; i < 4200; i++) {
      const x = rnd() * S, y = rnd() * S;
      const v = (rnd() - 0.5) * 0.1 * 255;
      ctx.fillStyle = `rgba(${clamp(r + v, 0, 255) | 0},${clamp(g + v, 0, 255) | 0},${clamp(b + v, 0, 255) | 0},0.2)`;
      ctx.fillRect(x, y, 2.2, 1.4);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    return tex;
  }

  _updateRepeat() {
    const { w, d } = this.tank.state;
    // tile every ~14cm of tank — coarse tiles mean gentler minification at
    // glancing angles (fine tiling = the crawling-speckle complaint)
    const rx = Math.max(1, Math.round(w / 14));
    const ry = Math.max(1, Math.round(d / 14));
    for (const t of [this._baseTex]) {
      t.repeat.set(rx, ry);
    }
    if (this._uniforms) this._uniforms.uDressRepeat.value.set(rx * 2, ry * 2);
  }

  _clearSplat() {
    const c = this._splatCtx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 512, 512);
  }

  _syncSplat() {
    this.splatTex.needsUpdate = true;
  }

  // ---------- heightfield ops ----------
  reset(depth, silent = false) {
    const prev = this.heights.slice();
    this.heights.fill(depth);
    this._refresh();
    if (!silent) return { prev };
    return null;
  }

  heightAt(x, z) {
    const { w, d } = this.tank.state;
    const sw = this.segW, sd = this.segD;
    const fx = clamp(((x + w / 2) / w) * sw, 0, sw - 1e-4);
    const fz = clamp(((z + d / 2) / d) * sd, 0, sd - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const W = sw + 1;
    const H = this.heights;
    const h00 = H[j * W + i], h10 = H[j * W + i + 1];
    const h01 = H[(j + 1) * W + i], h11 = H[(j + 1) * W + i + 1];
    // triangle-EXACT interpolation matching the mesh's quad split (a,c,b)/(b,c,e),
    // diagonal from (i, j+1) to (i+1, j) — so raycast height == heightAt always
    if (tx + tz <= 1) {
      // lower-left triangle: corners (0,0) (1,0) (0,1)
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }
    // upper-right triangle: corners (1,0) (1,1) (0,1)
    return (h10 + h01 - h11) + (h11 - h01) * tx + (h11 - h10) * tz;
  }

  _refresh() {
    const pos = this.mesh.geometry.attributes.position;
    const H = this.heights;
    for (let k = 0; k < H.length; k++) pos.array[k * 3 + 1] = H[k];
    // skirt ring A mirrors the rim heights so the vertical face follows sculpting
    if (this._skirtTopStart !== undefined) {
      const geo = this.mesh.geometry;
      const { rimTopIdx } = geo.userData;
      if (rimTopIdx) {
        for (let s = 0; s < rimTopIdx.length; s++) {
          const t = rimTopIdx[s];
          pos.array[(this._skirtTopStart + s) * 3 + 1] = H[t];
        }
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }

  applyBrush(cx, cz, brush, dtScale = 1) {
    const { w, d } = this.tank.state;
    const sw = this.segW, sd = this.segD;
    const R = brush.radius;
    const W = sw + 1;
    const H = this.heights;
    const i0 = Math.max(0, Math.floor((((cx - R) + w / 2) / w) * sw));
    const i1 = Math.min(sw, Math.ceil((((cx + R) + w / 2) / w) * sw));
    const j0 = Math.max(0, Math.floor((((cz - R) + d / 2) / d) * sd));
    const j1 = Math.min(sd, Math.ceil((((cz + R) + d / 2) / d) * sd));
    const cellW = w / sw, cellD = d / sd;
    const amp = brush.strength * dtScale * 0.45;
    // flatten target: sample terrain at brush center on first stamp
    if (brush.kind === 'flatten' && brush._flatTarget == null) {
      brush._flatTarget = this.heightAt(cx, cz);
    }
    const target = brush._flatTarget ?? 0;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -w / 2 + i * cellW, pz = -d / 2 + j * cellD;
        const dist = Math.hypot(px - cx, pz - cz);
        if (dist > R) continue;
        const fall = smoothstep(1, 0.15, dist / R);
        const k = j * W + i;
        switch (brush.kind) {
          case 'raise': H[k] += amp * fall; break;
          case 'lower': H[k] -= amp * fall; break;
          case 'smooth': {
            const im = Math.max(0, i - 1), ip = Math.min(sw, i + 1);
            const jm = Math.max(0, j - 1), jp = Math.min(sd, j + 1);
            const avg = (H[j * W + im] + H[j * W + ip] + H[jm * W + i] + H[jp * W + i]) * 0.25;
            H[k] += (avg - H[k]) * Math.min(1, 0.55 * fall) * dtScale;
            break;
          }
          case 'flatten': H[k] += (target - H[k]) * Math.min(1, 0.6 * fall) * dtScale; break;
        }
      }
    }
    const capY = this.tank.state.h - 1.0;
    for (let k = i0; k <= i1; k++) void k;
    // clamp only in brush rect for speed
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (H[k] < 0) H[k] = 0;
        else if (H[k] > capY) H[k] = capY;
      }
    }
    this._refresh();
  }

  // ---- splat painting ----
  paintDress(cx, cz, radius, erase) {
    const { w, d } = this.tank.state;
    // Mask space maps the tank w×d onto the square canvas exactly once (the
    // shader samples it with the raw mesh UV). A world-circle is therefore an
    // ellipse in mask space on non-square tanks — draw it under a compensating
    // scale so the painted blob is round on the floor.
    const px = ((cx + w / 2) / w) * 512;
    const py = (1 - (cz + d / 2) / d) * 512;
    const prx = Math.max(3, (radius / w) * 512);
    const pry = Math.max(3, (radius / d) * 512);
    const ctx = this._splatCtx;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, pry / prx);
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const gr = ctx.createRadialGradient(0, 0, prx * 0.35, 0, 0, prx);
    gr.addColorStop(0, `rgba(255,255,255,${erase ? 1 : 0.9})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, prx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this._syncSplat();
  }

  clearDress() {
    this._clearSplat();
    this._syncSplat();
  }

  // ---- layout presets ----
  preset(name) {
    const { w, d, h } = this.tank.state;
    const sw = this.segW, sd = this.segD;
    const W = sw + 1;
    const H = this.heights;
    const prev = this.heights.slice();
    const base = this.heights.length ? this.heights[0] : 4;
    const rnd = mulberry32(97 + name.length * 13);
    const maxH = Math.min(h * 0.5, 16);
    const cellW = w / sw, cellD = d / sd;

    const blur = (it = 2) => {
      for (let n = 0; n < it; n++) {
        const C = H.slice();
        for (let j = 1; j < sd; j++) {
          for (let i = 1; i < sw; i++) {
            const k = j * W + i;
            H[k] = (C[k] * 4 + C[k - 1] + C[k + 1] + C[k - W] + C[k + W]) / 8;
          }
        }
      }
    };

    // Every preset is sampled 180°-rotated about the tank centre (u/v flipped)
    // so it reads correctly from the default camera at +Z: the classic slope
    // rises toward the BACK of the tank, not toward the viewer.
    for (let j = 0; j <= sd; j++) {
      for (let i = 0; i <= sw; i++) {
        const x = i * cellW, z = j * cellD;
        const u = 1 - x / w, v = 1 - z / d;
        let val = base;
        if (name === 'slope') {
          const t = smoothstep(0.05, 0.95, v);
          val = base + maxH * t * t * (1 - 0.25 * Math.abs(u - 0.5) * 2);
        } else if (name === 'island') {
          const dx = (u - 0.5) * 2, dy = (v - 0.45) * 2;
          val = base + maxH * Math.exp(-(dx * dx + dy * dy) * 1.9);
        } else if (name === 'terrace') {
          const inX = smoothstep(0.08, 0.3, u) * (1 - smoothstep(0.7, 0.92, u));
          const step = v > 0.55 ? 1 : 0.35;
          val = base + maxH * 0.8 * inX * step;
        } else if (name === 'valley') {
          const g = Math.exp(-Math.pow((u - 0.5) * 2.4, 2));
          const slope = smoothstep(0, 0.9, v);
          val = base + maxH * (0.75 * slope * (1 - g * 0.85) + 0.18 * g);
        } else if (name === 'dune') {
          // a touch bumpier than the original flat sand field: two simplex
          // octaves (a broad dune swell + a finer ripple train), while keeping
          // the same gentle character — the reduced blur below preserves them
          const swell = duneNoise(x * 0.022, 7, z * 0.03);
          const ripple = duneNoise(x * 0.075, 31, z * 0.09);
          const f = (swell * 0.82 + ripple * 0.18 + 1) * 0.5; // noise is -1..1
          val = base + maxH * (0.32 + 0.68 * f) * (0.4 + 0.6 * v);
        }
        H[j * W + i] = val + (name === 'dune' || name === 'island' ? (rnd() - 0.5) * 0.4 : 0);
      }
    }
    blur(name === 'terrace' ? 3 : name === 'dune' ? 4 : 5);
    // clamp
    const cap = h - 1;
    for (let k = 0; k < H.length; k++) H[k] = clamp(H[k], 0, cap);
    this._refresh();
    return { prev };
  }

  /**
   * Full substrate reset ("Reset" button): level the heightfield back to the
   * base depth, wipe the painted top-dress mask, and report `prev` for undo.
   * Material / tint / custom-colour choices are intentionally untouched.
   */
  resetSubstrate() {
    const prev = this.heights.slice();
    this.clearDress();
    this.reset(this._baseDepth, true);
    return { prev };
  }

  /** Serialized state for save files. */
  serialize() {
    const sw = this.segW, sd = this.segD;
    // downsample mask to a compact base64 grayscale PNG-less string
    const splatCanvas = this._splatCanvas;
    return {
      base: this.baseType, dress: this.dressType,
      baseTint: this.baseTint, dressTint: this.dressTint,
      baseCustom: this.baseCustom, dressCustom: this.dressCustom,
      heights: Array.from(this.heights, (v) => Math.round(v * 100) / 100),
      splat: splatCanvas.toDataURL('image/png'),
    };
  }

  async deserialize(data) {
    this.baseType = data.base || 'soil';
    this.dressType = data.dress || 'sand';
    // custom overrides arrive from save data; older files simply omit them
    this.baseCustom = data.baseCustom ?? null;
    this.dressCustom = data.dressCustom ?? null;
    this._baseTex = this._grainTexture(this.baseType, this.baseTint, this.baseCustom);
    this._dressTex = this._grainTexture(this.dressType, this.dressTint, this.dressCustom);
    await new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        this._splatCtx.clearRect(0, 0, 512, 512);
        this._splatCtx.drawImage(img, 0, 0);
        this.splatTex.needsUpdate = true;
        res();
      };
      img.src = data.splat;
    });
    if (data.heights && data.heights.length === this.heights.length) {
      this.heights.set(data.heights.map((v) => clamp(v, 0, this.tank.state.h - 1)));
    }
    this.refreshMaterial();
    this._refresh();
  }

  refreshMaterial() {
    const oldBase = this._baseTex, oldDress = this._dressTex;
    this._baseTex = this._grainTexture(this.baseType, this.baseTint, this.baseCustom);
    this._dressTex = this._grainTexture(this.dressType, this.dressTint, this.dressCustom);
    const u = this._uniforms;
    if (u) {
      u.dressMap.value = this._dressTex;
      u.uDressRough.value = SUBSTRATES[this.dressType].rough;
      this._updateRepeat();
    }
    this.material.map = this._baseTex;
    this.material.bumpMap = this._baseTex;
    this.material.roughness = SUBSTRATES[this.baseType].rough;
    this.material.needsUpdate = true;
    // side texture follows the base type too
    if (this._sideMat) {
      const oldSide = this._sideMat.map;
      this._sideMat.map = Substrate._makeSideTexture(this.baseType, this.baseTint, this.grainSeed, this.baseCustom);
      this._sideMat.roughness = SUBSTRATES[this.baseType].rough;
      this._sideMat.needsUpdate = true;
      oldSide?.dispose();
    }
    if (oldBase) oldBase.dispose();
    if (oldDress) oldDress.dispose();
  }

  /**
   * Show the correct brush cursor for the active tool. Sculpting gets the flat
   * footprint ring; paint/erase gets the same footprint ring plus a paintbrush
   * glyph whose bristle tip sits exactly on the cursor point — the point
   * `paintDress()` paints. Everything is sized by the shared brush radius, so
   * `[` / `]` and either size slider grow and shrink the paintbrush just like
   * the sculpt cursor.
   */
  updateCursor(point, visible) {
    this._cursorPt = visible && point ? { x: point.x, y: point.y, z: point.z } : null;
    const erase = this.brush.tool === 'erase';
    const paintMode = this.brush.tool === 'paint' || erase;
    this.cursor.visible = visible;
    this.brushCursor.visible = visible && paintMode;
    if (!visible) return;
    const y = point.y + 0.4;
    const r = this.brush.radius;
    // the ring is the painted footprint in both modes: exact radius, tinted
    // per tool so the mode reads at a glance even before the glyph loads
    this.cursor.position.set(point.x, y, point.z);
    this.cursor.scale.set(r, r, r);
    const tint = erase ? 0xe06557 : 0xd9b36a;
    this.cursor.material.color.set(tint);
    this.cursor.material.opacity = paintMode ? 0.6 : 0.85;
    this.cursorDot?.material.color.set(tint);
    if (paintMode) {
      // sprite quads span 1 world unit per scale; the glyph runs ~0.48 of its
      // canvas from bristle tip to handle end, so 4.2×r makes the brush the
      // same visual length as the ring's diameter at the same radius
      const s = clamp(r * 4.2, 12, 140);
      this.brushCursor.position.set(point.x, y, point.z);
      this.brushCursor.scale.set(s, s, 1);
      this.brushCursor.material.color.set(tint);
    }
  }

  /** Re-run the cursor update after tool/size changed without a pointer move. */
  refreshCursor() {
    const p = this._cursorPt;
    if (p) this.updateCursor(p, true);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._sideMat?.dispose();
    this._baseTex?.dispose();
    this._dressTex?.dispose();
    this.splatTex.dispose();
    this.cursor?.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.brushCursor?.material.dispose();
  }
}
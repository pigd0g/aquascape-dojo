// Right-hand UI: library tabs + cards, substrate & tank panes, object inspector.
import * as THREE from 'three';
import { TANK_PRESETS, SUBSTRATES, ROCK_TYPES, WOOD_TYPES, PLANT_TYPES } from './presets.js';
import { applyHue as applyHueShift } from './placement.js';
import { rebuildRock, resetRockToDefaults } from './hardscape.js';
import { rerollPlant } from './plants.js';

const EM = { rock: '🪨', wood: '🪵', plant: '🌿', substrate: '⛰️', tank: '🛠️' };

export class Palette {
  constructor(placement, substrate, tank, sceneMgr) {
    this.placement = placement;
    this.substrate = substrate;
    this.tank = tank;
    this.sceneMgr = sceneMgr;

    this.el = document.getElementById('panel');
    this._bindTabs();
    this._buildCards();
    this._buildSubstratePane();
    this._buildTankPane();
    this._bindInspector();
    this._bindDragOut();
  }

  _bindTabs() {
    this.tabs = [...this.el.querySelectorAll('.tab')];
    this.tabs.forEach((t) => {
      t.addEventListener('click', () => {
        this.tabs.forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const tab = t.dataset.tab;
        for (const p of this.el.querySelectorAll('.pane')) {
          p.classList.toggle('hidden', p.id !== `pane-${tab}`);
        }
      });
    });
  }

  // ---------- cards ----------
  _buildCards() {
    const mkCard = (kindKey, key, def, em, meta) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.kind = kindKey;
      b.dataset.type = key;
      b.innerHTML = `<span class="em">${em}</span><span class="nm">${def.name}</span><span class="br">${def.brief}</span><span class="meta"><span>${meta}</span><span>drag →</span></span>`;
      return b;
    };

    const rockBox = document.querySelector('[data-cards="rock"]');
    for (const [key, def] of Object.entries(ROCK_TYPES)) {
      rockBox.appendChild(mkCard('rock', key, def, '🪨', 'stone'));
    }
    const woodBox = document.querySelector('[data-cards="wood"]');
    for (const [key, def] of Object.entries(WOOD_TYPES)) {
      woodBox.appendChild(mkCard('wood', key, def, '🪵', 'driftwood'));
    }
    const plantBox = document.querySelector('[data-cards="plant"]');
    for (const [key, def] of Object.entries(PLANT_TYPES)) {
      const cat = def.cat ?? 'Plant';
      plantBox.appendChild(mkCard('plant', key, def, '🌿', cat));
    }
  }

  // ---------- drag out ----------
  _bindDragOut() {
    const ghost = document.createElement('div');
    ghost.id = 'dragGhost';
    ghost.style.cssText = 'position:fixed;z-index:99;pointer-events:none;transform:translate(-50%,-120%);font:700 12px var(--mono);color:#d9b36a;background:#16161a;border:1px solid #d9b36a55;border-radius:8px;padding:4px 9px;display:none';
    document.body.appendChild(ghost);

    let dragCard = null;
    // Only library cards (rocks/wood/plants) are draggable. Substrate material
    // and tank preset cards share the .card look but are click-to-apply — they
    // must not start a "drop on tank" drag.
    document.querySelectorAll('.card[data-kind]').forEach((card) => {
      card.addEventListener('pointerdown', (e) => {
        // view-only: the whole panel is hidden, but guard the drag anyway
        if (this.placement.viewOnly) return;
        dragCard = card;
        card.classList.add('dragging');
        ghost.textContent = card.querySelector('.nm').textContent + ' — drop on tank';
        ghost.style.display = 'block';
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        e.preventDefault();
      });
    });

    window.addEventListener('pointermove', (e) => {
      if (!dragCard) return;
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      // translate to NDC relative to the GL canvas
      const gl = this.placement.renderer.domElement;
      const r = gl.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) {
        this.placement.updateSpawn(null);
        return;
      }
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      if (!this.placement._pending) {
        this.placement.beginSpawn(dragCard.dataset.kind, dragCard.dataset.type);
      }
      this.placement.updateSpawn(ndc);
    });

    window.addEventListener('pointerup', () => {
      if (!dragCard) return;
      dragCard.classList.remove('dragging');
      dragCard = null;
      ghost.style.display = 'none';
      // decide drop vs cancel
      const p = this.placement._pending;
      if (p && p.over) this.placement._finishSpawn();
      else this.placement._abortSpawn();
    });
  }

  // ---------- substrate pane ----------
  _buildSubstratePane() {
    const pane = document.getElementById('pane-substrate');

    pane.innerHTML = `
      <div class="heading">Brush</div>
      <div class="seg" id="brush-mode-seg">
        <button data-tool="select" class="active">⬚ Select</button>
        <button data-tool="sculpt">⛰ Sculpt</button>
        <button data-tool="paint">🎨 Paint</button>
        <button data-tool="erase">✐ Erase</button>
      </div>
      <div class="ctl"><div class="lab"><span>Brush size</span><output id="o-bsize">8</output></div>
        <input type="range" id="i-bsize" min="2" max="26" step="0.5" value="8" /></div>
      <div class="ctl"><div class="lab"><span>Shape</span></div>
        <div class="seg" id="brush-seg">
          <button data-brush="raise" class="active">▲ Raise</button>
          <button data-brush="lower">▼ Lower</button>
          <button data-brush="smooth">◐ Smooth</button>
          <button data-brush="flatten">▬ Flatten</button>
        </div></div>
      <div class="ctl"><div class="lab"><span>Strength</span><output id="o-bstr">1.1</output></div>
        <input type="range" id="i-bstr" min="0.2" max="4" step="0.1" value="1.1" /></div>

      <div class="heading">Layout presets</div>
      <div class="row3">
        <button class="btn" data-preset="slope">Slope</button>
        <button class="btn" data-preset="island">Island</button>
        <button class="btn" data-preset="terrace">Terrace</button>
        <button class="btn" data-preset="valley">Valley</button>
        <button class="btn" data-preset="dune">Dunes</button>
        <button class="btn warn" data-preset="reset">Reset</button>
      </div>

      <div class="heading">Base layer</div>
      <div class="cards" style="grid-template-columns:1fr 1fr" id="sub-base"></div>
      <div class="ctl"><div class="lab"><span>Tint</span></div><div class="swatches" id="sw-base"></div></div>
      <div class="ctl"><div class="lab"><span>Custom</span></div><div class="tintrow"><input type="color" id="col-base" value="#3a2f28" /><button class="btn" id="apply-base">Apply</button></div></div>

      <div class="heading">Top dress (paint over)</div>
      <div class="cards" style="grid-template-columns:1fr 1fr" id="sub-dress"></div>
      <div class="ctl"><div class="lab"><span>Tint</span></div><div class="swatches" id="sw-dress"></div></div>
      <div class="ctl"><div class="lab"><span>Custom</span></div><div class="tintrow"><input type="color" id="col-dress" value="#d9c9ab" /><button class="btn" id="apply-dress">Apply</button></div></div>

      <div class="row2">
        <button class="btn" id="clear-dress">Clear dress</button>
        <button class="btn" id="regen-textures">Reroll grain</button>
      </div>
    `;

    const matCard = (kind, key, def) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.mat = kind;
      b.dataset.type = key;
      b.innerHTML = `<span class="nm">${def.name}</span><span class="br">${def.brief ?? ''}</span>`;
      return b;
    };
    const baseBox = pane.querySelector('#sub-base');
    for (const [k, d] of Object.entries(SUBSTRATES)) baseBox.appendChild(matCard('base', k, d));
    const dressBox = pane.querySelector('#sub-dress');
    for (const [k, d] of Object.entries(SUBSTRATES)) dressBox.appendChild(matCard('dress', k, d));

    // swatches (rebuilt whenever the layer's material type changes)
    this._rebuildSwatches('base');
    this._rebuildSwatches('dress');

    // ---- events ----
    // One cursor-mode group for all four modes: Select hands the LMB back to
    // object picking; Sculpt/Paint/Erase pick the substrate brush. This is the
    // same state as the top bar's Select / Brush pair.
    pane.querySelector('#brush-mode-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool === 'select') this.sceneMgr.setTool?.('select');
      else this.setBrushTool(b.dataset.tool);
    });
    pane.querySelector('#brush-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      pane.querySelectorAll('#brush-seg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      this.substrate.brush.kind = b.dataset.brush;
      // picking a sculpt shape implies the sculpt cursor
      if (this.placement.sculptMode && this.substrate.brush.tool !== 'sculpt') this.setBrushTool('sculpt');
    });
    const link = (iid, oid, prop) => {
      const inp = pane.querySelector(iid), out = pane.querySelector(oid);
      inp.addEventListener('input', () => {
        out.textContent = (+inp.value).toFixed(1).replace(/\.0$/, '');
        this.substrate.brush[prop] = +inp.value;
      });
    };
    link('#i-bstr', '#o-bstr', 'strength');
    // one shared radius for every brush cursor (sculpt ring / paintbrush)
    const bsize = pane.querySelector('#i-bsize');
    bsize.addEventListener('input', () => {
      this.substrate.brush.radius = +bsize.value;
      this.syncBrushSize(bsize.value);
      this.substrate.refreshCursor();
    });

    pane.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const name = b.dataset.preset;
        const prev = name === 'reset'
          ? this.substrate.resetSubstrate()
          : this.substrate.preset(name);
        this.substrate._lastAction = prev;
        this.placement.settleAll();
      });
    });

    // material & tint selection (custom colour and swatch selection are
    // mutually exclusive: the last pick wins)
    pane.addEventListener('click', (e) => {
      const card = e.target.closest('[data-mat]');
      if (card) {
        const kind = card.dataset.mat, type = card.dataset.type;
        if (kind === 'base') { this.substrate.baseType = type; this.substrate.baseCustom = null; }
        else { this.substrate.dressType = type; this.substrate.dressCustom = null; }
        pane.querySelectorAll(`[data-mat="${kind}"]`).forEach((x) => x.classList.toggle('sel', x === card));
        this._rebuildSwatches(kind);
        this.substrate.refreshMaterial();
      }
      const sw = e.target.closest('.swatch');
      if (sw && sw.parentElement.id) {
        const id = sw.parentElement.id;
        sw.parentElement.querySelectorAll('.swatch').forEach((x) => x.classList.remove('sel'));
        sw.classList.add('sel');
        const i = +sw.dataset.i;
        if (id === 'sw-base') { this.substrate.baseTint = i; this.substrate.baseCustom = null; }
        else { this.substrate.dressTint = i; this.substrate.dressCustom = null; }
        this.substrate.refreshMaterial();
      }
    });

    // Custom colour: applies the picker colour to that layer and deselects the
    // swatch/type picks so exactly one source of colour is active.
    pane.querySelector('#apply-base').addEventListener('click', () => {
      this.substrate.baseCustom = pane.querySelector('#col-base').value;
      this.refreshSubstratePane();
      this.substrate.refreshMaterial();
    });
    pane.querySelector('#apply-dress').addEventListener('click', () => {
      this.substrate.dressCustom = pane.querySelector('#col-dress').value;
      this.refreshSubstratePane();
      this.substrate.refreshMaterial();
    });
    pane.querySelector('#clear-dress').addEventListener('click', () => this.substrate.clearDress());
    pane.querySelector('#regen-textures').addEventListener('click', () => {
      this.substrate.grainSeed = (Math.random() * 1e9) | 0;
      this.substrate.refreshMaterial();
    });

    // cards, swatches and colour pickers render from the live substrate state
    this.refreshSubstratePane();
  }

  /**
   * Switch the substrate brush tool (sculpt / paint / erase). The pane's
   * cursor-mode group and the top bar are two faces of one state, and picking
   * a substrate brush always makes the top bar's Brush tool live.
   */
  setBrushTool(tool) {
    const sub = this.substrate;
    sub.brush.tool = tool;
    this.sceneMgr.setTool?.('brush');
    this._syncBrushToolUI();
    sub.refreshCursor();
  }

  _syncBrushToolUI() {
    // active mode = the substrate brush when the Brush tool is live,
    // otherwise Select
    const active = this.placement.sculptMode ? this.substrate.brush.tool : 'select';
    const seg = this.el.querySelector('#brush-mode-seg');
    if (!seg) return;
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === active);
    });
  }

  /** Public alias: main.js re-syncs the pane whenever the top bar changes. */
  syncToolUI() {
    this._syncBrushToolUI();
  }

  /**
   * Re-render the substrate pane's material cards, swatches and colour pickers
   * from the current substrate state. Called after a layout load, when the
   * save data has just replaced material type / tint / custom colours.
   */
  refreshSubstratePane() {
    const pane = document.getElementById('pane-substrate');
    if (!pane) return;
    for (const kind of ['base', 'dress']) {
      const type = kind === 'base' ? this.substrate.baseType : this.substrate.dressType;
      const custom = kind === 'base' ? this.substrate.baseCustom : this.substrate.dressCustom;
      pane.querySelectorAll(`[data-mat="${kind}"]`).forEach((x) => {
        // a custom colour overrides the type pick too — nothing reads selected
        x.classList.toggle('sel', !custom && x.dataset.type === type);
      });
      this._rebuildSwatches(kind);
    }
    const tintHex = (typeKey, tint) => {
      const tints = SUBSTRATES[typeKey].tints;
      return tints[Math.max(0, tint) % tints.length];
    };
    const colBase = pane.querySelector('#col-base'), colDress = pane.querySelector('#col-dress');
    if (colBase) colBase.value = this.substrate.baseCustom ?? tintHex(this.substrate.baseType, this.substrate.baseTint);
    if (colDress) colDress.value = this.substrate.dressCustom ?? tintHex(this.substrate.dressType, this.substrate.dressTint);
    this._syncBrushToolUI();
    this._syncBrushSizeUI();
  }

  /** Switch the library to a tab (used when the top bar enters Brush mode). */
  showTab(tab) {
    const t = this.el.querySelector(`.tab[data-tab="${tab}"]`);
    if (t) t.click();
  }

  /** Mirror the shared brush radius into the size slider + readout. */
  syncBrushSize(v = this.substrate.brush.radius) {
    const bsize = this.el.querySelector('#i-bsize'), bsizeOut = this.el.querySelector('#o-bsize');
    const t = (+v).toFixed(1).replace(/\.0$/, '');
    if (bsize) { bsize.value = v; bsizeOut.textContent = t; }
  }

  _syncBrushSizeUI() {
    this.syncBrushSize();
  }

  /** Rebuild one layer's tint swatch row from its current material type. */
  _rebuildSwatches(kind) {
    const pane = document.getElementById('pane-substrate');
    const box = pane?.querySelector(`#sw-${kind}`);
    if (!box) return;
    const type = kind === 'base' ? this.substrate.baseType : this.substrate.dressType;
    const tint = kind === 'base' ? this.substrate.baseTint : this.substrate.dressTint;
    const custom = kind === 'base' ? this.substrate.baseCustom : this.substrate.dressCustom;
    box.innerHTML = '';
    for (const [i, hex] of SUBSTRATES[type].tints.entries()) {
      const s = document.createElement('button');
      // a custom colour overrides the swatches: none reads as selected
      s.className = 'swatch' + (!custom && i === tint ? ' sel' : '');
      s.style.background = hex;
      s.dataset.i = i;
      box.appendChild(s);
    }
  }

  // ---------- tank pane ----------
  _buildTankPane() {
    const pane = document.getElementById('pane-tank');
    const s = this.tank.state;
    pane.innerHTML = `
      <div class="heading">Presets</div>
      <div class="cards" style="grid-template-columns:1fr 1fr" id="tank-presets"></div>
      <div class="heading">Custom dimensions (cm)</div>
      <div class="row3">
        <div class="ctl" style="margin:0"><div class="lab"><span>Width</span></div>
          <input type="number" id="t-w" value="${s.w}" min="10" max="200" /></div>
        <div class="ctl" style="margin:0"><div class="lab"><span>Depth</span></div>
          <input type="number" id="t-d" value="${s.d}" min="10" max="100" /></div>
        <div class="ctl" style="margin:0"><div class="lab"><span>Height</span></div>
          <input type="number" id="t-h" value="${s.h}" min="10" max="100" /></div>
      </div>
      <div class="row2" style="margin-top:8px">
        <button class="btn gold" id="t-apply">Rebuild tank</button>
        <button class="btn" id="t-clear">Clear scene</button>
      </div>
      <div class="heading">Glass & stand</div>
      <div class="seg" id="glass-seg">
        <button data-glass="clear" class="active">Clear</button>
        <button data-glass="lowiron">Low-iron</button>
      </div>
      <div class="ctl"><div class="lab"><span>Display stand</span></div>
        <div class="seg" id="stand-seg">
          <button data-stand="1" class="active">On</button>
          <button data-stand="0">Off</button>
        </div></div>
      <div class="heading">Water</div>
      <div class="ctl"><div class="lab"><span>Fill level</span><output id="o-wl">${Math.round(s.waterLevel * 100)}%</output></div>
        <input type="range" id="i-wl" min="0.2" max="0.98" step="0.01" value="${s.waterLevel}" /></div>
      <div class="row2">
        <button class="btn" id="t-water">💧 Fill / drain</button>
        <button class="btn" id="t-drain">⛔ Drain</button>
      </div>
    `;

    const pre = pane.querySelector('#tank-presets');
    for (const p of TANK_PRESETS) {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<span class="nm">${p.name}</span><span class="br">${p.w}×${p.d}×${p.h} cm · ${Math.round((p.w * p.d * p.h) / 1000)} L</span>`;
      b.addEventListener('click', () => {
        pane.querySelector('#t-w').value = p.w;
        pane.querySelector('#t-d').value = p.d;
        pane.querySelector('#t-h').value = p.h;
        this._applyTank({ w: p.w, d: p.d, h: p.h });
      });
      pre.appendChild(b);
    }

    pane.querySelector('#t-apply').addEventListener('click', () => {
      this._applyTank({
        w: +pane.querySelector('#t-w').value || 60,
        d: +pane.querySelector('#t-d').value || 30,
        h: +pane.querySelector('#t-h').value || 36,
      });
    });
    pane.querySelector('#t-clear').addEventListener('click', () => {
      this.placement.loadAll([]);
    });
    pane.querySelector('#glass-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pane.querySelectorAll('#glass-seg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      this._applyTank({ glass: b.dataset.glass });
    });
    pane.querySelector('#stand-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pane.querySelectorAll('#stand-seg button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      this._applyTank({ stand: b.dataset.stand === '1' });
    });
    const wlInp = pane.querySelector('#i-wl'), wlOut = pane.querySelector('#o-wl');
    wlInp.addEventListener('input', () => {
      wlOut.textContent = Math.round(+wlInp.value * 100) + '%';
      this.tank.setWater(true, +wlInp.value);
      this.tank.state.waterOn && this.sceneMgr.setWaterUI(true);
    });
    pane.querySelector('#t-water').addEventListener('click', () => this.sceneMgr.toggleWater());
    pane.querySelector('#t-drain').addEventListener('click', () => this.sceneMgr.setWaterUI(false));
  }

  _applyTank(changes) {
    const st = { ...this.tank.state, ...changes };
    this.tank.rebuild(st);
    // rebuild substrate to fit new tank
    this.substrate.tank = this.tank;
    this.substrate._build();
    this.substrate._makeTextures();
    this.substrate._makeMaterial();
    this.substrate.reset(this.substrate._baseDepth, true);
    this.substrate.brush.radius = Math.max(3, Math.min(18, st.w * 0.14));
    this.syncBrushSize();
    // keep objects inside
    this.placement.settleAll();
    this.sceneMgr.onTankResized?.();
  }

  // ---- inspector (per-object settings) ----
  _bindInspector() {
    this.inspector = document.getElementById('inspector');
    this.placement.onSelection = (obj) => this._showInspector(obj);
  }

  /** Re-render inspector panel for the current selection (e.g. after gizmo drop). */
  refreshInspector() {
    if (this.placement.selected) this._showInspector(this.placement.selected);
  }

  /** Lightweight live update of slider positions during gizmo drags (no re-render). */
  liveInspector() {
    const obj = this.placement.selected;
    if (!obj || this.inspector.classList.contains('hidden')) return;
    const q = (id) => this.inspector.querySelector('#' + id);
    const px = q('in-px'), py = q('in-py'), pz = q('in-pz'), rx = q('in-rx'), ry = q('in-ry2');
    if (px) { px.value = obj.position.x; q('o-in-px').value = obj.position.x.toFixed(1); }
    if (py) { py.value = obj.position.y; q('o-in-py').value = obj.position.y.toFixed(1); }
    if (pz) { pz.value = obj.position.z; q('o-in-pz').value = obj.position.z.toFixed(1); }
    if (rx) { rx.value = Math.round(THREE.MathUtils.radToDeg(obj.rotation.x)); q('o-in-rx').value = Math.round(THREE.MathUtils.radToDeg(obj.rotation.x)); }
    if (ry) { ry.value = ((Math.round(THREE.MathUtils.radToDeg(obj.rotation.y))) + 360) % 360; q('o-in-ry2').value = ry.value; }
  }

  _showInspector(obj) {
    const box = this.inspector;
    if (!obj) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const u = obj.userData;
    const typeDef = u.def;
    const name = typeDef?.name ?? u.typeKey;
    const isRock = u.kindKey === 'rock' && !!u.params;
    const r = this.tank.floorRect;
    const H = this.tank.state.h;
    const degY = ((Math.round(THREE.MathUtils.radToDeg(obj.rotation.y)) % 360) + 360) % 360;

    const isPlant = u.kindKey === 'plant';
    // plants are placed small; rocks & wood need the full 0.3–16 band
    const scMin = isPlant ? 0.1 : 0.3;
    const scMax = isPlant ? 3 : 16;

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="ttl"><span>${EM[u.kindKey] ?? '⬚'} ${name} <span class="badge">${u.kindKey}</span></span><span class="x" title="Deselect">✕</span></div>

      <div class="row3">
        <button class="btn" id="in-dup">Duplicate</button>
        <button class="btn" id="in-settle">Drop</button>
        <button class="btn warn" id="in-del">Delete</button>
      </div>

      <div class="ctl" style="margin-top:10px"><div class="lab"><span>Size</span><input type="number" id="o-sc" min="${scMin}" max="${scMax}" step="0.05" value="${obj.scale.x.toFixed(2)}" /></div>
        <input type="range" id="in-sc" min="${scMin}" max="${scMax}" step="0.05" value="${obj.scale.x}" /></div>

      <div class="heading">Position · cm</div>
      ${this._axisRow('in-px', 'Move X ↔', r.x0 + 0.5, r.x0 + r.w - 0.5, 0.1, obj.position.x, 1)}
      ${this._axisRow('in-py', 'Move Y ↕', 0, H - 0.5, 0.1, obj.position.y, 1)}
      ${this._axisRow('in-pz', 'Move Z ⤢', r.z0 + 0.5, r.z0 + r.d - 0.5, 0.1, obj.position.z, 1)}

      <div class="heading">Rotation · degrees</div>
      ${this._axisRow('in-rx', 'Tilt X', -180, 180, 1, Math.round(THREE.MathUtils.radToDeg(obj.rotation.x)), 0)}
      ${this._axisRow('in-ry2', 'Turn Y', 0, 360, 1, degY, 0)}

      <div class="row2" style="margin-top:10px">
        <button class="btn" id="in-flat2">⚖ Reset tilt</button>
        <button class="btn" id="in-north">⥂ Face front</button>
      </div>

      <div class="heading">Look</div>
      ${isRock ? this._rockParamMarkup(u.params) : ''}
      ${!isRock && (u.kindKey === 'rock' || u.kindKey === 'wood') ? `
      <div class="row2" style="margin-top:8px">
        <button class="btn" id="in-reroll">🎲 Reroll shape</button>
      </div>` : ''}
      ${u.kindKey === 'plant' ? `
      <div class="ctl"><div class="lab"><span>Hue shift</span><output id="o-hue">${Math.round((u.params?.hue ?? 0) * 360)}°</output></div>
        <input type="range" id="in-hue" min="-0.5" max="0.5" step="0.01" value="${u.params?.hue ?? 0}" /></div>` : ''}
      ${!isRock && (u.kindKey === 'rock' || u.kindKey === 'wood') ? `
      <div class="ctl"><div class="lab"><span>Tint</span></div><div class="swatches" id="in-tints"></div></div>` : ''}
    `;

    const q = (s) => box.querySelector(s);
    q('.x').addEventListener('click', () => this.placement.select(null));
    q('#in-dup').addEventListener('click', () => this.placement.duplicate(obj));
    q('#in-del').addEventListener('click', () => this.placement.deleteObj(obj));
    q('#in-settle').addEventListener('click', () => {
      this.placement.dropOne(obj);
      this._showInspector(this.placement.selected); // refresh Y readout
    });

    const clampN = (inp) => { const v = +inp.value; if (Number.isNaN(v)) return 0; return v; };

    // position axes: X/Z re-seat onto terrain unless Y was manually set (stacking)
    this._bindAxis(q, 'in-px', (v) => {
      obj.position.x = v;
      if (obj.userData.autoY !== false) this.placement.settleOne(obj);
      this.placement._changed();
    });
    this._bindAxis(q, 'in-py', (v) => {
      obj.position.y = v;
      obj.userData.autoY = false; // manual altitude — stop auto-settling
      this.placement._changed();
    });
    this._bindAxis(q, 'in-pz', (v) => {
      obj.position.z = v;
      if (obj.userData.autoY !== false) this.placement.settleOne(obj);
      this.placement._changed();
    });
    // rotation axes
    this._bindAxis(q, 'in-rx', (v) => {
      obj.rotation.x = THREE.MathUtils.degToRad(v);
    }, (v) => Math.round(v) + '°');
    this._bindAxis(q, 'in-ry2', (v) => {
      obj.rotation.y = THREE.MathUtils.degToRad(v);
    }, (v) => Math.round(v) + '°');

    q('#in-flat2').addEventListener('click', () => {
      obj.rotation.x = 0;
      obj.rotation.z = 0;
      this.placement.settleOne(obj);
      this.placement._changed();
      this._showInspector(this.placement.selected);
    });
    q('#in-north').addEventListener('click', () => {
      obj.rotation.y = 0;
      this.placement._changed();
      this._showInspector(this.placement.selected);
    });

    q('#in-sc').addEventListener('input', (e) => {
      const v = +e.target.value;
      obj.scale.setScalar(v);
      q('#o-sc').value = v.toFixed(2);
      this.placement._changed();
    });
    q('#o-sc').addEventListener('input', (e) => {
      const v = +e.target.value;
      if (Number.isNaN(v)) return;
      obj.scale.setScalar(v);
      q('#in-sc').value = v;
      this.placement._changed();
    });

    const rr = q('#in-reroll');
    if (rr) rr.addEventListener('click', () => {
      if (u.kindKey === 'rock' || u.kindKey === 'wood') {
        // shared path with the top-bar reroll; rocks rebuild in place and
        // report through onSelection, which re-renders this panel (new seed)
        this.placement.rerollSelected();
        return;
      }
      const ns = (Math.random() * 1e9) | 0;
      const fresh = rerollPlant(obj, ns, obj.scale.x);
      fresh.position.copy(obj.position);
      fresh.rotation.copy(obj.rotation);
      fresh.scale.copy(obj.scale);
      fresh.userData.id = obj.userData.id;
      fresh.userData.kindKey = u.kindKey;
      this.placement._removeInternal(obj);
      this.placement.group.add(fresh);
      this.placement.objects.push(fresh);
      this.placement.settleOne(fresh, true);
      this.placement.select(fresh);
      this.placement._changed();
      if (this.placement.selected === fresh) this._showInspector(fresh);
    });

    const hueInp = q('#in-hue');
    if (hueInp) hueInp.addEventListener('input', (e) => {
      const hue = +e.target.value;
      q('#o-hue').textContent = Math.round(hue * 360) + '°';
      applyHueShift(obj, hue);
    });

    const tints = q('#in-tints');
    if (tints) {
      this._buildSwatches(tints, typeDef?.tints ?? [], (hex) => tintObject(obj, hex));
    }

    if (isRock) this._bindRockParams(obj);
  }

  // ---------- rock params (Geometry & noise / Transform / Material) ----------
  /** Collapsible param groups for a selected rock, mirroring the prototype. */
  _rockParamMarkup(p) {
    const row = (id, label, min, max, step, value) => `
      <div class="ctl"><div class="lab"><span>${label}</span><input type="number" id="o-${id}" min="${min}" max="${max}" step="${step}" value="${value}" /></div>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" /></div>`;
    const group = (title, body) => `
      <details class="pgrp" open><summary class="heading">${title}</summary>${body}</details>`;
    const on = (flag) => (flag ? 'active' : '');

    return `
      ${group('Geometry & noise', [
        row('rp-res', 'Resolution', 8, 128, 1, p.resolution),
        row('rp-bf', 'Base noise freq', 0, 10, 0.01, p.baseFrequency),
        row('rp-ba', 'Base noise amp', 0, 2, 0.001, p.baseAmplitude),
        row('rp-df', 'Detail noise freq', 0, 25, 0.1, p.detailFrequency),
        row('rp-da', 'Detail noise amp', 0, 2, 0.01, p.detailAmplitude),
        row('rp-seed', 'Random seed', 0, 100, 0.001, p.seedOffset),
      ].join(''))}
      ${group('Transform', [
        row('rp-sx', 'Scale X', 0.1, 3, 0.05, p.scaleX),
        row('rp-sy', 'Scale Y', 0.1, 3, 0.05, p.scaleY),
        row('rp-sz', 'Scale Z', 0.1, 3, 0.05, p.scaleZ),
      ].join(''))}
      ${group('Material', `
        <div class="ctl"><div class="lab"><span>Colour</span></div>
          <div class="swatches" id="rp-tints"></div></div>
        ${row('rp-rough', 'Roughness', 0, 1, 0.01, p.roughness)}
        ${row('rp-metal', 'Metalness', 0, 1, 0.01, p.metalness)}
        <div class="ctl"><div class="lab"><span>Flat shading</span></div>
          <div class="seg" id="rp-flat">
            <button data-flat="1" class="${on(p.flatShading)}">Faceted</button>
            <button data-flat="0" class="${on(!p.flatShading)}">Smooth</button>
          </div></div>
      `)}
      <div class="row2" style="margin-top:10px">
        <button class="btn" id="in-reroll">🎲 Reroll shape</button>
        <button class="btn" id="rp-reset">↺ Type defaults</button>
      </div>
    `;
  }

  /** Slider + synced numeric field for one axis. */
  _axisRow(id, label, min, max, step, value, dp) {
    return `<div class="ctl">
      <div class="lab"><span>${label}</span><input type="number" id="o-${id}" min="${min}" max="${max}" step="${step}" value="${(+value).toFixed(dp)}" /></div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${+value}" />
    </div>`;
  }

  /** Swatch row (type tints + custom picker) wired to `onPick`. */
  _buildSwatches(box, tints, onPick) {
    for (const hex of tints) {
      const s = document.createElement('button');
      s.className = 'swatch';
      s.style.background = hex;
      s.dataset.hex = hex;
      s.addEventListener('click', () => onPick(hex));
      box.appendChild(s);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.style.cssText = 'width:24px;height:24px;border:none;background:none;cursor:pointer';
    custom.addEventListener('input', () => onPick(custom.value));
    box.appendChild(custom);
  }

  /**
   * Wire the rock param groups. Edits are written to userData.params and
   * applied through a short debounce (same idea as the calculator chips) so
   * dragging a slider doesn't rebuild the geometry on every pixel.
   */
  _bindRockParams(obj) {
    const box = this.inspector;
    const u = obj.userData;
    const q = (s) => box.querySelector(s);
    // NB: always read/write through `u.params` — rebuildRock replaces the
    // params object, so a captured reference would go stale.
    const live = () => u.params;

    const push = (patch) => {
      Object.assign(live(), patch);
      this._scheduleRockRebuild(obj);
    };

    for (const [id, key] of [
      ['rp-res', 'resolution'],
      ['rp-bf', 'baseFrequency'],
      ['rp-ba', 'baseAmplitude'],
      ['rp-df', 'detailFrequency'],
      ['rp-da', 'detailAmplitude'],
      ['rp-seed', 'seedOffset'],
      ['rp-sx', 'scaleX'],
      ['rp-sy', 'scaleY'],
      ['rp-sz', 'scaleZ'],
      ['rp-rough', 'roughness'],
      ['rp-metal', 'metalness'],
    ]) {
      this._bindAxis(q, id, (v) => push({ [key]: v }), (v) => (Number.isInteger(+v) ? String(v) : (+v).toFixed(3)));
    }

    const swatches = q('#rp-tints');
    if (swatches) {
      this._buildSwatches(swatches, u.def?.tints ?? [], (hex) => {
        push({ color: hex });
        swatches.querySelectorAll('.swatch').forEach((s) => {
          s.classList.toggle('sel', s.dataset.hex === hex);
        });
      });
      swatches.querySelectorAll('.swatch').forEach((s) => {
        s.classList.toggle('sel', s.dataset.hex === live().color);
      });
    }

    const seg = q('#rp-flat');
    if (seg) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        // shading is a material flag: apply straight away (no geometry work)
        live().flatShading = b.dataset.flat === '1';
        obj.material.flatShading = live().flatShading;
        obj.material.needsUpdate = true;
      });
    }

    q('#rp-reset')?.addEventListener('click', () => {
      resetRockToDefaults(obj);
      if (u.autoY !== false) this.placement.settleOne(obj);
      this.placement._changed();
      this._showInspector(obj); // re-render: every row moved back to its default
    });
  }

  /**
   * Debounced in-place rebuild of a rock (geometry + material stay put).
   * A resolution change needs a full rebuild + vertex weld (hundreds of ms at
   * the top of the range), so it waits longer than a cheap noise/scale tweak —
   * dragging the slider stays smooth and only the final value pays.
   */
  _scheduleRockRebuild(obj) {
    const structural = obj.userData.params.resolution !== obj.userData._res;
    clearTimeout(this._rockTimer);
    this._rockTimer = setTimeout(() => {
      if (!this.placement.objects.includes(obj)) return; // deleted while pending
      rebuildRock(obj, {});
      if (obj.userData.autoY !== false) this.placement.settleOne(obj);
      this.placement._changed();
    }, structural ? 220 : 90);
  }

  _bindAxis(q, id, apply, fmtOut = (v) => v.toFixed(1)) {
    const slider = q('#' + id);
    const num = q('#o-' + id);
    const commit = (v, src) => {
      const raw = +v;
      if (Number.isNaN(raw)) return;
      const c = Math.min(+slider.max, Math.max(+slider.min, raw));
      apply(c);
      if (src !== 's') slider.value = c;
      // only rewrite the number field when the value was actually clamped —
      // otherwise typing decimals would be impossible ("3.2" → "3.")
      if (src !== 'n') num.value = fmtOut(c);
      else if (c !== raw) num.value = fmtOut(c);
    };
    slider.addEventListener('input', () => commit(+slider.value, 's'));
    num.addEventListener('input', () => commit(+num.value, 'n'));
  }
}

function tintObject(obj, hex) {
  obj.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) {
      o.material.color.set(hex);
    }
  });
}
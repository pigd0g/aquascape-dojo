// Boot & wire the Dojo.
import * as THREE from 'three';
import './style.css';
import { createScene } from './scene.js';
import { Tank, STAND_H } from './tank.js';
import { Substrate } from './substrate.js';
import { Placement } from './placement.js';
import { Palette } from './palette.js';
import { FishSchool } from './fish.js';
import { LayoutUI } from './layout-ui.js';
import { PHOTO_PROMPT } from './photo-prompt.js';
import { copyText, flashButton } from './ui.js';
import { updateChips } from './calculator.js';

const container = document.getElementById('viewport');
const sceneMgr = createScene(container);
const { renderer, scene, camera, controls } = sceneMgr;
const btn = (id) => document.getElementById(id);

const tank = new Tank(scene);
const substrate = new Substrate(scene, tank);
const placement = new Placement(scene, camera, renderer, substrate);
placement.setOrbit(controls);
const fish = new FishSchool(scene, tank, substrate, placement);
sceneMgr.culler.setTank(tank); // x-ray culling needs the tank extents
window.__dojo = { tank, substrate, placement, fish, sceneMgr }; // debug/testing handle

// ---------------- theme ----------------
let lightMode = false;
function setThemeUI(light) {
  lightMode = light;
  btn('act-theme').textContent = light ? '🌙' : '☀️';
  btn('act-theme').title = light ? 'Switch to dark' : 'Switch to light';
  btn('act-theme').classList.toggle('active', light);
  sceneMgr.setTheme(light);
  document.body.classList.toggle('light', light);
}
btn('act-theme').addEventListener('click', () => setThemeUI(!lightMode));

// ---------------- framing ----------------
/** Lift/lower the gallery floor & walls so the stand (which hangs below y=0) never clips through. */
function syncStage() {
  const standH = tank.state.stand ? STAND_H + 4 : 0;
  sceneMgr.setStageY?.(-Math.max(0, standH - 8));
}

function frameCamera() {
  const { w } = tank.state;
  const standH = tank.state.stand ? STAND_H : 0;
  const topY = tank.state.h;                        // tank rim
  const midY = (topY - (tank.state.stand ? standH : 0)) / 2;
  controls.target.set(0, midY, 0);
  // 3/4 view: modest height above the rim, not a bird's-eye
  camera.position.set(-w * 0.55, topY + 16, Math.max(w * 1.35, 88));
  controls.update();
  sceneMgr.setTankFocus?.(0, 0, 0);
}
// ---------------- top bar ----------------
// `tool` is 'select' (object picking) or 'brush' (the substrate brush, whose
// exact mode — sculpt/paint/erase — lives in substrate.brush.tool).
let tool = 'select';

const setToolUI = (tool) => {
  btn('tool-select').classList.toggle('active', tool === 'select');
  btn('tool-brush').classList.toggle('active', tool === 'brush');
  let text;
  if (tool !== 'brush') {
    text = 'Drag items from the library onto the tank · click to select · RMB orbit · Shift+RMB pan · G / R / S = move, rotate, scale';
  } else if (substrate.brush.tool === 'paint') {
    text = 'Paint the top dress · [ ] brush size · click-drag on the substrate · RMB orbit · Shift+RMB pan';
  } else if (substrate.brush.tool === 'erase') {
    text = 'Erase the top dress · [ ] brush size · click-drag on the substrate · RMB orbit · Shift+RMB pan';
  } else {
    text = 'Sculpt the substrate · [ ] adjust brush size · hold SHIFT to invert brush · RMB orbit · Shift+RMB pan';
  }
  document.getElementById('hint').textContent = text;
};

setToolUI(tool); // paint initial hint text (index.html's static copy is stale)

/** Switch the top-bar tool and route the substrate brush accordingly. */
function setTool(name) {
  tool = name;
  setToolUI(name);
  placement.setSculptMode(name === 'brush');
  if (name === 'brush') substrate.refreshCursor();
  else substrate.updateCursor(null, false);
  // keep the Substrate pane's 4-mode group in step with the top bar
  window.__palette?.syncToolUI?.();
}

btn('tool-select').addEventListener('click', () => setTool('select'));
btn('tool-brush').addEventListener('click', () => {
  setTool('brush');
  // the brush's mode (sculpt/paint/erase) is chosen in the Substrate tab, so
  // entering Brush mode reveals exactly the controls that drive it
  window.__palette?.showTab?.('substrate');
});

const setModeUI = (m) => {
  btn('mode-move').classList.toggle('active', m === 'translate');
  btn('mode-rotate').classList.toggle('active', m === 'rotate');
  btn('mode-scale').classList.toggle('active', m === 'scale');
  placement.setMode(m);
};
btn('mode-move').addEventListener('click', () => setModeUI('translate'));
btn('mode-rotate').addEventListener('click', () => setModeUI('rotate'));
btn('mode-scale').addEventListener('click', () => setModeUI('scale'));
setModeUI('translate');

// reroll toolbar button (visible when a rock/wood is selected) — shares the
// placement.rerollSelected() code path with the inspector's Reroll button
btn('act-reroll').addEventListener('click', () => placement.rerollSelected());

// water & snapshot
function toggleWater() {
  const on = !tank.state.waterOn;
  setWaterUI(on);
  if (on) {
    sceneMgr.scene.fog.near = 180;
    sceneMgr.scene.fog.far = 460;
  } else {
    sceneMgr.scene.fog.near = 300;
    sceneMgr.scene.fog.far = 620;
  }
}
function setWaterUI(on) {
  btn('act-water').classList.toggle('active', on);
  tank.setWater(on);
  fish.setEnabled(on);
}
btn('act-water').addEventListener('click', toggleWater);
btn('act-shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `aquascape-dojo-${Date.now()}.png`;
  a.click();
  // hand the matching image-model prompt over with the shot, so the download
  // and the prompt can be pasted straight into a generator side by side
  copyText(PHOTO_PROMPT).then((ok) =>
    flashButton(
      btn('act-shot'),
      ok ? '📋 + prompt' : '📷 saved',
    ),
  );
});

// save / load — browser storage via LayoutUI, files via Export / Import
function saveData() {
  return {
    version: 1,
    tank: { ...tank.state },
    substrate: substrate.serialize(),
    objects: placement.serializeAll(),
  };
}

function loadData(data) {
  if (!data || !data.tank) return;
  tank.rebuild(data.tank);
  substrate.tank = tank;
  substrate._build();
  substrate.baseType = data.substrate?.base ?? 'soil';
  substrate.dressType = data.substrate?.dress ?? 'sand';
  substrate.baseTint = data.substrate?.baseTint ?? 0;
  substrate.dressTint = data.substrate?.dressTint ?? 0;
  substrate.baseCustom = data.substrate?.baseCustom ?? null;
  substrate.dressCustom = data.substrate?.dressCustom ?? null;
  substrate._makeTextures();
  substrate._makeMaterial();
  if (data.substrate) {
    // heights & splat applied without clamps
    if (data.substrate.heights?.length === substrate.heights.length) {
      substrate.heights.set(data.substrate.heights);
    }
    if (data.substrate.splat) {
      const img = new Image();
      img.onload = () => {
        substrate._splatCtx.clearRect(0, 0, 512, 512);
        substrate._splatCtx.drawImage(img, 0, 0);
        substrate.splatTex.needsUpdate = true;
      };
      img.src = data.substrate.splat;
    }
  }
  substrate._refresh();
  placement.loadAll(data.objects ?? []);
  // saved material types / tints / custom colours just landed: re-render the
  // Substrate pane so its cards, swatches and pickers match
  palette.refreshSubstratePane?.();
  scheduleChips();
  syncStage();
  // tank.rebuild() recreated the water meshes hidden: apply the saved fill
  // state either way, so a dry save really drains and the fish leave with it.
  // setWaterUI() also enables/disables the school.
  setWaterUI(!!data.tank.waterOn);
  if (data.tank.waterOn) tank.setWater(true, data.tank.waterLevel);
}

// ---------------- layout persistence UI ----------------
const layoutUI = new LayoutUI({ getData: saveData, applyData: loadData });
window.__layoutUI = layoutUI; // debug/testing handle

// Ctrl+S / Ctrl+O open the browser-storage popovers (the browser's native
// save dialog is never what we want here). Keys only fire on bare presses so
// Ctrl+Shift+S etc. still reach the browser.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if (viewOnly) return; // the HUD is hidden: don't open popovers behind it
  const k = e.key.toLowerCase();
  if (k === 's') {
    e.preventDefault();
    layoutUI.saveBtn.click();
  } else if (k === 'o') {
    e.preventDefault();
    layoutUI.openBtn.click();
  }
});

// ---------------- sculpt & hover interaction ----------------
let sculpting = false;
// Set when a stroke stamp actually edits the heightfield. Paint/erase are
// purely cosmetic (they only draw into the splat canvas), so they must never
// re-seat objects — a settle would lift anything whose base sits below the
// current terrain surface (e.g. tall plants clamped down at spawn, or objects
// lowered with the gizmo) and read as "painting raised the substrate".
let strokeSculpted = false;
let lastSculpt = 0;
const shiftDown = { value: false };
window.addEventListener('keydown', (e) => {
  shiftDown.value = e.shiftKey;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '[' || e.key === ']') {
    // brush size is shared by the sculpt ring and the paintbrush cursor, and
    // the dress + sculpt sliders both mirror it
    const delta = e.key === '[' ? -1.5 : 1.5;
    const r = Math.min(26, Math.max(2, substrate.brush.radius + delta));
    if (r !== substrate.brush.radius) {
      substrate.brush.radius = r;
      window.__palette?.syncBrushSize(r);
      substrate.refreshCursor();
    }
  }
});
window.addEventListener('keyup', (e) => { shiftDown.value = e.shiftKey; });

// ---------------- view-only mode ----------------
// "V" hides every panel, overlay and gizmo and leaves a clean, full-bleed view
// of the tank — for screenshots, or just looking at the scape. Editing is
// switched off at the source, not merely hidden, so no keyboard shortcut or
// stray click can change the layout while it is on.
let viewOnly = false;
const viewOnlyTargets = [
  document.getElementById('topbar'),
  document.getElementById('hint'),
  document.getElementById('statusbar'),
  document.getElementById('panel'),
];
const viewOnlyExit = document.getElementById('view-exit');

function setViewOnly(on) {
  if (viewOnly === on) return;
  viewOnly = on;
  document.body.classList.toggle('view-only', on);
  for (const el of viewOnlyTargets) el.classList.toggle('hidden', on);

  // the scene itself: no picking, no gizmo, no brush cursor
  placement.setViewOnly(on);
  if (on) {
    sculpting = false;
    substrate.updateCursor(null, false);
  }

  // a popover left open would float over the clean view
  layoutUI.closeSave();
  layoutUI.closeOpen();

  // leaving view-only restores the tool that was active before
  if (!on) {
    setToolUI(tool);
    placement.syncRerollBtn();
  }
  viewOnlyExit.classList.toggle('hidden', !on);
  window.dispatchEvent(new CustomEvent('dojo:viewonly', { detail: on }));
}
viewOnlyExit.addEventListener('click', () => setViewOnly(false));
btn('act-view').addEventListener('click', () => setViewOnly(!viewOnly));

placement.onHover = (ndc, e) => {
  if (viewOnly) return;
  if (tool !== 'brush' || placement._dragging) return;
  const t = placement._tankRay(ndc);
  if (t) {
    substrate.updateCursor(t.point, true);
    if (sculpting && performance.now() - lastSculpt > 24) {
      lastSculpt = performance.now();
      const brush = { ...substrate.brush };
      if (brush.tool === 'paint') {
        substrate.paintDress(t.point.x, t.point.z, brush.radius, false);
        scheduleChips();
        return;
      }
      if (brush.tool === 'erase') {
        substrate.paintDress(t.point.x, t.point.z, brush.radius, true);
        return;
      }
      if (shiftDown.value) brush.kind = brush.kind === 'raise' ? 'lower' : 'raise';
      substrate.applyBrush(t.point.x, t.point.z, brush, 1);
      strokeSculpted = true;
      placement.settleAll();
      scheduleChips();
    }
  } else {
    substrate.updateCursor(null, false);
  }
};

window.addEventListener('pointerdown', (e) => {
  if (!viewOnly && tool === 'brush' && e.button === 0 && e.target === renderer.domElement) {
    sculpting = true;
    strokeSculpted = false;
  }
});
window.addEventListener('pointerup', () => {
  if (sculpting) {
    sculpting = false;
    // settle objects only after a stroke that actually moved the heightfield —
    // paint/erase just recolour the top dress, so they leave every object alone
    if (strokeSculpted) placement.settleAll();
    strokeSculpted = false;
    scheduleChips();
  }
});

// gizmo drag needs orbit disabled — handled in placement; chips + inspector refresh:
placement.gizmo.addEventListener('dragging-changed', (e) => {
  if (!e.value) {
    scheduleChips();
    // refresh inspector sliders to reflect gizmo-applied transform
    window.__palette?.refreshInspector();
  }
});
placement.gizmo.addEventListener('objectChange', () => {
  window.__palette?.liveInspector();
});

// ---------------- palette ----------------
const palette = new Palette(placement, substrate, tank, {
  toggleWater,
  setWaterUI,
  setTool, // paint-mode buttons switch the top bar into sculpt mode
  onTankResized: () => {
    scheduleChips();
    syncStage();          // lift the gallery floor so tall stands never clip
    frameCamera();
    // tank.rebuild() recreates the water meshes hidden — restore the fill
    if (tank.state.waterOn) tank.setWater(true, tank.state.waterLevel);
    fish.setEnabled(tank.state.waterOn); // and match the fish to the fill
    fish.syncBounds();    // swim volume follows the new tank dims
  },
});
window.__palette = palette;

// ---------------- chips ----------------
const chipsEl = document.getElementById('chips');
let chipsTimer = 0;
function scheduleChips() {
  clearTimeout(chipsTimer);
  chipsTimer = setTimeout(() => updateChips(chipsEl, tank, substrate, placement), 120);
}
function updateChipsNow() {
  updateChips(chipsEl, tank, substrate, placement);
}
placement.onChange = scheduleChips;
scheduleChips();
setTimeout(updateChipsNow, 400);

// selection tooling keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  // V toggles view-only from anywhere, including while view-only is on
  if (e.key === 'v' || e.key === 'V') {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setViewOnly(!viewOnly);
      return;
    }
  }
  // Esc leaves view-only (its usual "deselect" job is moot there)
  if (e.key === 'Escape' && viewOnly) {
    e.preventDefault();
    setViewOnly(false);
    return;
  }
  // Ctrl/Cmd combos belong to the layout shortcuts (Ctrl+S / Ctrl+O) and the
  // edit shortcuts below — never to the bare G/R/S mode switches.
  if (e.ctrlKey || e.metaKey) {
    if (viewOnly) return; // no saving/undoing from inside a clean view
    const k = e.key.toLowerCase();
    if (k === 'd') {
      e.preventDefault();
      if (placement.selected) placement.duplicate(placement.selected);
    } else if (k === 'z') {
      e.preventDefault();
      e.shiftKey ? placement.redo() : placement.undo();
    } else if (k === 'y') {
      e.preventDefault();
      placement.redo();
    }
    return;
  }
  // every remaining shortcut edits the layout — inert while view-only
  if (viewOnly) return;
  const k = e.key.toLowerCase();
  if (k === 'g') setModeUI('translate');
  else if (k === 'r') setModeUI('rotate');
  else if (k === 's') setModeUI('scale');
  else if (k === 'escape') { placement.select(null); setToolUI(tool); }
  else if (k === 'e') { placement.rerollSelected(); }
  else if (k === 'delete' || k === 'backspace') {
    if (placement.selected) placement.deleteObj(placement.selected);
  }
});

// ---------------- default starter layout ----------------
import { createRock } from './hardscape.js';
import { createWood } from './wood.js';
import { createPlant } from './plants.js';

function starterLayout() {
  const w = tank.state.w, d = tank.state.d, h = tank.state.h;
  substrate.preset('slope');
  substrate.dressType = 'sand';
  substrate.refreshMaterial();

  const add = (obj, x, z, s, rot = 0) => {
    obj.scale.setScalar(s);
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    obj.userData.id = ++Placement._nextId;
    placement._stamp(obj);
    placement.group.add(obj);
    placement.objects.push(obj);
    return obj;
  };

  // main rock trio — left/center/right, largest left (rule of thirds)
  add(createRock('ohko', 101), -w * 0.28, d * 0.1, 8.5, 0.4);
  add(createRock('seiryu', 202), -w * 0.13, d * 0.22, 6, 1.8);
  add(createRock('ohko', 303), w * 0.18, d * 0.05, 5, 2.7);
  // spiderwood on the slope
  add(createWood('spider', 404), w * 0.05, -d * 0.12, 9, -0.6);
  // plants: vallis backdrop, swords mid, hairgrass carpet, moss on rock
  add(createPlant('vallis', 511), -w * 0.38, -d * 0.28, 1);
  add(createPlant('vallis', 512), -w * 0.30, -d * 0.34, 0.9);
  add(createPlant('sword', 613), -w * 0.05, d * 0.18, 0.85);
  add(createPlant('crypt', 714), w * 0.26, d * 0.1, 1);
  add(createPlant('hairgrass', 815), w * 0.34, d * 0.28, 1.1);
  add(createPlant('hairgrass', 816), w * 0.24, d * 0.32, 0.9);
  add(createPlant('javafern', 917), -w * 0.2, -d * 0.05, 0.8);

  placement.settleAll();
  placement.select(null);
}

// Empty tank on a stand is the requested first-load state — no starter objects.
syncStage();
frameCamera();
scheduleChips();

// ---------------- render loop ----------------
const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  tank.tick(dt);
  fish.tick(dt);
  sceneMgr.culler.tick(); // x-ray: hide walls/shell/decor blocking the tank
  renderer.render(scene, camera);

  // Hide the CSS boot screen once the scene is really on screen (2 painted
  // frames covers first-frame shader compilation). The min display time keeps
  // the intro from flashing on fast loads.
  if (++frames === 2) {
    const boot = document.getElementById('boot');
    if (boot) {
      const held = performance.now(); // ms since page start (timeOrigin)
      setTimeout(() => boot.classList.add('done'), Math.max(0, 700 - held));
    }
  }
}
loop();
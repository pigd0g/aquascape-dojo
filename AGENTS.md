# AGENTS.md

## Commands

- `npm run dev` — Vite dev server, fixed at http://localhost:5173
- `npm run build` — production bundle in `dist/` (relatively-rooted `base: './'`, deployed to Netlify)
- No tests, lint, or typecheck. Verify with `npm run build` (catches import/syntax errors) plus manual checks in the browser; `window.__dojo` / `window.__palette` are exposed on console for poking state.

## Architecture

Single-page Three.js (pinned exact `0.160.0`) + Vite app. Plain ES modules, no framework, no backend — everything is client-side.

- `index.html` owns the entire static DOM (topbar buttons, tabs, panes, inspector). JS grabs elements by string ID; new UI needs markup there plus wiring in `main.js`.
- `src/main.js` is the bootstrapper and the only wiring layer: creates `Tank` → `Substrate` → `Placement` → `Palette`, connects them via callback properties (`placement.onChange`, `onTankResized`, `onSelection`, …). There is no event bus — modules don't import each other directly.
- Domain modules: `scene.js` (renderer, dojo room, day/night themes), `tank.js` (parametric glass tank + water), `substrate.js` (heightfield + splat-map), `hardscape/wood/plants.js` (procedural generators), `placement.js` (drag-drop, gizmo, settle, undo, serialization), `palette.js` (library/inspector UI), `calculator.js` (material chips), `presets.js` (all catalogue data — rock/wood/plant/tank types), `noise.js` (seeded RNG).
- Repo ships Three.js reference skills in `.agents/skills/` (`threejs-fundamentals`, `threejs-animation`) worth consulting before writing non-obvious Three.js code.

## Gotchas

- Mouse controls are **deliberately** remapped in `scene.js`: `controls.mouseButtons = { LEFT: null, MIDDLE: DOLLY, RIGHT: ROTATE }`. Left-drag must stay free for object dragging and sculpting. Never "fix" this back to OrbitControls defaults; Shift+RMB pans via OrbitControls' native modifier key.
- Everything is procedural and **seeded**: the seed lives in `obj.userData` and is required for Reroll, tint, and exact re-creation on load. New object kinds need entries in `presets.js` plus the kind switches in `placement.js` (`spawn()` / `spawnFromData()`).
- Save format is `{ version: 1, tank, substrate, objects }`. Heights are only restored when array lengths match the current tank size; unknown catalogue `typeKey`s are silently skipped on load (deliberate, handles renamed types). Keep that tolerance when touching serialization.
- Tank resize rebuilds the whole world: substrate mesh density derives from tank dims (`segW`/`segD` getters), canvas textures are regenerated, objects re-settle (`settleAll`), and the stage/camera resync via the `onTankResized` callback.
- All rebuild/delete paths must dispose geometry, materials, and canvas textures (`disposeTree` in tank.js, `disposeObj` in placement.js) — regenerating without disposal leaks GPU memory.
- Calculator chips are debounced ~120 ms; call `scheduleChips()` after mutations instead of `updateChips()` directly.
- Themes come from the single `EVENING`/`DAY` tables in `scene.js` applied via `setTheme()`; every surface and light value has an entry in both tables. Lighting is hand-calibrated (ACES exposure, spot intensity 4300) — calibration comments in `scene.js` are load-bearing; check plant colors after light changes.
- 2D canvas textures must set `colorSpace = THREE.SRGBColorSpace`.
- `starterLayout()` in `main.js` is intentionally not called — the empty tank on first load is the requested state.
- The README has stale/duplicated sections (e.g. repeated sculpting steps); trust the code.
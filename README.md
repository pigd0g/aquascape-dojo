# Aquascape Dojo 造景道場

An interactive, browser-based 3D workspace for planning aquascapes before touching a drop of water or a gram of soil. Mock up hardscape layouts and plant arrangements in a parametric rimless tank, sculpt your substrate slopes, and get exact material quantities — all free, all local.

Built with **Three.js** (0.160) + **Vite**. No tracking, no backend — everything runs client-side.

## Running

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production bundle in dist/
```

## Using the Dojo

### Layout
- **Left**: 3D viewport — **right-drag pans**, **Ctrl + right-drag orbits**, scroll zooms. The left mouse button stays free for dragging objects and sculpting.
- **Right**: object library (Rocks / Wood / Plants / Ground / Tank) + contextual inspector.

### Sculpting the substrate
1. Pick a tab (🪨 Rocks, 🪵 Wood, 🌿 Plants).
2. **Drag a card** onto the tank — a ghost preview follows the cursor; release to drop.
3. Click any object to select it: move/rotate/scale with the gizmo (G / R / S switch modes), or use the inspector sliders.
4. Inspector extras: **🎲 Reroll** regrows a rock/wood/plant with a fresh seed; **↺ Type defaults** restores a rock's preset values; tint swatches recolor it; **Drop** re-seats it on the substrate.

### Placing hardscape & plants
1. Pick a tab (🪨 Rocks, 🪵 Wood, 🌿 Plants).
2. **Drag a card** onto the tank — a ghost preview follows the cursor; release to drop.
3. Click any object to select it: move/rotate/scale with the gizmo (G / R / S switch modes), or use the inspector sliders.
4. Inspector extras: **🎲 Reroll** regrows a rock/wood/plant with a fresh seed; **↺ Type defaults** restores a rock's preset values; tint swatches recolor it; **Drop** re-seats it on the substrate.

### Theme
- **☀️ / 🌙** toggles a fully adapted dojo — glowing shoji by day, lantern-lit wood by evening; walls, floor, ceiling beams, lighting and UI all switch.

### Sculpting the substrate
1. Click **⚑ Sculpt** in the top bar (or just use the Ground tab).
2. Choose a brush: ▲ Raise, ▼ Lower (or hold Shift to invert), ◐ Smooth, ▬ Flatten.
3. Adjust size/strength sliders or press `[` / `]` for size.
4. Paint directly on the tank floor. Objects settle onto the new terrain automatically.
5. **Layout presets** (Slope, Island, Terrace, Valley, Dunes) give instant iwagumi-style starting terrain.

### Ground materials
- **Base layer**: aquarium soil / gravel / silica sand / black sand / lava — the whole floor.
- **Top dress**: paint sand or gravel over the base just like in real aquascapes (Paint dress / Erase dress tools). Colors are tintable via swatches or a custom color picker; grain can be rerolled.

### Tank engine (🛠️ Tank tab)
- Presets: ADA 60P / 90P / 120P / 45P, Cube 30, 10 gal, 20 gal long, 40 breeder, shallow.
- Or enter custom W×D×H (cm). Everything (substrate, objects, camera) adapts.
- Clear vs low-iron glass, display stand on/off.

### Water & output
- **💧 Water** fills the tank to a chosen level with animated surface ripples, and the fish school appears with it.
- **📷** downloads a PNG snapshot of the current view *and* copies the matching image-model prompt to the clipboard, so the shot can be restyled into a photorealistic aquarium.
- **💾 Save / 📂 Open** keep named layouts in browser storage (`tank1` by default) — Open also lists them with age, size and a delete button. **Save as** writes a copy under a free name (auto-numbered: `tank1` → `tank1 2`) so a new version or another tank never clobbers an existing save.
- **📥 Import / 📤 Export** (inside Open) move the same layout to and from a `.json` file — for backups or sharing between browsers.

### View only
- **V** (or **👁**) hides the whole HUD — top bar, library, inspector, hint and status chips — and expands the 3D view to fill the window, including browser fullscreen.
- Editing is switched off while it is on (no picking, dragging, sculpting or shortcuts), so the layout can't change by accident. A faint **✕ Exit view** chip stays top-right; **V** or Esc closes it.

### Material calculator
Live chips along the bottom report tank volume in litres, substrate litres + kg, rock litres + kg, wood litres, and plant count — updating as you work.

## Procedural generation notes
- **Rocks** are simplex-noise displaced solids, one shape formula per type (Ohko: deep crevices; Seiryu: sharp ridges; lava: pores; pebbles: near-smooth; slate: warped flat shards). Every knob — resolution, noise freq/amp, scale XYZ, seed, colour, roughness, metalness, flat/smooth shading — is live in the inspector, and each type's defaults live in `ROCK_TYPES` (`src/presets.js`). Every instance is seeded, so reroll until you like it.
- **Wood** grows recursively: a tapered trunk with gnarl noise, spread-angled children, plus spiderwood's curling root tendrils, merged into one mesh with a generated bark texture.
- **Plants** (11 species) cover rosettes (swords, anubias, crypts), solid-leaf ferns (java fern ruffled blades), grasses (hairgrass, blyxa), tape-grass ribbons (vallisneria), stem plants (ludwigia — hue-shift them toward red), and moss/carpet patches. All species render in one calibrated rich aquarium-green window.
- **Substrate** is a heightfield (~85×55 cells) with a canvas splat map blending the top-dress layer in a shader; the calculator integrates the heightfield for litre-accurate volume.

## Project structure
```
index.html            shell + panel skeleton
src/main.js           boot, wiring
src/scene.js          renderer, lights, dojo room (shoji walls, coffered beam ceiling, tatami border), camera, themes
src/tank.js           parametric glass tank, stand, water
src/substrate.js      heightfield sculpting, splat shader, materials
src/hardscape.js      procedural rocks
src/wood.js           procedural driftwood
src/plants.js         11 plant species
src/fish.js           GLB fish school (guppy / goldfish / angelfish)
src/placement.js      drag & drop, gizmos, settle, undo, serialization
src/palette.js        library UI + inspector
src/calculator.js     material chips
src/presets.js        all catalogue data
src/noise.js          seeded RNG + fbm/ridged noise helpers
src/storage.js        localStorage layout store
src/layout-ui.js      Save / Open popovers, file Export / Import
src/photo-prompt.js   prompt copied with each snapshot
src/ui.js             clipboard + button helpers
public/models/        fish GLBs
```
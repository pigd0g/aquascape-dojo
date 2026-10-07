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
4. Inspector extras: **🎲 Reroll** regrows a rock/wood/plant with a fresh seed; tint swatches recolor it; **Drop** re-seats it on the substrate.

### Placing hardscape & plants
1. Pick a tab (🪨 Rocks, 🪵 Wood, 🌿 Plants).
2. **Drag a card** onto the tank — a ghost preview follows the cursor; release to drop.
3. Click any object to select it: move/rotate/scale with the gizmo (G / R / S switch modes), or use the inspector sliders.
4. Inspector extras: **🎲 Reroll** regrows a rock/wood/plant with a fresh seed; tint swatches recolor it; **Drop** re-seats it on the substrate.

### Theme
- **☀️ / 🌙** toggles a fully adapted light or dark studio — walls, floor, lighting and UI all switch.

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
- **💧 Water** fills the tank to a chosen level with animated surface ripples.
- **📷** downloads a PNG snapshot of the current view.
- **💾 / 📂** save and reopen layouts as JSON (tank dims, substrate heights + paint mask, every object with its seed & transform).

### Material calculator
Live chips along the bottom report tank volume in litres, substrate litres + kg, rock litres + kg, wood litres, and plant count — updating as you work.

## Procedural generation notes
- **Rocks** are noise-displaced icospheres: Ohko gets horizontal strata + deep ridged crevices; Seiryu gets angular facets + dark veining; lava rock gets pores; slate gets vertical banding. Every instance is seeded — reroll until you like it.
- **Wood** grows recursively: a tapered trunk with gnarl noise, spread-angled children, plus spiderwood's curling root tendrils, merged into one mesh with a generated bark texture.
- **Plants** (13 species) cover rosettes (swords, anubias, crypts), ferns (java, bolbitis with pinnae along stems), grasses (hairgrass, blyxa), tape-grass ribbons (vallisneria), stem plants (rotala, ludwigia — hue-shift them toward red), and moss/carpet patches.
- **Substrate** is a heightfield (~85×55 cells) with a canvas splat map blending the top-dress layer in a shader; the calculator integrates the heightfield for litre-accurate volume.

## Project structure
```
index.html            shell + panel skeleton
src/main.js           boot, wiring, save/load
src/scene.js          renderer, lights, gallery room, camera, themes
src/tank.js           parametric glass tank, stand, water
src/substrate.js      heightfield sculpting, splat shader, materials
src/hardscape.js      procedural rocks
src/wood.js           procedural driftwood
src/plants.js         13 plant species
src/placement.js      drag & drop, gizmos, settle, undo, serialization
src/palette.js        library UI + inspector
src/calculator.js     material chips
src/presets.js        all catalogue data
src/noise.js          seeded RNG + fbm/ridged noise helpers
```
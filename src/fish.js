// Ambient life: the fish school that swims while the tank is filled.
//
// Models AND swimming behaviour are ported from "Maya's Aquarium Maker 3D"
// (github.com/m4ym4y/mayas-aquarium-3d), which drives its fish with Rapier
// rigid bodies inside a physics tank. This app has no physics engine, so the
// same motion is reproduced kinematically: each fish keeps the source's own
// steering state, and the tank walls are mirrored analytically (clamp +
// turn-inward) instead of being collider planes.
//
// Two source behaviours are ported directly:
//   * Fish.tsx (guppy/goldfish) — random-direction steering with a sine head
//     wobble, vertical bobbing driven by an `aY` re-launch impulse, speed 0-4.
//   * Angelfish.tsx — yaw/pitch angular velocities ramp toward random targets,
//     pitch is continuously flattened back toward level, and forward speed
//     decays with occasional impulses.
//
// The GLB's baked "swim" clip drives the tail. The source restarts it on each
// direction change and plays it LoopOnce; here it loops continuously with the
// time scale tied to swim speed — the readable choice at this camera distance.
//
// Population is not a fixed roster: the school is stocked at one fish per
// LITRES_PER_FISH litres of water actually in the tank (see the constant
// below) and every new fish draws a weighted-random species. Pane glass,
// substrate and hardscape are solid to the school — a fish may brush an
// object's surface with a fin, but never swim through it, and never clips
// through the glass or the sand.
//
// Fish are decorative: never selectable, draggable or saved.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32, clamp } from './noise.js';

/** Scratch vector for capsule closest-point queries (avoid per-frame allocs). */
const _segTmp = new THREE.Vector3();

const MODELS = {
  guppy: './models/guppy.glb',
  goldfish: './models/goldfish.glb',
  angelfish: './models/angelfish.glb',
};

// A fish's species is drawn at random on spawn; the weights mirror the source
// project's 7/3/2 shoal so goldfish and angelfish stay accents.
const TYPE_WEIGHTS = { guppy: 7, goldfish: 3, angelfish: 2 };

// Stocking rate — the whole school size hangs off these constants.
// One fish per this many litres of water actually in the tank (tank volume ×
// fill level): a 60P at 80 % holds ~52 L and gets 5 fish, a 120P ~194 L / 19.
const LITRES_PER_FISH = 10;
// Even a sub-10 L puddle gets one fish once it is filled (set 0 to allow a
// filled tank to be empty below one stocking unit).
const MIN_FISH = 1;
// Safety valve for very large custom tanks: a 200×100×100 cm build holds
// 2000 L and would otherwise stock 200 skinned fish, each with its own mixer.
const MAX_FISH = 60;

const FISH_SEED = 0xf15710;

// Behaviour constants from Fish.tsx / Angelfish.tsx.
const GUPPY = { gAccel: -0.1, vAngular: 0.5, speedMax: 4 };
const ANGEL = {
  rotationChangeFrequency: 0.3,
  rotationAccel: 0.3,
  maxRotationVel: 0.5,
  swimImpulseFrequency: 0.5,
  maxSwimImpulse: 2.3,
  swimDrag: 0.6,
};
// The source tank is 20 units across; this one is 36-120 cm, so its speeds are
// scaled up to keep the same "crosses the tank in a few seconds" feel.
const SPEED_SCALE = 2.0;

// Source models are authored nose-toward +x with the origin at the body
// centre. Long-axis sizes (units): guppy 2.80, goldfish 1.74, angelfish 3.05.
// These factors land them at believable centimetre lengths.
const LONG_AXIS = { guppy: 2.8, goldfish: 1.74, angelfish: 3.05 };
const MODEL_SCALE = { guppy: 1.2, goldfish: 2.6, angelfish: 1.5 };

// Clearances (cm) for the solid-volume tests.
const PANE_INSET = 2.4; // swim volume keeps this off the glass
const FLOOR_CLEAR = 0.9; // keeps the body above the substrate surface
const OBS_MARGIN = 0.8; // grazing gap kept off hardscape surfaces
const SEED_TRIES = 24; // rejection samples when scattering a fish

export class FishSchool {
  constructor(scene, tank, substrate, placement) {
    this.scene = scene;
    this.tank = tank;
    this.substrate = substrate || null;
    this.placement = placement || null;
    this.enabled = false;
    this.rnd = mulberry32(FISH_SEED);
    this.t = 0;
    this._lastWaterLevel = -1;
    this._obstacleCheck = 0;
    this._obstacles = [];
    this.mixers = [];
    this.fish = [];

    this.group = new THREE.Group();
    this.group.name = 'fishSchool';
    this.group.visible = false;
    scene.add(this.group);

    this.syncBounds();
    this._load();
  }

  // ================= loading =================
  async _load() {
    const loader = new GLTFLoader();
    try {
      const gltfs = await Promise.all(
        Object.values(MODELS).map((url) => loader.loadAsync(url)),
      );
      this.sources = {};
      Object.keys(MODELS).forEach((key, i) => {
        const gltf = gltfs[i];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false; // 3 cm fish would only add shadow noise
          o.receiveShadow = false;
          o.frustumCulled = false; // skinned bounds lag the bones
          if (o.material) {
            o.material.side = THREE.DoubleSide; // fin cards
            o.material.dithering = true;
            o.material.fog = false; // dojo fog would wash out small fish
          }
        });
        this.sources[key] = gltf;
      });
      this._spawnSchool();
    } catch (err) {
      // A missing model must not break the app: the tank simply stays
      // fishless, exactly as it was before this feature existed.
      console.warn('Fish models failed to load:', err);
    }
  }

  /** True once the GLBs are in and the school has been created. */
  get ready() {
    return this.fish.length > 0;
  }

  // ================= schooling =================
  /** Swim volume derived from the current tank dims + water level. */
  syncBounds() {
    const { w, d, h } = this.tank.state;
    const waterY = h * clamp(this.tank.state.waterLevel, 0.05, 1);
    this.bounds = {
      x0: -w / 2 + PANE_INSET,
      x1: w / 2 - PANE_INSET,
      z0: -d / 2 + PANE_INSET,
      z1: d / 2 - PANE_INSET,
      y0: 1.6,
      y1: Math.max(3.0, waterY - 1.5), // a body-length below the surface
    };
    this._lastWaterLevel = this.tank.state.waterLevel;
  }

  /**
   * Rebuild the avoidance volumes from the placed hardscape.
   *
   * Wood is stored as CAPSULE CHAINS taken from the generator's own limb
   * spines (`userData.colliders`), not a box: a 12-scale log rotated on two
   * axes has a world AABB up to ~50x30 cm — well over half a 90x28 tank floor —
   * while the bark itself is a thin diagonal tube. Boxes made the whole shoal
   * refuse to cross the tank; capsule chains only cover the wood.
   *
   * Rock stays AABB: stones are compact blobs whose diagonal box is close to
   * their silhouette, and their displaced surface can't be cheaper to sample.
   *
   * Foliage is deliberately ignored.
   */
  _refreshObstacles() {
    this._obstacles.length = 0;
    if (!this.placement) return;
    const box = new THREE.Box3();
    for (const obj of this.placement.objects) {
      const u = obj.userData || {};
      const kind = u.kindKey ?? u.kind; // placement stamps kindKey; the
      // generators themselves only set `kind`
      if (kind !== 'rock' && kind !== 'wood') continue;
      obj.updateMatrixWorld(true);
      if (kind === 'wood' && u.colliders?.length) {
        // world-space capsule chain: transform each spine point, scale its
        // radius by the object's scale (uniform from the palette; the gizmo
        // could flatten a piece, so take the largest component — over-clear
        // slightly rather than ever let a fish sink into the bark)
        const s = Math.max(
          Math.abs(obj.scale.x),
          Math.abs(obj.scale.y),
          Math.abs(obj.scale.z),
        ) || 1;
        const segs = [];
        let top = -Infinity;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        const p = new THREE.Vector3();
        for (const chain of u.colliders) {
          const n = chain.pts.length;
          for (let i = 0; i < n - 1; i++) {
            const a = chain.pts[i];
            const b = chain.pts[i + 1];
            p.set(a[0], a[1], a[2]).applyMatrix4(obj.matrixWorld);
            const ax = p.x, ay = p.y, az = p.z;
            p.set(b[0], b[1], b[2]).applyMatrix4(obj.matrixWorld);
            const r = Math.max(chain.radii[i], chain.radii[i + 1] ?? chain.radii[i]) * s;
            segs.push({ ax, ay, az, bx: p.x, by: p.y, bz: p.z, r });
            const hi = Math.max(ay, p.y) + r;
            if (hi > top) top = hi;
            x0 = Math.min(x0, ax - r, p.x - r); x1 = Math.max(x1, ax + r, p.x + r);
            z0 = Math.min(z0, az - r, p.z - r); z1 = Math.max(z1, az + r, p.z + r);
          }
        }
        if (!segs.length) continue;
        this._obstacles.push({ chain: segs, x0, x1, z0, z1, top });
        continue;
      }
      box.setFromObject(obj);
      if (box.isEmpty()) continue;
      this._obstacles.push({
        x0: box.min.x,
        x1: box.max.x,
        z0: box.min.z,
        z1: box.max.z,
        top: box.max.y,
      });
    }
  }

  /**
   * Stocking count for the current fill: one fish per LITRES_PER_FISH litres
   * of water actually in the tank, floored at MIN_FISH. Recomputed live, so
   * resizing the tank or moving the fill-level slider restocks the school.
   */
  _stockCount() {
    const { w, d, h, waterLevel } = this.tank.state;
    const litres = ((w * d * h) / 1000) * clamp(waterLevel, 0.05, 1);
    return clamp(Math.round(litres / LITRES_PER_FISH), MIN_FISH, MAX_FISH);
  }

  /** Pick a species for a new fish by TYPE_WEIGHTS; null if no model is in. */
  _pickType(rnd) {
    // a missing GLB must not be picked and then silently skipped
    const keys = Object.keys(TYPE_WEIGHTS).filter((k) => this.sources[k]);
    if (!keys.length) return null;
    let total = 0;
    for (const k of keys) total += TYPE_WEIGHTS[k];
    let roll = rnd() * total;
    for (const k of keys) {
      roll -= TYPE_WEIGHTS[k];
      if (roll < 0) return k;
    }
    return keys[keys.length - 1];
  }

  /** Instantiate one fish of `key` from its loaded model. */
  _makeFish(key) {
    const rnd = this.rnd;
    const src = this.sources[key];
    const clip =
      src.animations.find((a) => /swim/i.test(a.name)) ?? src.animations[0];
    const model = cloneSkinned(src.scene);
    const scaleMul = 0.85 + rnd() * 0.3;
    model.scale.setScalar((MODEL_SCALE[key] ?? 1) * scaleMul);
    // half the nose-to-tail length in cm: the collision body used below, so a
    // fish stops at a surface instead of burying its head in the rock
    const reach = ((LONG_AXIS[key] ?? 2.4) * (MODEL_SCALE[key] ?? 1) * scaleMul) / 2;

    // one mixer per fish: each clone owns its skeleton, so clips can't be
    // shared between mixers
    const mixer = new THREE.AnimationMixer(model);
    let action = null;
    if (clip) {
      action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      // desync the shoal: same clip, different phase and tempo
      action.timeScale = 0.85 + rnd() * 0.5;
      action.time = rnd() * clip.duration;
      action.play();
    }
    this.mixers.push(mixer);
    this.group.add(model);

    const f = {
      key,
      model,
      mixer,
      action,
      reach, // half body length (cm) — collision keep-out radius
      kind: key === 'angelfish' ? 'angel' : 'guppy',
      // steering state, shared by both source behaviours
      angle: rnd() * Math.PI * 2, // yaw (radians)
      pitch: 0, // angelfish only
      // Fish.tsx state
      targetAngle: rnd() * Math.PI * 2,
      targetY: 0,
      aY: 0,
      vY: 0,
      speed: 1.5,
      // Angelfish.tsx state
      yawVel: 0,
      yawTargetVel: 0,
      pitchVel: 0,
      pitchTargetVel: 0,
      // clearance held when crossing hardscape
      lift: 0.3 + rnd() * 1.8,
      // per-fish head-wobble phase (source used one shared t)
      wobblePhase: rnd() * Math.PI * 2,
    };
    this.fish.push(f);
    return f;
  }

  /**
   * Instantiate the school: the stocking count comes from the tank's water
   * volume (one fish per LITRES_PER_FISH litres), and each fish's species is
   * drawn at random from TYPE_WEIGHTS. Called once the GLBs are in;
   * setStock() keeps the count in step as tank dims or the fill level change.
   */
  _spawnSchool() {
    this.syncBounds();
    this._refreshObstacles();
    this.setStock(this._stockCount());
    this.group.visible = this.enabled && this.fish.length > 0;
  }

  /**
   * Grow/shrink the school to `n` fish. Existing fish keep swimming — only
   * the difference is instantiated — so nudging the fill slider doesn't
   * restart the whole shoal.
   */
  setStock(n) {
    if (!this.sources) return; // GLBs still downloading
    n = clamp(Math.round(n), 0, MAX_FISH);
    while (this.fish.length > n) {
      this._removeFish(this.fish[this.fish.length - 1]);
    }
    while (this.fish.length < n) {
      const key = this._pickType(this.rnd);
      if (!key) return; // no models loaded at all
      const f = this._makeFish(key);
      this._seedPosition(f);
    }
  }

  /**
   * Drop one fish. Its mixer is stopped and uncached so the removed skeleton
   * stops being animated; geometry and materials are NOT disposed — every
   * clone shares the source GLTF's resources, which outlive any single fish.
   */
  _removeFish(f) {
    const i = this.fish.indexOf(f);
    if (i !== -1) this.fish.splice(i, 1);
    f.mixer.stopAllAction();
    f.mixer.uncacheRoot(f.model);
    const m = this.mixers.indexOf(f.mixer);
    if (m !== -1) this.mixers.splice(m, 1);
    this.group.remove(f.model);
  }

  /**
   * How far inside an obstacle's keep-out a point sits (cm; <= 0 = clear).
   * Box obstacles use the same horizontal + climb-over gate as _containInTank;
   * chain obstacles (wood) use the nearest capsule segment, so only the bark
   * itself blocks — a long diagonal log no longer walls off the tank.
   */
  _obsDepth(o, x, y, z, reach = 0.5, lift = 0.5) {
    const m = OBS_MARGIN + reach;
    if (o.chain) {
      let best = Infinity;
      for (const s of o.chain) {
        const d = this._closestOnSeg(s, x, y, z, _segTmp);
        if (d - s.r - m < best) best = d - s.r - m;
      }
      return best < 0 ? -best : 0;
    }
    const dx = Math.max(o.x0 - x, 0, x - o.x1);
    const dz = Math.max(o.z0 - z, 0, z - o.z1);
    if (Math.sqrt(dx * dx + dz * dz) >= m) return 0; // horizontally clear
    const gate = o.top + OBS_MARGIN + lift - 0.2;
    return y < gate ? gate - y : 0;
  }

  /** Nearest point on capsule segment `s` to (x,y,z), into `out`; distance. */
  _closestOnSeg(s, x, y, z, out) {
    const abx = s.bx - s.ax, aby = s.by - s.ay, abz = s.bz - s.az;
    const apx = x - s.ax, apy = y - s.ay, apz = z - s.az;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 1e-8 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out.set(s.ax + abx * t, s.ay + aby * t, s.az + abz * t);
    const dx = x - out.x, dy = y - out.y, dz = z - out.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Boolean form of _blockedDepth: true if (x, y, z) is inside the substrate
   * or within the keep-out of a hardscape volume for a fish of body radius
   * `reach` holding `lift` of clearance. Mirrors _containInTank's thresholds
   * exactly, so a point that passes this test is never displaced by the first
   * containment pass (and `__dojo.fish._blockedAt(...)` is meaningful in the
   * console).
   */
  _blockedAt(x, y, z, reach = 0.5, lift = 0.5) {
    return this._blockedDepth(x, y, z, reach, lift) > 0;
  }

  /**
   * How far below the nearest legal position the point sits (cm; 0 = clear).
   * Used both as a boolean test and to pick the least-bad sample when a
   * monster rock covers the whole water column and nowhere is truly clear.
   */
  _blockedDepth(x, y, z, reach = 0.5, lift = 0.5) {
    let depth = 0;
    if (this.substrate) {
      const floor = this.substrate.heightAt(x, z) + FLOOR_CLEAR;
      depth = Math.max(depth, floor - y);
    }
    for (const o of this._obstacles) {
      const d = this._obsDepth(o, x, y, z, reach, lift);
      if (d > depth) depth = d;
    }
    return depth;
  }

  /**
   * Scatter a fish at a random point in the water volume — across the full
   * width, depth AND height of the column, never pinned to mid-height.
   * Rejection sampling keeps the spawn off hardscape and the substrate
   * surface, so the shoal doesn't pop when the first containment pass runs.
   */
  _seedPosition(f) {
    const rnd = this.rnd;
    const b = this.bounds;
    let x = 0;
    let y = 0;
    let z = 0;
    let bestDepth = Infinity;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let attempt = 0; attempt < SEED_TRIES; attempt++) {
      x = b.x0 + rnd() * (b.x1 - b.x0);
      z = b.z0 + rnd() * (b.z1 - b.z0);
      // sample above the local substrate surface: a deep mound can cover the
      // bottom of the swim band, and a fish seeded inside it is ejected on its
      // first tick — the "shoal pops on fill" bug
      const floor = this.substrate
        ? this.substrate.heightAt(x, z) + FLOOR_CLEAR
        : b.y0;
      const yLo = Math.min(Math.max(b.y0, floor), b.y1);
      y = yLo + rnd() * (b.y1 - yLo);
      // a monster rock can cover the whole column of a small cub — keep the
      // least-penetrating sample so the fish is pushed out by the minimum
      const depth = this._blockedDepth(x, y, z, f.reach, f.lift);
      if (depth <= 0) {
        bx = x; by = y; bz = z;
        bestDepth = 0;
        break;
      }
      if (depth < bestDepth) {
        bestDepth = depth;
        bx = x; by = y; bz = z;
      }
    }
    x = bx; y = by; z = bz;
    f.model.position.set(x, y, z);
    // the fish's cruise height target obeys the same floor, so it never dives
    // into a mound it was just seeded above
    const floor = this.substrate
      ? this.substrate.heightAt(x, z) + FLOOR_CLEAR
      : b.y0;
    const yLo = Math.min(Math.max(b.y0, floor), b.y1);
    f.targetY = yLo + rnd() * (b.y1 - yLo);
    f.angle = rnd() * Math.PI * 2;
    f.targetAngle = f.angle;
    f.vY = 0;
    f.aY = 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    // if the models are still downloading, _spawnSchool() will obey `enabled`
    this.group.visible = this.enabled && this.fish.length > 0;
    if (on) {
      this.syncBounds();
      this._refreshObstacles();
      // a drained pause shouldn't leave the school smeared along the glass
      for (const f of this.fish) this._seedPosition(f);
      // the fill level sets the actual water volume — and with it the stock
      this.setStock(this._stockCount());
    }
  }

  // ================= per-frame =================
  /** Advance the school. `dt` in seconds. */
  tick(dt) {
    if (!this.sources) return; // GLBs still downloading
    // water-level changes (slider / load) resize the swim volume on the fly;
    // they also change the water volume, and with it the stocking count
    if (this.tank.state.waterLevel !== this._lastWaterLevel) {
      this.syncBounds();
      if (this.enabled) this.setStock(this._stockCount());
    }
    if (!this.fish.length) return;
    // placed hardscape moves while dragging: refresh the avoidance set a few
    // times a second (cheap — a handful of Box3 fits)
    this._obstacleCheck -= dt;
    if (this._obstacleCheck <= 0) {
      this._obstacleCheck = 0.4;
      this._refreshObstacles();
    }

    // tails only beat while the fish are on screen
    if (!this.enabled) return;
    for (const mixer of this.mixers) mixer.update(dt);

    this.t += dt;
    const b = this.bounds;
    for (const f of this.fish) {
      if (f.kind === 'angel') this._tickAngelfish(f, dt, b);
      else this._tickGuppy(f, dt, b);
    }
  }

  /**
   * Port of Fish.tsx: random-direction steering with vertical bobbing.
   * `aYFactor` amplifies vertical acceleration with distance from `targetY`,
   * `vY` integrates it, and dropping past the target re-launches the fish
   * upward via `aY` — the source's signature bob.
   */
  _tickGuppy(f, dt, b) {
    const pos = f.model.position;

    // ---- vertical movement ----
    const aYFactor = clamp(1, 3, Math.abs(pos.y - f.targetY));
    f.vY += (GUPPY.gAccel + f.aY) * dt * aYFactor;
    f.aY *= Math.max(1 - dt, 0);
    if (f.aY < 0) f.aY = 0;
    if (pos.y < f.targetY && f.aY <= 0.1 && f.vY <= 0) f.aY = 0.5;
    pos.y += f.vY * dt;

    // ---- steering ----
    const angleDiff = f.angle - f.targetAngle;
    if (Math.abs(angleDiff) < 0.1) {
      f.targetAngle = this.rnd() * Math.PI * 2;
      // pick a new height inside the swim band (source: random ±9)
      f.targetY = b.y0 + this.rnd() * (b.y1 - b.y0);
      f.speed = this.rnd() * GUPPY.speedMax;
    }
    // rotate toward the target the short way round
    if ((angleDiff < 0 && angleDiff > -Math.PI) || angleDiff > Math.PI) {
      f.angle += GUPPY.vAngular * dt;
    } else {
      f.angle -= GUPPY.vAngular * dt;
    }
    if (f.angle < 0) f.angle += 2 * Math.PI;
    else if (f.angle > 2 * Math.PI) f.angle -= 2 * Math.PI;

    // ---- move (source: forward vector spun by `angle`) ----
    const sp = f.speed * SPEED_SCALE;
    pos.x += Math.cos(f.angle) * sp * dt;
    pos.z += -Math.sin(f.angle) * sp * dt;
    this._containInTank(f, b);

    // ---- pose (source: y = angle + sin(t)/4 head wobble, z = vY * π/8) ----
    const rY = f.angle + Math.sin(this.t + f.wobblePhase) / 4;
    const rZ = clamp(f.vY * (Math.PI / 8), -0.5, 0.5);
    f.model.rotation.set(0, rY, rZ, 'XYZ');
    if (f.action) f.action.timeScale = 0.7 + Math.abs(f.speed) * 0.35;
  }

  /**
   * Port of Angelfish.tsx: yaw/pitch angular velocities ramp toward random
   * targets, pitch is continuously flattened toward level so the fish never
   * flips upside down, and speed decays with occasional impulses.
   */
  _tickAngelfish(f, dt, b) {
    const pos = f.model.position;

    // randomly change target velocity sometimes
    if (this.rnd() < ANGEL.rotationChangeFrequency * dt) {
      f.yawTargetVel = (this.rnd() * 2 - 1) * ANGEL.maxRotationVel;
      f.pitchTargetVel = (this.rnd() * 2 - 1) * ANGEL.maxRotationVel;
    }

    // accelerate pitch and yaw in direction of target
    f.yawVel += ANGEL.rotationAccel * dt * (f.yawTargetVel > f.yawVel ? 1 : -1);
    f.pitchVel +=
      ANGEL.rotationAccel * dt * (f.pitchTargetVel > f.pitchVel ? 1 : -1);

    // pitch and yaw in direction of their velocity
    f.angle += f.yawVel * dt;
    f.pitch += f.pitchVel * dt;

    // to prevent flipping upside down, pull pitch towards zero
    f.pitch *= 1 - 2.1 * ANGEL.maxRotationVel * dt;

    // decelerate over time, then maybe speed up (or go backwards)
    f.speed *= 1 - ANGEL.swimDrag * dt;
    if (this.rnd() < ANGEL.swimImpulseFrequency * dt) {
      f.speed += (this.rnd() * 1.2 - 0.2) * ANGEL.maxSwimImpulse;
    }
    f.speed = clamp(f.speed, -1.5, 4.5);

    // movement vector (source: pitch about RIGHT, then yaw about UP)
    const sp = f.speed * SPEED_SCALE;
    const cp = Math.cos(f.pitch);
    pos.x += Math.cos(f.angle) * cp * sp * dt;
    pos.y += Math.sin(f.pitch) * sp * dt;
    pos.z += -Math.sin(f.angle) * cp * sp * dt;

    this._containInTank(f, b);
    // level out after touching floor/ceiling instead of grinding along it
    if (pos.y <= b.y0 + 0.01) {
      f.pitch = Math.max(0, f.pitch) * 0.5;
      f.pitchVel = 0;
      f.pitchTargetVel = 0;
    } else if (pos.y >= b.y1 - 0.01) {
      f.pitch = Math.min(0, f.pitch) * 0.5;
      f.pitchVel = 0;
      f.pitchTargetVel = 0;
    }

    f.model.rotation.set(0, f.angle, f.pitch, 'XYZ');
    if (f.action) f.action.timeScale = 0.7 + Math.abs(f.speed) * 0.35;
  }

  /**
   * The source bounces fish off the cuboid colliders lining its tank and its
   * placed props. With no physics engine that is mirrored analytically here:
   * reflect off the pane planes and turn inward, keep clear of hardscape
   * footprints (lift over when there is headroom, else turn away), and never
   * sink into the substrate.
   */
  _containInTank(f, b) {
    const pos = f.model.position;
    let hitX = 0;
    let hitZ = 0;

    if (pos.x < b.x0) {
      pos.x = b.x0;
      hitX = 1;
    } else if (pos.x > b.x1) {
      pos.x = b.x1;
      hitX = -1;
    }
    if (pos.z < b.z0) {
      pos.z = b.z0;
      hitZ = 1;
    } else if (pos.z > b.z1) {
      pos.z = b.z1;
      hitZ = -1;
    }
    if (pos.y < b.y0) {
      pos.y = b.y0;
      f.vY = Math.abs(f.vY);
    } else if (pos.y > b.y1) {
      pos.y = b.y1;
      f.vY = -Math.abs(f.vY);
    }

    if (hitX || hitZ) {
      // steer toward the tank interior: direction (hitX, hitZ), converted to
      // the yaw convention this app uses (velocity = [cos a, 0, -sin a])
      const inward = Math.atan2(-hitZ, hitX);
      f.angle = inward + (this.rnd() - 0.5) * 0.6;
      f.targetAngle = f.angle;
      if (f.kind === 'angel') {
        // keep the turn going the way it was already travelling
        f.yawVel = (this.rnd() > 0.5 ? 1 : -1) * ANGEL.maxRotationVel;
        f.yawTargetVel = 0;
      }
    }

    // hardscape avoidance. Rocks are boxes: cruise over them when there is
    // headroom, else leave through the nearest side face. Wood is a capsule
    // chain taken from the generator's own limb spines — a fish inside the bark
    // is pushed out of the nearest tube (the minimal correction), never across
    // the whole world box, which for a long diagonal log covers the entire
    // tank floor and made the shoal refuse to swim past it.
    const reach = f.reach ?? 0.5;
    const m = OBS_MARGIN + reach;
    for (const o of this._obstacles) {
      if (o.chain) {
        let closest = null;
        let closestD = Infinity;
        for (const s of o.chain) {
          const d = this._closestOnSeg(s, pos.x, pos.y, pos.z, _segTmp);
          if (d - s.r < closestD) {
            closestD = d - s.r;
            closest = s;
          }
        }
        if (closestD >= m) continue; // outside the bark keep-out
        // push out along the surface normal of the nearest tube. _segTmp was
        // overwritten by every segment in the loop, so the winner's closest
        // point is recomputed here (only reached while actually inside).
        this._closestOnSeg(closest, pos.x, pos.y, pos.z, _segTmp);
        let nx = pos.x - _segTmp.x;
        let ny = pos.y - _segTmp.y;
        let nz = pos.z - _segTmp.z;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-5) {
          nx = 0; ny = 1; nz = 0; // dead-centre on the axis: pop upward
        } else {
          nx /= len; ny /= len; nz /= len;
        }
        pos.x += nx * (m - closestD);
        pos.y += ny * (m - closestD);
        pos.z += nz * (m - closestD);
        // steer around the limb: reflect the heading off the surface when the
        // normal is mostly horizontal (a vertical push is a climb-over, not a
        // turn). Same yaw convention as the pane bounce: velocity = [cos a, 0,
        // -sin a].
        const nl = Math.sqrt(nx * nx + nz * nz);
        if (nl > 0.6) {
          const hx = nx / nl;
          const hz = nz / nl;
          const dx = Math.cos(f.angle);
          const dz = -Math.sin(f.angle);
          const dot = dx * hx + dz * hz;
          if (dot < 0) {
            const rx = dx - 2 * dot * hx;
            const rz = dz - 2 * dot * hz;
            f.angle = Math.atan2(-rz, rx);
            f.targetAngle = f.angle;
            if (f.kind === 'angel') {
              f.yawVel = (this.rnd() > 0.5 ? 1 : -1) * ANGEL.maxRotationVel;
              f.yawTargetVel = 0;
            }
          }
        }
        continue;
      }

      if (pos.x <= o.x0 - m || pos.x >= o.x1 + m) continue;
      if (pos.z <= o.z0 - m || pos.z >= o.z1 + m) continue;
      const lift = o.top + OBS_MARGIN + f.lift;
      if (pos.y >= lift - 0.2) continue; // already clear
      if (lift <= b.y1) {
        pos.y = lift; // climb over
        if (f.kind === 'guppy') f.vY = Math.max(f.vY, 0);
        continue;
      }

      // No headroom: leave through a side face. The obstacle's bounding box can
      // poke through the glass (wood/rock dragged against a pane), so the exit
      // must land INSIDE the swim volume — the naive nearest-face push put fish
      // on the far side of the glass, which is very visible on load, when the
      // whole shoal is re-seeded into those footprints at once.
      const out = m + 0.2; // clear of the inflated solid
      const exits = [
        { d: pos.x - o.x0, axis: 'x', to: o.x0 - out, yaw: Math.PI },
        { d: o.x1 - pos.x, axis: 'x', to: o.x1 + out, yaw: 0 },
        { d: pos.z - o.z0, axis: 'z', to: o.z0 - out, yaw: Math.PI / 2 },
        { d: o.z1 - pos.z, axis: 'z', to: o.z1 + out, yaw: -Math.PI / 2 },
      ]
        .filter((e) =>
          e.axis === 'x' ? e.to >= b.x0 && e.to <= b.x1 : e.to >= b.z0 && e.to <= b.z1,
        )
        .sort((a, c) => a.d - c.d);
      const exit = exits[0];
      if (exit) {
        if (exit.axis === 'x') pos.x = exit.to;
        else pos.z = exit.to;
        f.angle = exit.yaw;
        f.targetAngle = f.angle;
      } else {
        // the obstacle spans the whole cross-section: there is nowhere to go
        // but over the top, so ride the ceiling until past it
        pos.y = b.y1;
        if (f.kind === 'guppy') f.vY = Math.max(f.vY, 0);
      }
    }

    // never swim into the substrate (sculpted mounds can be tall)
    if (this.substrate) {
      const floor = this.substrate.heightAt(pos.x, pos.z) + FLOOR_CLEAR;
      if (pos.y < floor) {
        pos.y = Math.min(floor, b.y1);
        if (f.kind === 'guppy' && f.vY < 0) f.vY = 0;
      }
    }

    // Final clamp. The obstacle and substrate passes above can move a fish
    // anywhere, so the pane bounce at the top of this method is not enough:
    // re-seat inside the glass no matter which branch ran last. Fish outside
    // the tank (in the room) are the one bug this method must never allow.
    pos.x = clamp(pos.x, b.x0, b.x1);
    pos.z = clamp(pos.z, b.z0, b.z1);
    pos.y = clamp(pos.y, b.y0, b.y1);
  }

  dispose() {
    for (const mixer of this.mixers) mixer.stopAllAction();
    this.mixers.length = 0;
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }
}

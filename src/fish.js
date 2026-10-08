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
// Fish are decorative: never selectable, draggable or saved.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32, clamp } from './noise.js';

const MODELS = {
  guppy: './models/guppy.glb',
  goldfish: './models/goldfish.glb',
  angelfish: './models/angelfish.glb',
};

// Roster mirroring the source project's default arrangement (10 guppies,
// 6 goldfish, 3 angelfish), trimmed so the school stays cheap here.
const SCHOOL = [
  ['guppy', 7],
  ['goldfish', 3],
  ['angelfish', 2],
];

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
const MODEL_SCALE = { guppy: 1.2, goldfish: 2.6, angelfish: 1.5 };

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
    const inset = 2.4; // stay clear of the panes
    this.bounds = {
      x0: -w / 2 + inset,
      x1: w / 2 - inset,
      z0: -d / 2 + inset,
      z1: d / 2 - inset,
      y0: 1.6,
      y1: Math.max(3.0, waterY - 1.5), // a body-length below the surface
    };
    this._lastWaterLevel = this.tank.state.waterLevel;
  }

  /**
   * Rebuild the avoidance footprints from the placed hardscape. Only the
   * horizontal footprint (AABB in X/Z) plus the obstacle's top height are
   * kept: fish swim around rock rather than through it, but may cross above.
   * Bounding *spheres* were useless here — an 8.5x dragon stone's sphere
   * swallows most of a 60 cm tank. Foliage is deliberately ignored.
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

  /** Instantiate the school from the loaded models. */
  _spawnSchool() {
    const rnd = this.rnd;
    for (const [key, count] of SCHOOL) {
      const src = this.sources[key];
      if (!src) continue;
      const clip =
        src.animations.find((a) => /swim/i.test(a.name)) ?? src.animations[0];
      for (let i = 0; i < count; i++) {
        const model = cloneSkinned(src.scene);
        model.scale.setScalar((MODEL_SCALE[key] ?? 1) * (0.85 + rnd() * 0.3));

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

        this.fish.push({
          key,
          model,
          action,
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
        });
      }
    }
    this.group.visible = this.enabled; // obey whatever the water state is now
    this.syncBounds();
    this._refreshObstacles();
    // seed positions now that the swim band is known
    for (const f of this.fish) this._seedPosition(f, true);
  }

  /** Place a fish somewhere in the swim volume (fresh spawn / re-drain). */
  _seedPosition(f, spreadY = false) {
    const rnd = this.rnd;
    const b = this.bounds;
    f.model.position.set(
      b.x0 + rnd() * (b.x1 - b.x0),
      spreadY ? b.y0 + rnd() * (b.y1 - b.y0) : (b.y0 + b.y1) * 0.5,
      b.z0 + rnd() * (b.z1 - b.z0),
    );
    f.targetY = b.y0 + rnd() * (b.y1 - b.y0);
    f.angle = rnd() * Math.PI * 2;
    f.targetAngle = f.angle;
  }

  setEnabled(on) {
    this.enabled = !!on;
    // if the models are still downloading, _spawnSchool() will obey `enabled`
    this.group.visible = this.enabled && this.fish.length > 0;
    if (on) {
      this.syncBounds();
      this._refreshObstacles();
      // a drained pause shouldn't leave the school smeared along the glass
      for (const f of this.fish) this._seedPosition(f, true);
    }
  }

  // ================= per-frame =================
  /** Advance the school. `dt` in seconds. */
  tick(dt) {
    if (!this.fish.length) return;
    // water-level changes (slider / load) resize the swim volume on the fly
    if (this.tank.state.waterLevel !== this._lastWaterLevel) this.syncBounds();
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

    // hardscape avoidance: cruise over rock when there is headroom, otherwise
    // turn away rather than clip through it
    for (const o of this._obstacles) {
      if (pos.x <= o.x0 || pos.x >= o.x1) continue;
      if (pos.z <= o.z0 || pos.z >= o.z1) continue;
      const lift = o.top + 0.5 + f.lift;
      if (pos.y >= lift - 0.2) continue; // already clear
      if (lift <= b.y1) {
        pos.y = lift; // climb over
        if (f.kind === 'guppy') f.vY = Math.max(f.vY, 0);
        continue;
      }
      // no headroom: leave through the nearest face, facing that way
      const dl = pos.x - o.x0,
        dr = o.x1 - pos.x;
      const db = pos.z - o.z0,
        df = o.z1 - pos.z;
      const depth = Math.min(dl, dr, db, df);
      if (depth === dl) {
        pos.x = o.x0 - 0.3;
        f.angle = Math.PI;
      } else if (depth === dr) {
        pos.x = o.x1 + 0.3;
        f.angle = 0;
      } else if (depth === db) {
        pos.z = o.z0 - 0.3;
        f.angle = Math.PI / 2;
      } else {
        pos.z = o.z1 + 0.3;
        f.angle = -Math.PI / 2;
      }
      f.targetAngle = f.angle;
    }

    // never swim into the substrate (sculpted mounds can be tall)
    if (this.substrate) {
      const floor = this.substrate.heightAt(pos.x, pos.z) + 0.9;
      if (pos.y < floor) {
        pos.y = Math.min(floor, b.y1);
        if (f.kind === 'guppy' && f.vY < 0) f.vY = 0;
      }
    }
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

// Renderer, lighting, gallery backdrop, camera + controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STYLES } from './presets.js';

const DARK = { bg: 0x141419, wall: 0x1a1a20, floor: 0x212126, hemi: 1.1, amb: 0.38, exposure: 1.25 };
const LIGHT = { bg: 0xe7e6e0, wall: 0xe3e1d9, floor: 0xbab6ab, hemi: 1.25, amb: 0.5, exposure: 1.1 };

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DARK.exposure;
  renderer.domElement.classList.add('gl');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STYLES.dojoBlack);
  scene.fog = new THREE.Fog(STYLES.dojoBlack, 260, 560);

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 1200);
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
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.zoomSpeed = 1.15;
  controls.panSpeed = 1.6;

  // ---- lights ----
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4038, DARK.hemi);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff3dc, 3.4);
  key.position.set(-38, 70, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -80;
  key.shadow.camera.right = 80;
  key.shadow.camera.top = 80;
  key.shadow.camera.bottom = -60;
  key.shadow.camera.far = 280;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbbd0ff, 1.1);
  fill.position.set(45, 34, -40);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9a3, 1.3);
  rim.position.set(8, 22, 68);
  scene.add(rim);

  const amb = new THREE.AmbientLight(0xffffff, DARK.amb);
  scene.add(amb);

  // display light over the tank (aquarium-style)
  const spot = new THREE.SpotLight(0xfff6e4, 3200, 320, Math.PI / 3.6, 0.6, 1.1);
  spot.position.set(0, 96, 12);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 0, 0);
  scene.add(spotTarget);
  spot.target = spotTarget;
  scene.add(spot);

  // ---- gallery room (walls + floor only) ----
  const room = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: DARK.wall, roughness: 0.94, metalness: 0 });
  const floorMat = new THREE.MeshStandardMaterial({ color: DARK.floor, roughness: 0.85, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);
  const wallH = 120;
  const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(600, wallH), wallMat);
  wallBack.position.set(0, wallH / 2, -150);
  room.add(wallBack);
  const wallSide = new THREE.Mesh(new THREE.PlaneGeometry(600, wallH), wallMat);
  wallSide.rotation.y = Math.PI / 2;
  wallSide.position.set(-170, wallH / 2, 0);
  room.add(wallSide);
  scene.add(room);

  function setStageY(y) {
    floor.position.y = y;
    wallBack.position.y = wallH / 2 + y;
    wallSide.position.y = wallH / 2 + y;
  }
  setStageY(0);

  function setTankFocus(x, y, z) {
    spot.position.set(x, y + 86, z + 14);
    spotTarget.position.set(x, y, z);
  }

  function setTheme(light) {
    const T = light ? LIGHT : DARK;
    scene.background.set(T.bg);
    scene.fog.color.set(T.bg);
    wallMat.color.set(T.wall);
    floorMat.color.set(T.floor);
    hemi.intensity = T.hemi;
    amb.intensity = T.amb;
    renderer.toneMappingExposure = T.exposure;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, controls, resize, setStageY, setTankFocus, setTheme, key };
}
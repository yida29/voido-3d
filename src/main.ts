import * as THREE from 'three';
import { createScene } from './scene';
import { loadVoidoIFC } from './building';
import { createControls } from './controls';
import { Collider } from './collision';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const { scene, camera } = createScene();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function init() {
  const ifcUrl = `${import.meta.env.BASE_URL}voido.ifc`;
  const building = await loadVoidoIFC(ifcUrl);
  scene.add(building.root);

  const collider = new Collider(building.walls);
  const controls = createControls(camera, overlay, collider);
  scene.add(controls.object);

  const clock = new THREE.Clock();
  function animate() {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

init().catch((err) => {
  console.error('init failed:', err);
  overlay.innerHTML = `<h1>読み込みエラー</h1><p>${(err as Error).message}</p>`;
});

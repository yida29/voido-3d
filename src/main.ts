import * as THREE from 'three';
import { createScene } from './scene';
import { loadVoidoIFC } from './building';
import { createControls } from './controls';
import { Collider } from './collision';

const canvas = document.getElementById('app') as HTMLCanvasElement;

// hideHud=1 で HUD を隠す (gallery iframe 用)
if (new URLSearchParams(location.search).get('hideHud') === '1') {
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
}

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

  const wbb = new THREE.Box3().setFromObject(building.root);
  console.log('[BUILDING] world bbox',
    `min(${wbb.min.x.toFixed(2)}, ${wbb.min.y.toFixed(2)}, ${wbb.min.z.toFixed(2)})`,
    `max(${wbb.max.x.toFixed(2)}, ${wbb.max.y.toFixed(2)}, ${wbb.max.z.toFixed(2)})`,
    `meshes=${building.meshes.length}`);

  const collider = new Collider(building.walls);
  const controls = createControls(camera, collider, wbb);
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
  const hud = document.getElementById('hud');
  if (hud) hud.innerHTML = `<b style="color:#f66">エラー</b>: ${(err as Error).message}`;
});

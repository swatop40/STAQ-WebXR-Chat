import { Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  loadSceneModel,
  placeObjectModel,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";

export async function startScene(engine) {
  const {
    scene,
    desktopKeys,
    ground,
    playerHeight,
    playerSpawn,
  } = createBaseScene(engine);

  await loadSceneModel(scene, "parking-WIP.glb");

  await placeObjectModel(
    scene,
    "chair.glb",
    new Vector3(3.20, 0.68, 8.75),
    Vector3.Zero(),
    new Vector3(0.5, 0.5, 0.5)
  );

  await placeObjectModel(
    scene,
    "avatar-body.glb",
    new Vector3(-9.47, 0, 9.47),
    new Vector3(0, Math.PI / 1.5, 0),
    new Vector3(0.8, 0.8, 0.8)
  );

  await setupSharedWebXR(scene, {
    ground,
    mirror: createMirror(scene),
    desktopKeys,
    playerHeight,
    playerSpawn,
  });

  await scene.whenReadyAsync();
  return scene;
}

export async function loadScene(engine) {
  return startScene(engine);
}

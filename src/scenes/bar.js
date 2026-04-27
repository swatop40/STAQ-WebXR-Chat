import { Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  loadSceneModel,
  placeSceneObjects,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";

const BAR_SCENE_OBJECTS = [
  {
    fileName: "chair.glb",
    position: new Vector3(3.2, 0.68, 8.75),
    rotation: Vector3.Zero(),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "avatar-body.glb",
    position: new Vector3(-9.47, 0, 9.47),
    rotation: new Vector3(0, Math.PI / 1.5, 0),
    scaling: new Vector3(0.8, 0.8, 0.8),
  },
];

export async function startScene(engine) {
  const {
    scene,
    desktopKeys,
    ground,
    playerHeight,
    playerSpawn,
  } = createBaseScene(engine);

  const mirror = createMirror(scene);
  await loadSceneModel(scene, "bar.glb");
  await placeSceneObjects(scene, BAR_SCENE_OBJECTS);

  await setupSharedWebXR(scene, {
    ground,
    mirror,
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

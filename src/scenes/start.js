import { PBRMaterial, Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  createStaticWall,
  loadSceneModel,
  placeObjectModel,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";

async function addTestRoomProps(scene) {
  await placeObjectModel(
    scene,
    "table.glb",
    new Vector3(1.23, 1.59, 8.87),
    new Vector3(0, Math.PI / 2, 0),
    new Vector3(1, 1, 1)
  );

  await placeObjectModel(
    scene,
    "chair.glb",
    new Vector3(3.20, 0.68, 8.75),
    Vector3.Zero(),
    new Vector3(0.5, 0.5, 0.5)
  );

  await placeObjectModel(
    scene,
    "chair.glb",
    new Vector3(-0.61, 0.68, 8.75),
    new Vector3(0, Math.PI, 0),
    new Vector3(0.5, 0.5, 0.5)
  );

  const dartBoard = await placeObjectModel(
    scene,
    "dart-target.glb",
    new Vector3(-7.16, 2.11, 10.98),
    new Vector3(0, -Math.PI / 2, 0),
    new Vector3(0.7, 0.7, 0.7)
  );
  forceOpaqueDartBoardTexture(dartBoard);
  markDartBoardTarget(dartBoard);

  const blueDart = await placeObjectModel(
    scene,
    "dart-blue.glb",
    new Vector3(0.80, 1.76, 9.24),
    new Vector3(0, Math.PI / 6, 0),
    new Vector3(0.19, 0.19, 0.19)
  );
  markDartInteractable(blueDart);

  const redDart = await placeObjectModel(
    scene,
    "dart-red.glb",
    new Vector3(1.84, 1.76, 9.24),
    new Vector3(0, 0, -Math.PI / 6),
    new Vector3(0.19, 0.19, 0.19)
  );
  markDartInteractable(redDart);

  await placeObjectModel(
    scene,
    "avatar-body.glb",
    new Vector3(-9.47, 0, 9.47),
    new Vector3(0, Math.PI / 1.5, 0),
    new Vector3(0.8, 0.8, 0.8)
  );
}

function markDartInteractable(result) {
  const root = result.meshes[0];
  if (!root) return;

  root.metadata = {
    ...(root.metadata || {}),
    isThrowableDart: true,
    dartRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isThrowableDart: true,
      dartRoot: root,
    };
  }
}

function markDartBoardTarget(result) {
  const root = result.meshes[0];
  if (!root) return;

  root.metadata = {
    ...(root.metadata || {}),
    isDartBoardTarget: true,
    dartBoardRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isDartBoardTarget: true,
      dartBoardRoot: root,
    };
  }
}

function forceOpaqueDartBoardTexture(result) {
  const materials = new Set(
    result.meshes
      .map((mesh) => mesh.material)
      .filter(Boolean)
  );

  for (const material of materials) {
    material.alpha = 1;
    material.backFaceCulling = false;

    if ("transparencyMode" in material) {
      material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    }

    if ("useAlphaFromAlbedoTexture" in material) {
      material.useAlphaFromAlbedoTexture = false;
    }

    for (const texture of [material.albedoTexture, material.diffuseTexture]) {
      if (!texture) continue;
      texture.hasAlpha = false;
      texture.getAlphaFromRGB = false;
    }
  }
}

function addTestRoomCollision(scene) {
  const wallHeight = 2;
  const wallLength = 6;
  const wallThickness = 0.2;

  createStaticWall(
    scene,
    "backWall",
    { width: wallLength, height: wallHeight, depth: wallThickness },
    new Vector3(0, wallHeight / 2, wallLength / 2)
  );

  createStaticWall(
    scene,
    "leftWall",
    { width: wallThickness, height: wallHeight, depth: wallLength },
    new Vector3(-wallLength / 2, wallHeight / 2, 0)
  );

  createStaticWall(
    scene,
    "rightWall",
    { width: wallThickness, height: wallHeight, depth: wallLength },
    new Vector3(wallLength / 2, wallHeight / 2, 0)
  );
}

export async function startScene(engine) {
  const {
    scene,
    desktopKeys,
    ground,
    playerHeight,
    playerSpawn,
  } = createBaseScene(engine);

  const mirror = createMirror(scene);

  await loadSceneModel(scene, "test-room.glb");
  await addTestRoomProps(scene);
  addTestRoomCollision(scene);

  await setupSharedWebXR(scene, {
    ground,
    mirror,
    desktopKeys,
    playerHeight,
    playerSpawn,
    dartGamePanelTransform: {
      position: new Vector3(-5.49, 2.11, 10.99),
      rotation: Vector3.Zero(),
    },
  });

  await scene.whenReadyAsync();
  return scene;
}

export async function loadScene(engine) {
  return startScene(engine);
}

import { PBRMaterial, Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  createStaticWall,
  loadSceneModel,
  placeObjectModel,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";

const TABLE_POSITION = new Vector3(1.23, 1.59, 8.87);
const TABLE_ROTATION = new Vector3(0, Math.PI / 2, 0);
const TABLE_TOP_Y = 1.76;
const TEST_ROOM_OBJECTS = [
  {
    fileName: "table.glb",
    position: TABLE_POSITION,
    rotation: TABLE_ROTATION,
    scaling: new Vector3(1, 1, 1),
  },
  {
    fileName: "chair.glb",
    position: new Vector3(3.2, 0.68, 8.75),
    rotation: Vector3.Zero(),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "chair.glb",
    position: new Vector3(-0.61, 0.68, 8.75),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "dart-target.glb",
    position: new Vector3(-7.16, 2.11, 10.98),
    rotation: new Vector3(0, -Math.PI / 2, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      forceOpaqueDartBoardTexture(result);
      markDartBoardTarget(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(0.8, 1.76, 9.24),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      markDartInteractable(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(1.84, 1.76, 9.24),
    rotation: new Vector3(0, 0, -Math.PI / 6),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      markDartInteractable(result);
    },
  },
  {
    fileName: "mug.glb",
    position: new Vector3(0.48, TABLE_TOP_Y, 8.63),
    rotation: new Vector3(0, -Math.PI / 5, 0),
    scaling: new Vector3(0.26, 0.26, 0.26),
    interactable: true,
  },
  {
    fileName: "decanter.glb",
    position: new Vector3(1.25, TABLE_TOP_Y, 8.57),
    rotation: new Vector3(0, Math.PI / 9, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: true,
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(0.86, TABLE_TOP_Y, 8.92),
    rotation: new Vector3(0, -Math.PI / 10, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(1.58, TABLE_TOP_Y, 8.95),
    rotation: new Vector3(0, Math.PI / 8, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
  },
  {
    fileName: "microphone.glb",
    position: new Vector3(2.05, TABLE_TOP_Y + 0.03, 9.18),
    rotation: new Vector3(0, Math.PI / 2.7, Math.PI / 2),
    scaling: new Vector3(0.11, 0.11, 0.11),
    interactable: true,
  },
  {
    fileName: "Bar_Stool.glb",
    position: new Vector3(1.24, 0, 7),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: true,
  },
  {
    fileName: "mic-stand.glb",
    position: new Vector3(4.41, 0, 9.75),
    rotation: new Vector3(0, -Math.PI / 2.7, 0),
    scaling: new Vector3(0.13, 0.13, 0.13),
    interactable: true,
  },
  {
    fileName: "microphone-and-stand.glb",
    position: new Vector3(-1.97, 0, 8.88),
    rotation: new Vector3(0, Math.PI / 2.8, 0),
    scaling: new Vector3(0.12, 0.12, 0.12),
    interactable: true,
  },
  {
    fileName: "tv.glb",
    position: new Vector3(0.95, 4.66, 10.93),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.95, 0.95, 0.95),
    interactable: true,
  },
  {
    fileName: "andy-picture.glb",
    position: new Vector3(-1.25, 2.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
  },
  {
    fileName: "sam-picture.glb",
    position: new Vector3(3.15, 2.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
  },
  {
    fileName: "avatar-body.glb",
    position: new Vector3(-9.47, 0, 9.47),
    rotation: new Vector3(0, Math.PI / 1.5, 0),
    scaling: new Vector3(0.8, 0.8, 0.8),
  },
];

async function addTestRoomProps(scene) {
  for (const object of TEST_ROOM_OBJECTS) {
    const result = await placeObjectModel(
      scene,
      object.fileName,
      object.position,
      object.rotation,
      object.scaling
    );

    if (object.interactable) {
      markSceneInteractable(result, object.fileName);
    }

    object.afterPlace?.(result);
  }
}

function markSceneInteractable(result, itemName) {
  const root = result.meshes[0];
  if (!root) return;

  root.metadata = {
    ...(root.metadata || {}),
    isSceneInteractable: true,
    interactableName: itemName,
    interactableRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isSceneInteractable: true,
      interactableName: itemName,
      interactableRoot: root,
    };
  }
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

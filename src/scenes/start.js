import { PBRMaterial, Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  createStaticWall,
  loadSceneModel,
  markSceneInteractable,
  placeObjectModel,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";
import { createSceneTVObject } from "./tvSetup.js";
import { createAvatarMirrorPanel } from "./avatarMirrorPanel.js";

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
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.02, 0.02),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(-0.621, 1.776, -1.037),
      desktopGrabRotation: new Vector3(0, -0.24905477959908046, 0),
      
    },
  },
  {
    fileName: "decanter.glb",
    position: new Vector3(1.25, TABLE_TOP_Y, 8.57),
    rotation: new Vector3(0, Math.PI / 9, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.03, 0.03),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(-0.618, 0.655, -0.228),
      desktopGrabRotation: new Vector3(0, 0.7889509999049364, 0),
    },
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(0.86, TABLE_TOP_Y, 8.92),
    rotation: new Vector3(0, -Math.PI / 10, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, 3.84, 0.02),
      xrGrabRotation: new Vector3(0, 0, 0),
      desktopGrabOffset: new Vector3(1.648, 2.642, 3.543),
      desktopGrabRotation: new Vector3(0, 3.0182175423421165, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(1.58, TABLE_TOP_Y, 8.95),
    rotation: new Vector3(0, Math.PI / 8, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.02, 0.02),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "microphone.glb",
    position: new Vector3(2.05, TABLE_TOP_Y + 0.03, 9.18),
    rotation: new Vector3(0, Math.PI / 2.7, Math.PI / 2),
    scaling: new Vector3(0.11, 0.11, 0.11),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0.04, 0, 0),
      xrGrabRotation: new Vector3(0, 0, -Math.PI / 2),
      desktopGrabOffset: new Vector3(-1.761, -1.068, -1.018),
      desktopGrabRotation: new Vector3(0, 0, -0.05458734417787241),
    },
  },
  {
    fileName: "Bar_Stool.glb",
    position: new Vector3(1.24, 0, 7),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: false,
  },
  {
    fileName: "mic-stand.glb",
    position: new Vector3(4.41, 0, 9.75),
    rotation: new Vector3(0, -Math.PI / 2.7, 0),
    scaling: new Vector3(0.13, 0.13, 0.13),
    interactable: false,
  },
  {
    fileName: "microphone-and-stand.glb",
    position: new Vector3(-1.97, 0, 8.88),
    rotation: new Vector3(0, Math.PI / 2.8, 0),
    scaling: new Vector3(0.12, 0.12, 0.12),
    interactable: false,
  },
  createSceneTVObject({
    position: new Vector3(0.95, 5.66, 10.93),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.95, 0.95, 0.95),
  }),
  {
    fileName: "andy-picture.glb",
    position: new Vector3(-1.25, 3.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("andy-picture.glb", result);
    },
  },
  {
    fileName: "Quincy-Picture.glb",
    position: new Vector3(0.22, 3.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("Quincy-Picture.glb", result);
    },
  },
  {
    fileName: "Tyler-Picture.glb",
    position: new Vector3(1.68, 3.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("Tyler-Picture.glb", result);
    },
  },
  {
    fileName: "sam-picture.glb",
    position: new Vector3(3.15, 3.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("sam-picture.glb", result);
    },
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
      markSceneInteractable(result, object.fileName, object.interaction);
    }

    object.afterPlace?.(result);
  }
}

function markDartInteractable(result) {
  const root = result.meshes[0];
  if (!root) return;

  const baseLocalScaling = root.scaling.clone();
  root.metadata = {
    ...(root.metadata || {}),
    isThrowableDart: true,
    dartRoot: root,
    baseLocalScaling,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isThrowableDart: true,
      dartRoot: root,
      baseLocalScaling: baseLocalScaling.clone(),
    };
  }
}

function registerPictureSwapResult(key, result) {
  void key;
  configurePictureSwap(result);
}

function configurePictureSwap(primaryResult) {
  const primaryRoot = primaryResult.meshes[0];
  if (primaryRoot?.metadata?.pictureSwapConfigured) return;
  const primaryPictureMesh = findPictureSurfaceMesh(primaryResult);
  if (!primaryRoot || !primaryPictureMesh) return;

  primaryRoot.metadata = {
    ...(primaryRoot.metadata || {}),
    activateOnSelect: true,
    pictureSwapConfigured: true,
    onActivate: () => {
      primaryPictureMesh.setEnabled(!primaryPictureMesh.isEnabled());
    },
  };

  for (const mesh of primaryResult.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      activateOnSelect: true,
      onActivate: primaryRoot.metadata.onActivate,
      interactableRoot: primaryRoot,
    };
  }
}

function findPictureSurfaceMesh(result) {
  return result.meshes.find((mesh) => mesh.material?.name?.toLowerCase?.().includes("-prof")) || null;
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

  createAvatarMirrorPanel(scene, mirror, {
    position: new Vector3(2.26, 0.7, -1.21),
    rotation: new Vector3(0, 0.5235987755982988, 0),
  });

  await scene.whenReadyAsync();
  return scene;
}

export async function loadScene(engine) {
  return startScene(engine);
}

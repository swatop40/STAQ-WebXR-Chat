import { Vector3 } from "babylonjs";
import {
  createBaseScene,
  createMirror,
  loadSceneModel,
  placeSceneObjects,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";
import { createSceneTVObject } from "./tvSetup.js";
import { createAvatarMirrorPanel } from "./avatarMirrorPanel.js";
import {
  configureDartBoardTarget,
  configurePictureReveal,
  configureThrowableDart,
} from "./sharedSceneFeatures.js";

const TABLE_POSITION = new Vector3(1.23, 1.59, 8.87);
const TABLE_ROTATION = new Vector3(0, Math.PI / 2, 0);
const TABLE_TOP_Y = 1.76;
const DART_GAME_A_ID = "test-room-darts-left";
const DART_GAME_B_ID = "test-room-darts-right";
const DART_GAME_A_PANEL_TRANSFORM = {
  position: new Vector3(-5.49, 2.11, 10.99),
  rotation: Vector3.Zero(),
};
const DART_GAME_B_PANEL_TRANSFORM = {
  position: new Vector3(5.32, 2.11, -10.99),
  rotation: new Vector3(0, 3.141592653589793, 0),
};
const TEST_ROOM_OBJECTS = [
  {
    fileName: "table.glb",
    position: TABLE_POSITION,
    rotation: TABLE_ROTATION,
    scaling: new Vector3(1, 1, 1),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "chair.glb",
    position: new Vector3(3.2, 0.68, 8.75),
    rotation: Vector3.Zero(),
    scaling: new Vector3(0.5, 0.5, 0.5),
    staticCollider: {
      padding: new Vector3(0.1, 0.08, 0.1),
    },
  },
  {
    fileName: "chair.glb",
    position: new Vector3(-0.61, 0.68, 8.75),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
    staticCollider: {
      padding: new Vector3(0.1, 0.08, 0.1),
    },
  },
  {
    fileName: "dart-target.glb",
    position: new Vector3(-7.16, 2.11, 10.98),
    rotation: new Vector3(0, -Math.PI / 2, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      configureDartBoardTarget(result, {
        forceOpaqueTexture: true,
        gameId: DART_GAME_A_ID,
        panelTransform: DART_GAME_A_PANEL_TRANSFORM,
      });
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(0.8, 1.76, 9.24),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
        gameId: DART_GAME_A_ID,
      });
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(1.84, 1.76, 9.24),
    rotation: new Vector3(0, 0, -Math.PI / 6),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
        gameId: DART_GAME_A_ID,
      });
    },
  },
  {
    fileName: "dart-target.glb",
    position: new Vector3(6.949999809265137, 2.109999895095825, -10.975337982177734),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      configureDartBoardTarget(result, {
        forceOpaqueTexture: true,
        gameId: DART_GAME_B_ID,
        panelTransform: DART_GAME_B_PANEL_TRANSFORM,
      });
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(2.62, 1.76, 9.22),
    rotation: new Vector3(0, Math.PI / 5, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
        gameId: DART_GAME_B_ID,
      });
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(3.28, 1.76, 9.22),
    rotation: new Vector3(0, 0, -Math.PI / 7),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
        gameId: DART_GAME_B_ID,
      });
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
      xrGrabOffset: new Vector3(.61, .461, -0.608),
      xrGrabRotation: new Vector3(0, -0.24905477959908046, 0),
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
      xrGrabOffset: new Vector3(0, 2.5, -0.85),
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
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
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
      xrGrabOffset: new Vector3(0.02, -3.31, -.54),
      xrGrabRotation: new Vector3(0, 0, 0),
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
    staticCollider: {
      padding: new Vector3(0.12, 0.08, 0.12),
    },
  },
  {
    fileName: "mic-stand.glb",
    position: new Vector3(4.41, 0, 9.75),
    rotation: new Vector3(0, -Math.PI / 2.7, 0),
    scaling: new Vector3(0.13, 0.13, 0.13),
    interactable: false,
    staticCollider: {
      padding: new Vector3(0.08, 0.14, 0.08),
    },
  },
  {
    fileName: "microphone-and-stand.glb",
    position: new Vector3(-1.97, 0, 8.88),
    rotation: new Vector3(0, Math.PI / 2.8, 0),
    scaling: new Vector3(0.12, 0.12, 0.12),
    interactable: false,
    staticCollider: {
      padding: new Vector3(0.08, 0.14, 0.08),
    },
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
      configurePictureReveal(result);
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
      configurePictureReveal(result);
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
      configurePictureReveal(result);
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
      configurePictureReveal(result);
    },
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

  const roomResult = await loadSceneModel(scene, "test-room.glb");
  for (const mesh of roomResult.meshes) {
    mesh.checkCollisions = false;
  }
  await placeSceneObjects(scene, TEST_ROOM_OBJECTS);

  await setupSharedWebXR(scene, {
    ground,
    mirror,
    desktopKeys,
    playerHeight,
    playerSpawn,
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

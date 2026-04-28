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

const DART_GAME_A_ID = "parking-darts";
const DART_GAME_A_PANEL_TRANSFORM = {
  position: new Vector3(-20, 3, -14),
  rotation: new Vector3(0, 3.141592653589793, 0),
};
const PARKING_SCENE_OBJECTS = [
  {
    fileName: "chair.glb",
    position: new Vector3(-13, 1.7, -13),
    rotation: new Vector3(0, 1.5707963267948966, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "chair.glb",
    position: new Vector3(3, 1.7, -13),
    rotation: new Vector3(0, 0.8290313946973066, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "mug.glb",
    position: new Vector3(-2, 0.568, 4),
    rotation: new Vector3(6.035348553396391, 0, 4.733332931408621),
    scaling: new Vector3(0.26, 0.26, 0.26),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, -0.24905477959908046, 0),
      xrGrabOffset: new Vector3(.61, .461, -0.608),
      desktopGrabOffset: new Vector3(-0.621, 1.776, -1.037),
      desktopGrabRotation: new Vector3(0, -0.24905477959908046, 0),
      
    },
  },
  {
    fileName: "decanter.glb",
    position: new Vector3(10, 0.385, -8.57),
    rotation: new Vector3(0, 0.6510078109938848, 1.5707963267948966),
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
    fileName: "decanter.glb",
    position: new Vector3(-3, 0.62, 27),
    rotation: new Vector3(0, 2.3666664657043106, 0),
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
    fileName: "decanter.glb",
    position: new Vector3(40, 0.536, 30),
    rotation: new Vector3(0, 1.1239920382843482, 4.71238898038469),
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
    fileName: "decanter.glb",
    position: new Vector3(-13, 2, -13),
    rotation: new Vector3(0, 1.064650843716541, 0),
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
    fileName: "decanter.glb",
    position: new Vector3(13, 1.164, -14.279),
    rotation: new Vector3(0, 1.5707963267948966, 5.797983775125163),
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
    position: new Vector3(13.2, 0.88, -10.126),
    rotation: new Vector3(0, 4.673991736840814, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, 0, 0),
      xrGrabOffset: new Vector3(0, 2.5, -0.85),
      desktopGrabOffset: new Vector3(1.648, 2.642, 3.543),
      desktopGrabRotation: new Vector3(0, 3.0182175423421165, 0),
    },
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(-7, 0.469, -7),
    rotation: new Vector3(0, 5.030038904247657, 0.8290313946973066),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, 0, 0),
      xrGrabOffset: new Vector3(0, 2.5, -0.85),
      desktopGrabOffset: new Vector3(1.648, 2.642, 3.543),
      desktopGrabRotation: new Vector3(0, 3.0182175423421165, 0),
    },
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(0, 1.093, 35),
    rotation: new Vector3(4.5553093477052, 0, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, 0, 0),
      xrGrabOffset: new Vector3(0, 2.5, -0.85),
      desktopGrabOffset: new Vector3(1.648, 2.642, 3.543),
      desktopGrabRotation: new Vector3(0, 3.0182175423421165, 0),
    },
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(45, 0.573, -1),
    rotation: new Vector3(1.715658654710426, 5.503023131538121, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, 0, 0),
      xrGrabOffset: new Vector3(0, 2.5, -0.85),
      desktopGrabOffset: new Vector3(1.648, 2.642, 3.543),
      desktopGrabRotation: new Vector3(0, 3.0182175423421165, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(13, 0.577, 0.75),
    rotation: new Vector3(1.5707963267948966, 0, 0.5916666164260777),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(-10.8, 1.073, -9),
    rotation: new Vector3(0, 0.39269908169872414, 1.5707963267948966),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(-30, 0.575, 15),
    rotation: new Vector3(1.5707963267948966, 0.39269908169872414, 2.3073252711365035),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(-26, 0.888, -13),
    rotation: new Vector3(0, Math.PI / 8, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(-25, 0.888, -12.4),
    rotation: new Vector3(0, Math.PI / 8, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      xrGrabOffset: new Vector3(-.16, 4.59, 0.02),
      desktopGrabOffset: new Vector3(-1.740, 3.133, 1.101),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "microphone.glb",
    position: new Vector3(3.076, 1.864, -12.836),
    rotation: new Vector3(0, 2.3073252711365035, 1.4206980111233845),
    scaling: new Vector3(0.11, 0.11, 0.11),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabRotation: new Vector3(0, 0, 0),
      xrGrabOffset: new Vector3(0.02, -3.31, -.54),
      desktopGrabOffset: new Vector3(-1.761, -1.068, -1.018),
      desktopGrabRotation: new Vector3(0, 0, -0.05458734417787241),
    },
  },
  createSceneTVObject({
    position: new Vector3(2, 4, -14.75),
    rotation: new Vector3(0, 4.71238898038469, 0),
    scaling: new Vector3(0.95, 0.95, 0.95),
  }),
  {
    fileName: "dart-target.glb",
    position: new Vector3(-18, 3, -14.65),
    rotation: new Vector3(0, 1.5707963267948966, 0),
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
    position: new Vector3(-20, 1.73, -8),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
                    gameId: DART_GAME_A_ID,
                  });
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(-20.2, 1.73, -7.8),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
                    gameId: DART_GAME_A_ID,
                  });
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(-20.4, 1.73, -7.6),
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
    position: new Vector3(-21, 1.73, -8),
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
    position: new Vector3(-21.2, 1.73, -7.8),
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
    position: new Vector3(-21.4, 1.73, -7.6),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result, {
                    gameId: DART_GAME_A_ID,
                  });
    },
  },
  {
    fileName: "table.glb",
    position: new Vector3(-21, 1.572, -8),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
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

  const START_MIRROR_TRANSFORM = {
  position: new Vector3(-3, 2, -14.651),
  rotation: new Vector3(0, 3.141592653589793, 0),
  scaling: new Vector3(1, 1, 1),
  width: 4.5,
  height: 7.2,
};
  const mirror = createMirror(scene, START_MIRROR_TRANSFORM);
  createAvatarMirrorPanel(scene, mirror, {
    position: new Vector3(2.26, 0.7, -1.21),
    rotation: new Vector3(0, 0.5235987755982988, 0),
  });

  await loadSceneModel(scene, "parking-WIP.glb");
  await placeSceneObjects(scene, PARKING_SCENE_OBJECTS);

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

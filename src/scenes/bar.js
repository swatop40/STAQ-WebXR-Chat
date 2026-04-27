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

const BAR_SCENE_OBJECTS = [
  {
    fileName: "avatar-body.glb",
    position: new Vector3(-9.47, 0, 9.47),
    rotation: new Vector3(0, Math.PI / 1.5, 0),
    scaling: new Vector3(0.8, 0.8, 0.8),
  },
  {
    fileName: "table.glb",
    position: new Vector3(3.381, 2.045, -1.893),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "table.glb",
    position: new Vector3(3.381, 2.045, -7.69),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "table.glb",
    position: new Vector3(6.005, 2.045, 3.283),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "table.glb",
    position: new Vector3(5.774, 2.045, 9.038),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "table.glb",
    position: new Vector3(5.774, 2.045, 19.007),
    rotation: new Vector3(0,0,0),
    scaling: new Vector3(0.75, 0.75, 0.75),
    staticCollider: {
      padding: new Vector3(0.18, 0.08, 0.18),
      centerOffset: new Vector3(0, -0.02, 0),
    },
  },
  {
    fileName: "mug.glb",
    position: new Vector3(10, 2.214, 0),
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
    fileName: "mug.glb",
    position: new Vector3(9.75, 2.214, -3),
    rotation: new Vector3(0, 1.8343410438460404, 0),
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
    fileName: "mug.glb",
    position: new Vector3(10, 2.214, -4.5),
    rotation: new Vector3(0, 3.9060468659633094, 0),
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
    fileName: "mug.glb",
    position: new Vector3(10, 2.214, -6),
    rotation: new Vector3(0, 1.1239920382843482, 0),
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
    position: new Vector3(13, 2.729, -8.57),
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
    fileName: "decanter.glb",
    position: new Vector3(13, 2.729, -6.2),
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
    position: new Vector3(13, 2.729, -5),
    rotation: new Vector3(0, 0, 0),
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
    position: new Vector3(13, 2.729, -3),
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
    position: new Vector3(13, 2.729, -0.25),
    rotation: new Vector3(0, 5.857324969692971, 0),
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
    position: new Vector3(13.2, 2.486, -9.126),
    rotation: new Vector3(0, 4.673991736840814, 0),
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
    fileName: "booze_bottle1.glb",
    position: new Vector3(13, 2.486, -5.75),
    rotation: new Vector3(0, 3.077015471266003, 0),
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
    fileName: "booze_bottle1.glb",
    position: new Vector3(12.8, 2.486, -2),
    rotation: new Vector3(0, 3.490658503988659, 0),
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
    fileName: "booze_bottle1.glb",
    position: new Vector3(13.2, 2.486, -1),
    rotation: new Vector3(0, 4.673991736840814, 0),
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
    position: new Vector3(13, 2.501, 0.75),
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
    fileName: "vodka_bottle1.glb",
    position: new Vector3(12.8, 2.501, -2.5),
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
    fileName: "vodka_bottle1.glb",
    position: new Vector3(13.2, 2.501, -3.8),
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
    fileName: "vodka_bottle1.glb",
    position: new Vector3(13, 2.501, -7.3),
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
    fileName: "vodka_bottle1.glb",
    position: new Vector3(13, 2.501, -9.6),
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
    position: new Vector3(3, 2.244, -7),
    rotation: new Vector3(0, 1.656317460142619, 1.4206980111233845),
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
  createSceneTVObject({
    position: new Vector3(2, 4.66, -6.661),
    rotation: new Vector3(0, 3.141592653589793, 0),
    scaling: new Vector3(0.95, 0.95, 0.95),
  }),
  {
    fileName: "sam-picture.glb",
    position: new Vector3(-2, 3.17, 21.14),
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
    position: new Vector3(0, 3.17, 21.14),
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
    fileName: "andy-picture.glb",
    position: new Vector3(2, 3.17, 21.14),
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
    position: new Vector3(4, 3.17, 21.14),
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
    fileName: "dart-target.glb",
    position: new Vector3(-5.33, 3, 10.98),
    rotation: new Vector3(0, 3.141592653589793, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      configureDartBoardTarget(result, { forceOpaqueTexture: true });
    },
  },
  {
    fileName: "dart-target.glb",
    position: new Vector3(-5.33, 3, 17.98),
    rotation: new Vector3(0, 3.141592653589793, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      configureDartBoardTarget(result, { forceOpaqueTexture: true });
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5, 2.18, 19),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5.2, 2.18, 19.2),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5.4, 2.18, 19.4),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5, 2.18, 18.2),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5.2, 2.18, 18.4),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5.4, 2.18, 18.6),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5, 2.18, 9),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5.2, 2.18, 9.2),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(5.4, 2.18, 9.4),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5, 2.18, 8.2),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5.2, 2.18, 8.4),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(5.4, 2.18, 8.6),
    rotation: new Vector3(0, 0, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      configureThrowableDart(result);
    },
  },
  {
    fileName: "chair.glb",
    position: new Vector3(3, 1.5, 0),
    rotation: new Vector3(0, 4.5553093477052, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
    staticCollider: {
      padding: new Vector3(0.1, 0.08, 0.1),
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

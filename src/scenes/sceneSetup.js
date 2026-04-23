import {
  CannonJSPlugin,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  PhysicsImpostor,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from "babylonjs";
import * as BABYLON from "babylonjs";
import "babylonjs-loaders";
import * as CANNON from "cannon";

export const DEFAULT_PLAYER_SPAWN = new Vector3(0.25, 0.9, -8);
export const DEFAULT_PLAYER_HEIGHT = 1.8;
export const DEFAULT_PLAYER_WIDTH = 0.6;

function getImportedRootBaseName(fileName) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function assignImportedRootName(scene, root, fileName) {
  if (!root) return;

  const baseName = getImportedRootBaseName(fileName);
  let nextName = baseName;
  let suffix = 2;

  while (scene.getNodeByName(nextName) && scene.getNodeByName(nextName) !== root) {
    nextName = `${baseName}_${suffix}`;
    suffix += 1;
  }

  root.name = nextName;
  root.id = nextName;
  root.metadata = {
    ...(root.metadata || {}),
    sourceFileName: fileName,
  };
}

export async function loadSceneModel(scene, fileName) {
  const result = await SceneLoader.ImportMeshAsync(null, "/scene-models/", fileName, scene);
  assignImportedRootName(scene, result.meshes[0], fileName);
  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isSceneCollider: true,
    };
  }
  console.log("Imported meshes:", result.meshes.map((m) => m.name));
  return result;
}

export async function placeObjectModel(
  scene,
  fileName,
  position,
  rotation = null,
  scaling = null
) {
  const result = await SceneLoader.ImportMeshAsync(
    null,
    "/object-models/",
    fileName,
    scene
  );

  const root = result.meshes[0];
  assignImportedRootName(scene, root, fileName);

  if (position) {
    root.position.copyFrom(position);
  }

  if (rotation) {
    root.rotation = rotation;
  }

  if (scaling) {
    root.scaling = scaling;
  }

  return result;
}

export function markSceneInteractable(result, itemName, interaction = {}) {
  const root = result.meshes[0];
  if (!root) return;

  const pickupEnabled = !!interaction.pickup;
  const activateOnSelect = !!interaction.activateOnSelect;
  const onActivate = interaction.onActivate || null;
  const xrGrabOffset = interaction.xrGrabOffset?.clone?.()
    || interaction.grabOffset?.clone?.()
    || Vector3.Zero();
  const xrGrabRotation = interaction.xrGrabRotation?.clone?.()
    || interaction.grabRotation?.clone?.()
    || Vector3.Zero();
  const desktopGrabOffset = interaction.desktopGrabOffset?.clone?.()
    || xrGrabOffset.clone();
  const desktopGrabRotation = interaction.desktopGrabRotation?.clone?.()
    || xrGrabRotation.clone();
  const xrGrabPointNode = pickupEnabled
    ? createGrabPointNode(root, itemName, "xr", xrGrabOffset, xrGrabRotation)
    : null;
  const desktopGrabPointNode = pickupEnabled
    ? createGrabPointNode(root, itemName, "desktop", desktopGrabOffset, desktopGrabRotation)
    : null;
  const baseLocalScaling = root.scaling.clone();

  root.metadata = {
    ...(root.metadata || {}),
    isSceneInteractable: true,
    interactionKind: pickupEnabled ? "pickup" : "inspect",
    pickupEnabled,
    activateOnSelect,
    onActivate,
    baseLocalScaling,
    xrGrabPointNode,
    desktopGrabPointNode,
    xrGrabPointName: xrGrabPointNode?.name || null,
    desktopGrabPointName: desktopGrabPointNode?.name || null,
    interactableName: itemName,
    interactableRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isSceneInteractable: true,
      interactionKind: pickupEnabled ? "pickup" : "inspect",
      pickupEnabled,
      activateOnSelect,
      onActivate,
      baseLocalScaling: baseLocalScaling.clone(),
      xrGrabPointNode,
      desktopGrabPointNode,
      xrGrabPointName: xrGrabPointNode?.name || null,
      desktopGrabPointName: desktopGrabPointNode?.name || null,
      interactableName: itemName,
      interactableRoot: root,
    };
  }
}

export function createGrabPointNode(root, itemName, mode, grabOffset, grabRotation) {
  const grabPoint = new TransformNode(`${itemName}_${mode}GrabPoint`, root.getScene());
  grabPoint.parent = root;
  grabPoint.position.copyFrom(grabOffset);
  grabPoint.rotation.copyFrom(grabRotation);
  grabPoint.metadata = {
    ...(grabPoint.metadata || {}),
    isGrabPoint: true,
    interactableRoot: root,
  };
  return grabPoint;
}

export function createStaticWall(scene, name, options, position) {
  const wall = MeshBuilder.CreateBox(name, options, scene);
  wall.position.copyFrom(position);
  wall.metadata = {
    ...(wall.metadata || {}),
    isSceneCollider: true,
  };
  wall.physicsImpostor = new PhysicsImpostor(
    wall,
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );
  return wall;
}

export function createMirror(scene, position = new Vector3(7.29, 1, 11)) {
  const mirror = MeshBuilder.CreatePlane("mirror", { width: 4.5, height: 7.2 }, scene);
  mirror.position.copyFrom(position);
  return mirror;
}

export function createBaseScene(engine, options = {}) {
  const {
    playerSpawn = DEFAULT_PLAYER_SPAWN,
    playerHeight = DEFAULT_PLAYER_HEIGHT,
    playerWidth = DEFAULT_PLAYER_WIDTH,
    groundSize = 20,
  } = options;

  const scene = new Scene(engine);
  const desktopKeys = new Set();

  scene.enablePhysics(
    new Vector3(0, -9.81, 0),
    new CannonJSPlugin(true, 10, CANNON)
  );

  const camera = new FreeCamera("cam", Vector3.Zero(), scene);
  camera.rotation = Vector3.Zero();
  camera.inputs.clear();
  const mouseInput = new BABYLON.FreeCameraMouseInput();
  mouseInput.buttons = [2];
  camera.inputs.add(mouseInput);
  scene.desktopMouseInput = mouseInput;

  const canvas = scene.getEngine().getRenderingCanvas();
  canvas?.addEventListener("contextmenu", (event) => event.preventDefault());
  camera.attachControl(canvas, true);
  camera.inertia = 0;

  new HemisphericLight("light", new Vector3(0, 2, 0), scene);

  const testBox = MeshBuilder.CreateBox("box", { size: 0.5 }, scene);
  testBox.position = new Vector3(0, 1, 0);
  testBox.physicsImpostor = new PhysicsImpostor(
    testBox,
    PhysicsImpostor.BoxImpostor,
    { mass: 1, restitution: 0.2, friction: 0.5 },
    scene
  );

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: groundSize, height: groundSize },
    scene
  );
  ground.position.y = 0;
  ground.metadata = {
    ...(ground.metadata || {}),
    isSceneCollider: true,
  };
  ground.physicsImpostor = new PhysicsImpostor(
    ground,
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );

  const playerMesh = MeshBuilder.CreateBox(
    "player",
    {
      width: playerWidth,
      height: playerHeight,
      depth: playerWidth,
    },
    scene
  );

  playerMesh.isVisible = false;
  playerMesh.position.copyFrom(playerSpawn);

  camera.parent = playerMesh;
  camera.position = new Vector3(0, playerHeight * 0.5, 0);

  scene.playerMesh = playerMesh;

  return {
    scene,
    desktopKeys,
    ground,
    playerHeight,
    playerSpawn,
    camera,
    playerMesh,
    testBox,
  };
}

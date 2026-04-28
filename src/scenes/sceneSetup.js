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
    mesh.checkCollisions = true;
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

export async function placeSceneObjects(scene, objects = []) {
  const placedResults = [];

  for (const object of objects) {
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

    if (object.staticCollider) {
      createStaticHierarchyCollider(
        scene,
        result.meshes[0],
        object.staticCollider === true ? {} : object.staticCollider
      );
    }

    object.afterPlace?.(result, { scene, object });
    placedResults.push({ object, result });
  }

  return placedResults;
}

export function createStaticHierarchyCollider(scene, root, options = {}) {
  if (!scene || !root) return null;
  if (root.metadata?.staticCollider) return root.metadata.staticCollider;

  root.computeWorldMatrix?.(true);
  const bounds = root.getHierarchyBoundingVectors?.(true);
  if (!bounds?.min || !bounds?.max) return null;

  const padding = options.padding || new Vector3(0.08, 0.08, 0.08);
  const explicitSize = options.size || null;
  const centerOffset = options.centerOffset || Vector3.Zero();
  const size = explicitSize
    ? explicitSize.clone()
    : bounds.max.subtract(bounds.min).add(padding.scale(2));
  if (size.lengthSquared() < 0.0001) return null;

  const collider = MeshBuilder.CreateBox(
    `${root.name || "object"}_staticCollider`,
    {
      width: Math.max(size.x, 0.05),
      height: Math.max(size.y, 0.05),
      depth: Math.max(size.z, 0.05),
    },
    scene
  );

  collider.position.copyFrom(
    bounds.min.add(bounds.max).scale(0.5).add(centerOffset)
  );
  collider.isVisible = false;
  collider.isPickable = false;
  collider.checkCollisions = true;
  collider.metadata = {
    ...(collider.metadata || {}),
    isSceneCollider: true,
    colliderFor: root,
  };
  collider.physicsImpostor = new PhysicsImpostor(
    collider,
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.05, friction: 0.9 },
    scene
  );

  root.metadata = {
    ...(root.metadata || {}),
    staticCollider: collider,
  };

  return collider;
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
  wall.checkCollisions = true;
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

function copyVector3Like(target, value) {
  if (!value) return;

  if (typeof value.copyFrom === "function") {
    target.copyFrom(value);
    return;
  }

  target.set(
    value.x ?? target.x,
    value.y ?? target.y,
    value.z ?? target.z
  );
}

export function createMirror(
  scene,
  optionsOrPosition = {},
  legacyRotation = null,
  legacyScaling = null
) {
  const usingLegacyTransformArgs = optionsOrPosition instanceof Vector3;
  const options = usingLegacyTransformArgs
    ? {
      position: optionsOrPosition,
      rotation: legacyRotation,
      scaling: legacyScaling,
    }
    : optionsOrPosition;

  const {
    position = new Vector3(7.29, 1, 11),
    rotation = new Vector3(0, 0, 0),
    scaling = new Vector3(1, 1, 1),
    scale = null,
    width = 4.5,
    height = 7.2,
  } = options;

  const mirror = MeshBuilder.CreatePlane("mirror", { width, height }, scene);
  copyVector3Like(mirror.position, position);
  copyVector3Like(mirror.rotation, rotation);
  copyVector3Like(mirror.scaling, scale || scaling);
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
  scene.collisionsEnabled = true;
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
  ground.checkCollisions = true;
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
  playerMesh.ellipsoid = new Vector3(playerWidth * 0.5, playerHeight * 0.5, playerWidth * 0.5);
  playerMesh.ellipsoidOffset = Vector3.Zero();
  playerMesh.checkCollisions = false;

  camera.parent = playerMesh;
  camera.position = new Vector3(0, playerHeight * 0.5, 0);
  camera.checkCollisions = false;

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

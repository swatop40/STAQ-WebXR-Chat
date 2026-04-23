import {
  Scene,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  FreeCamera,
  SceneLoader,
  CannonJSPlugin,
  PhysicsImpostor,
} from "babylonjs";
import * as BABYLON from "babylonjs";
import "babylonjs-loaders";
import * as CANNON from "cannon";
import { setupSharedWebXR } from "./sharedWebXR.js";

async function placeModel(scene, fileName, position, rotation = null, scaling = null) {
  const result = await SceneLoader.ImportMeshAsync(
    null,
    "/object-models/",
    fileName,
    scene
  );

  const root = result.meshes[0];

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

export async function startScene(engine) {
  const scene = new Scene(engine);
  const desktopKeys = new Set();
  const XR_WORLD_SCALE_FACTOR = 1.9;
  let xrMode = "smooth";
  const PLAYER_SPAWN = new Vector3(0.25, 0.9, -8);
  const XR_SPAWN_FLOOR = new Vector3(
    PLAYER_SPAWN.x / XR_WORLD_SCALE_FACTOR,
    0,
    PLAYER_SPAWN.z / XR_WORLD_SCALE_FACTOR
  );

  scene.enablePhysics(
    new Vector3(0, -9.81, 0),
    new CannonJSPlugin(true, 10, CANNON)
  );

  const cam = new FreeCamera("cam", new Vector3(0, 0, 0), scene);
  cam.rotation = new Vector3(0, 0, 0);
  cam.attachControl();
  cam.inputs.clear();
  const canvas = scene.getEngine().getRenderingCanvas();
  cam.inputs.add(new BABYLON.FreeCameraMouseInput());
  cam.attachControl(canvas, true);
  cam.inertia = 0;

  new HemisphericLight("light", new Vector3(0, 2, 0), scene);

  const box = MeshBuilder.CreateBox("box", { size: 0.5 }, scene);
  box.position = new Vector3(0, 1, 0);

  const mirror = MeshBuilder.CreatePlane("mirror", { width: 4.5, height: 7.2 }, scene);
  mirror.position = new Vector3(7.29, 1, 11);

  const ground = MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);
  ground.position.y = -0;

  const room = await SceneLoader.ImportMeshAsync(null, "/scene-models/", "test-room.glb", scene);
  console.log("Imported meshes:", room.meshes.map((m) => m.name));

  await placeModel(
    scene,
    "table.glb",
    new Vector3(1.23, 1.59, 8.87),
    new Vector3(0, Math.PI / 2, 0),
    new Vector3(1, 1, 1)
  );

  await placeModel(
    scene,
    "chair.glb",
    new Vector3(3.20, 0.68, 8.75),
    new Vector3(0, 0, 0),
    new Vector3(0.5, 0.5, 0.5)
  );

  await placeModel(
    scene,
    "chair.glb",
    new Vector3(-0.61, 0.68, 8.75),
    new Vector3(0, Math.PI, 0),
    new Vector3(0.5, 0.5, 0.5)
  );

  await placeModel(
    scene,
    "dart-target.glb",
    new Vector3(-7.16, 2.11, 10.98),
    new Vector3(0, -Math.PI / 2, 0),
    new Vector3(0.7, 0.7, 0.7)
  );

  await placeModel(
    scene,
    "dart-blue.glb",
    new Vector3(0.80, 1.76, 9.24),
    new Vector3(0, Math.PI / 6, 0),
    new Vector3(0.19, 0.19, 0.19)
  );

  await placeModel(
    scene,
    "dart-red.glb",
    new Vector3(1.84, 1.76, 9.24),
    new Vector3(0, 0, -Math.PI / 6),
    new Vector3(0.19, 0.19, 0.19)
  );

  await placeModel(
    scene,
    "avatar-body.glb",
    new Vector3(-9.47, 0.0, 9.47),
    new Vector3(0, Math.PI / 1.5, 0),
    new Vector3(0.8, 0.8, 0.8)
  );

  box.physicsImpostor = new PhysicsImpostor(
    box,
    PhysicsImpostor.BoxImpostor,
    { mass: 1, restitution: 0.2, friction: 0.5 },
    scene
  );

  ground.physicsImpostor = new PhysicsImpostor(
    ground,
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );

  const wallThickness = 0.2;
  const wallHeight = 2;
  const wallLength = 6;

  const walls = [];

  walls.push(
    MeshBuilder.CreateBox(
      "backWall",
      { width: wallLength, height: wallHeight, depth: wallThickness },
      scene
    )
  );
  walls[0].position.set(0, wallHeight / 2, wallLength / 2);
  walls[0].physicsImpostor = new PhysicsImpostor(
    walls[0],
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );

  walls.push(
    MeshBuilder.CreateBox(
      "frontWall",
      { width: wallLength, height: wallHeight, depth: wallThickness },
      scene
    )
  );

  walls.push(
    MeshBuilder.CreateBox(
      "leftWall",
      { width: wallThickness, height: wallHeight, depth: wallLength },
      scene
    )
  );
  walls[2].position.set(-wallLength / 2, wallHeight / 2, 0);
  walls[2].physicsImpostor = new PhysicsImpostor(
    walls[2],
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );

  walls.push(
    MeshBuilder.CreateBox(
      "rightWall",
      { width: wallThickness, height: wallHeight, depth: wallLength },
      scene
    )
  );
  walls[3].position.set(wallLength / 2, wallHeight / 2, 0);
  walls[3].physicsImpostor = new PhysicsImpostor(
    walls[3],
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
  );

  const playerHeight = 1.8;
  const playerWidth = 0.6;

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
  playerMesh.position.copyFrom(PLAYER_SPAWN);

  cam.parent = playerMesh;
  cam.position = new Vector3(0, playerHeight * 0.5, 0);

  playerMesh.physicsImpostor = new PhysicsImpostor(
    playerMesh,
    PhysicsImpostor.BoxImpostor,
    { mass: 1, restitution: 0, friction: 0.5 },
    scene
  );

  const body = playerMesh.physicsImpostor.physicsBody;
  if (body && body.angularFactor) {
    body.angularFactor.set(0, 0, 0);
  }

  scene.playerMesh = playerMesh;

  await setupSharedWebXR(scene, {
    ground,
    mirror,
    desktopKeys,
    playerHeight,
    playerSpawn: PLAYER_SPAWN,
  });

  await scene.whenReadyAsync();

  return scene;
}

export async function loadScene(engine) {
  return startScene(engine);
}

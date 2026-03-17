import {
  Scene,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  FreeCamera,
  SceneLoader,
  WebXRFeatureName,
} from "babylonjs";
import "babylonjs-loaders";
import * as CANNON from "cannon"; 
import "babylonjs-loaders";

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

  scene.enablePhysics(
  new BABYLON.Vector3(0, -9.81, 0), // gravity
  new BABYLON.CannonJSPlugin(true, 10, CANNON) // plugin with imported CANNON
);
  
  const cam = new FreeCamera("cam", new Vector3(0.25, 2, -8), scene);
  cam.rotation = new Vector3(0.19996493417004554, -6.291316540956004, 0);
  cam.attachControl(); 
  new HemisphericLight("light", new Vector3(0, 2, 0), scene);

  
  const box = MeshBuilder.CreateBox("box", { size: 0.5 }, scene);
  box.position = new Vector3(0, 1, 0);

  const ground = MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);
  ground.position.y = -0.25;

  
  const room = await SceneLoader.ImportMeshAsync(null, "/scene-models/", "test-room.glb", scene);
  console.log("Imported meshes:", room.meshes.map((m) => m.name));

  // Showcase models
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
    new Vector3(0, Math.PI / 6),
    new Vector3(.19, .19, .19)
  );

  await placeModel(
    scene,
    "dart-red.glb",
    new Vector3(1.84, 1.76, 9.24),
    new Vector3(0, 0, -Math.PI / 6),
    new Vector3(.19, .19, .19)
  );

  await placeModel(
    scene,
    "default-avatar.glb",
    new Vector3(-9.47, 0.00, 9.47),
    new Vector3(0, Math.PI / 1.5, 0),
    new Vector3(0.8, 0.8, 0.8)
  );

  // Box affected by gravity + Falls
box.physicsImpostor = new BABYLON.PhysicsImpostor(
  box,
  BABYLON.PhysicsImpostor.BoxImpostor, // shape of the physics body
  { mass: 1, restitution: 0.2, friction: 0.5 }, // mass>0 so gravity affects it
  scene
);

// Ground stays static
ground.physicsImpostor = new BABYLON.PhysicsImpostor(
  ground,
  BABYLON.PhysicsImpostor.BoxImpostor,
  { mass: 0, restitution: 0.2, friction: 0.8 }, // mass=0 → immovable
  scene
);

const wallThickness = 0.2;
const wallHeight = 2;
const wallLength = 6;

const walls = [];

// Back wall
walls.push(BABYLON.MeshBuilder.CreateBox("backWall", { width: wallLength, height: wallHeight, depth: wallThickness }, scene));
walls[0].position.set(0, wallHeight / 2, wallLength / 2);
walls[0].physicsImpostor = new BABYLON.PhysicsImpostor(
  walls[0],
  BABYLON.PhysicsImpostor.BoxImpostor,
  { mass: 0, restitution: 0.2, friction: 0.8 },
  scene
);

// Front wall
walls.push(BABYLON.MeshBuilder.CreateBox("frontWall", { width: wallLength, height: wallHeight, depth: wallThickness }, scene));
walls[1].position.set(0, wallHeight / 2, -wallLength / 2);
walls[1].physicsImpostor = new BABYLON.PhysicsImpostor(
  walls[1],
  BABYLON.PhysicsImpostor.BoxImpostor,
  { mass: 0, restitution: 0.2, friction: 0.8 },
  scene
);

// Left wall
walls.push(BABYLON.MeshBuilder.CreateBox("leftWall", { width: wallThickness, height: wallHeight, depth: wallLength }, scene));
walls[2].position.set(-wallLength / 2, wallHeight / 2, 0);
walls[2].physicsImpostor = new BABYLON.PhysicsImpostor(
  walls[2],
  BABYLON.PhysicsImpostor.BoxImpostor,
  { mass: 0, restitution: 0.2, friction: 0.8 },
  scene
);

// Right wall
walls.push(BABYLON.MeshBuilder.CreateBox("rightWall", { width: wallThickness, height: wallHeight, depth: wallLength }, scene));
walls[3].position.set(wallLength / 2, wallHeight / 2, 0);
walls[3].physicsImpostor = new BABYLON.PhysicsImpostor(
  walls[3],
  BABYLON.PhysicsImpostor.BoxImpostor,
  { mass: 0, restitution: 0.2, friction: 0.8 },
  scene
);


const playerHeight = 1.8;
const playerWidth = 0.6;

// Create an invisible box as the player physics body
//Coliders work Kinda, Colisions with walls stop but if are pushed causes extreme physics reactions, and the player/objects falls through the ground. I’m not sure if it’s a problem with the physics impostor setup or if there’s something else going on.
const playerMesh = BABYLON.MeshBuilder.CreateBox("player", {
    width: playerWidth,
    height: playerHeight,
    depth: playerWidth
}, scene);

playerMesh.isVisible = false; // hide the box
playerMesh.position.copyFrom(cam.position); // start at camera position

// Add physics impostor so gravity and collisions affect the player
// Player Exists within the scene but for some reason imediately falls through the ground and walls. I’m not sure if it’s a problem with the physics impostor setup or if there’s something else going on.
playerMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
    playerMesh,
    BABYLON.PhysicsImpostor.BoxImpostor,
    { mass: 1, restitution: 0, friction: 0.5 },
    scene
);
  const xr = await scene.createDefaultXRExperienceAsync({
    uiOptions: { sessionMode: "immersive-vr" },
  });

  const fm = xr.baseExperience.featuresManager;
  fm.disableFeature(WebXRFeatureName.TELEPORTATION);


  
  try {
    fm.enableFeature(WebXRFeatureName.MOVEMENT, "stable", {
        xrInput: xr.input,
        movementOrientationFollowsViewerPose: true,
        movementSpeed: 0.25,
        rotationSpeed: 0.25,
    });
    console.log("[XR] Smooth movement enabled");
  } catch (e) {
    console.error("[XR] Movement feature failed:", e);
  }

  
  try {
    fm.enableFeature(WebXRFeatureName.TURNING, "stable", {
      snapTurns: true,
      snapTurnAngle: Math.PI / 6,
    });
    console.log("[XR] Turning enabled");
  } catch (e) {
    console.warn("[XR] Turning feature not available; we’ll do manual snap turn if needed.", e);
  }

  await scene.whenReadyAsync();
  return scene;
}
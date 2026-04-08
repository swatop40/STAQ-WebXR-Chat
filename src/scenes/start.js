import {
  Scene,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  FreeCamera,
  SceneLoader,
  WebXRFeatureName,
  CannonJSPlugin,
  PhysicsImpostor,
  Plane,
  StandardMaterial,
  MirrorTexture,
  Color3,
} from "babylonjs";
import "babylonjs-loaders";
import * as CANNON from "cannon";

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

  scene._movementKeys = {
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

window.addEventListener("keydown", (e) => {
    if (scene._movementKeys.hasOwnProperty(e.key)) {
        scene._movementKeys[e.key] = true;
    }
});

window.addEventListener("keyup", (e) => {
    if (scene._movementKeys.hasOwnProperty(e.key)) {
        scene._movementKeys[e.key] = false;
    }
});

  new HemisphericLight("light", new Vector3(0, 2, 0), scene);

  const box = MeshBuilder.CreateBox("box", { size: 0.5 }, scene);
  box.position = new Vector3(0, 1, 0);

  const mirror = MeshBuilder.CreatePlane("mirror", { width: 4.5, height: 7.2 }, scene);
  mirror.position = new Vector3(7.29, 1, 11); // example

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
    "default-avatar.glb",
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
  walls[1].position.set(0, wallHeight / 2, -wallLength / 2);
  walls[1].physicsImpostor = new PhysicsImpostor(
    walls[1],
    PhysicsImpostor.BoxImpostor,
    { mass: 0, restitution: 0.2, friction: 0.8 },
    scene
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
  playerMesh.position = new Vector3(0.25, 2, -8);

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

  const xr = await scene.createDefaultXRExperienceAsync({
    uiOptions: { sessionMode: "immersive-vr" },
  });

  scene.xrHelper = xr;

  const fm = xr.baseExperience.featuresManager;
  fm.disableFeature(WebXRFeatureName.TELEPORTATION);

  try {
   // fm.enableFeature(WebXRFeatureName.MOVEMENT, "stable", {
    //  xrInput: xr.input,
     // movementOrientationFollowsViewerPose: true,
     // movementSpeed: 0.25,
     // rotationSpeed: 0.25,
    //});
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

  const mirrorMat = new StandardMaterial("mirrorMat", scene);
  const mirrorTex = new MirrorTexture("mirrorTex", 256, scene, true);

  mirrorTex.mirrorPlane = new Plane(0, 0, 1, -mirror.position.z);
  mirrorTex.refreshRate = 2; 

  mirrorTex.renderList = scene.meshes.filter(m => m !== mirror);

  mirrorMat.reflectionTexture = mirrorTex;
  mirrorMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
  mirrorMat.specularColor = new Color3(1, 1, 1);

  mirror.material = mirrorMat;

  scene.mirrorTex = mirrorTex;
  scene.mirrorMesh = mirror;


scene.onBeforeRenderObservable.add(() => {
    if (!scene.playerMesh || !scene.activeCamera) return;

    const cam = scene.activeCamera;
    const mesh = scene.playerMesh;

    
    mesh.position.x = cam.globalPosition.x;
    mesh.position.z = cam.globalPosition.z;

    cam.position.y = playerHeight * 0.5;
});

const moveVec = new Vector3(0, 0, 0);

scene.onBeforeRenderObservable.add(() => {
    if (!scene.playerMesh) return;

    const mesh = scene.playerMesh;

    // Desktop movement (WASD)
   const keys = scene._movementKeys;

    let inputX = 0;
    let inputZ = 0;

    if (keys.w || keys.ArrowUp) inputZ += 1;
    if (keys.s || keys.ArrowDown) inputZ -= 1;
    if (keys.a || keys.ArrowLeft) inputX -= 1;
    if (keys.d || keys.ArrowRight) inputX += 1;

    if (inputX !== 0 || inputZ !== 0) {

        // Get camera directions
        const forward = cam.getDirection(new BABYLON.Vector3(0, 0, 1));
        const right   = cam.getDirection(new BABYLON.Vector3(1, 0, 0));

        // Flatten to horizontal plane
        forward.y = 0;
        right.y = 0;

        forward.normalize();
        right.normalize();

        // Combine input with camera directions
        const move = forward.scale(inputZ).add(right.scale(inputX));

        const speed = .75; // Adjust as needed;

        mesh.physicsImpostor.setLinearVelocity(
            new BABYLON.Vector3(
                move.x * speed,
                mesh.physicsImpostor.getLinearVelocity().y,
                move.z * speed
            )
        );
    }

    const body = mesh.physicsImpostor.physicsBody;
    if (body) {
        body.angularVelocity.set(0, 0, 0);
    }

    // VR controller movement
    const xrHelper = scene.xrHelper;
    if (xrHelper && xrHelper.input && xrHelper.input.controllers) {
        for (const controller of xrHelper.input.controllers) {
            const gamepad = controller.inputSource?.gamepad;
            if (!gamepad || !gamepad.axes) continue;

            // XR axes:
            const x = gamepad.axes[2] || 0;
            const y = gamepad.axes[3] || 0;

            // Deadzone
            if (Math.abs(x) < 0.1 && Math.abs(y) < 0.1) continue;

            // Camera-based movement directions
            const forward = cam.getDirection(new BABYLON.Vector3(0, 0, 1));
            const right = cam.getDirection(new BABYLON.Vector3(1, 0, 0));

            forward.y = 0;
            right.y = 0;

            forward.normalize();
            right.normalize();

            // Combine movement
            const move = forward.scale(-y).add(right.scale(x));

            mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    move.x * speed,
                    mesh.physicsImpostor.getLinearVelocity().y,
                    move.z * speed
                )
            );
        }
    }
});

  await scene.whenReadyAsync();

  return scene;
}
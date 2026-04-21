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
  const desktopKeys = new Set();
  const XR_WORLD_SCALE_FACTOR = 1.9;
  let xrMode = "teleport";

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

  scene.navigation = {
    desktopMode: "smooth",
    xrMode: "teleport",
    toggleXRMode() {
      xrMode = xrMode === "teleport" ? "smooth" : "teleport";
      this.xrMode = xrMode;
      console.log(`[NAV] XR mode: ${xrMode}`);
    },
  };

  const xr = await scene.createDefaultXRExperienceAsync({
    uiOptions: { sessionMode: "immersive-vr" },
    floorMeshes: [ground],
  });

  scene.xrHelper = xr;
  xr.baseExperience.onStateChangedObservable.add((state) => {
    if (state === BABYLON.WebXRState.IN_XR) {
      xr.baseExperience.sessionManager.worldScalingFactor = XR_WORLD_SCALE_FACTOR;
    } else if (state === BABYLON.WebXRState.NOT_IN_XR) {
      xr.baseExperience.sessionManager.worldScalingFactor = 1;
    }
  });

  const fm = xr.baseExperience.featuresManager;

  const VRteleportation = fm.enableFeature(
    WebXRFeatureName.TELEPORTATION,
    "stable",
    {
      xrInput: xr.input,
      floorMeshes: [ground],
      renderingGroupId: 1,
      parabolicRayEnabled: false,
    }
  );

  xr.teleportation = VRteleportation;

  try {
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
  const mirrorTex = new MirrorTexture("mirrorTex", 1048, scene, true);

  mirrorTex.mirrorPlane = new Plane(0, 0, 1, -mirror.position.z);
  mirrorTex.refreshRate = 2;

  mirrorTex.renderList = scene.meshes.filter((m) => m !== mirror);

  mirrorMat.reflectionTexture = mirrorTex;
  mirrorMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
  mirrorMat.specularColor = new Color3(1, 1, 1);

  mirror.material = mirrorMat;

  scene.mirrorTex = mirrorTex;
  scene.mirrorMesh = mirror;

  scene.onBeforeRenderObservable.add(() => {
    if (!scene.playerMesh || !scene.activeCamera) return;

    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    if (inXR) {
      if (xrMode === "smooth") {
        const xrCamera = scene.xrHelper.baseExperience.camera;
        const dt = scene.getEngine().getDeltaTime() / 1000;
        const moveSpeed = 1.8;
        let moveX = 0;
        let moveY = 0;

        for (const controller of scene.xrHelper.input.controllers) {
          const gamepad = controller.inputSource?.gamepad;
          if (!gamepad?.axes?.length) continue;

          if (Math.abs(gamepad.axes[2] ?? 0) > 0.1 || Math.abs(gamepad.axes[3] ?? 0) > 0.1) {
            moveX = gamepad.axes[2] ?? 0;
            moveY = gamepad.axes[3] ?? 0;
            break;
          }

          if (Math.abs(gamepad.axes[0] ?? 0) > 0.1 || Math.abs(gamepad.axes[1] ?? 0) > 0.1) {
            moveX = gamepad.axes[0] ?? 0;
            moveY = gamepad.axes[1] ?? 0;
          }
        }

        if (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1) {
          const forward = xrCamera.getDirection(Vector3.Forward());
          forward.y = 0;
          if (forward.lengthSquared() > 0.0001) {
            forward.normalize();
          }

          const right = xrCamera.getDirection(Vector3.Right());
          right.y = 0;
          if (right.lengthSquared() > 0.0001) {
            right.normalize();
          }

          const move = forward.scale(-moveY).add(right.scale(moveX));
          if (move.lengthSquared() > 0.0001) {
            move.normalize().scaleInPlace(moveSpeed * dt);
            xrCamera.position.addInPlace(move);
          }
        }
      }

      return;
    }

    const cam = scene.activeCamera;
    const mesh = scene.playerMesh;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    const moveSpeed = desktopKeys.has("shift") ? 4.2 : 2.6;

    const forward = cam.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() > 0.0001) {
      forward.normalize();
    }

    const right = cam.getDirection(Vector3.Right());
    right.y = 0;
    if (right.lengthSquared() > 0.0001) {
      right.normalize();
    }

    const move = Vector3.Zero();
    if (desktopKeys.has("w") || desktopKeys.has("arrowup")) move.addInPlace(forward);
    if (desktopKeys.has("s") || desktopKeys.has("arrowdown")) move.subtractInPlace(forward);
    if (desktopKeys.has("d") || desktopKeys.has("arrowright")) move.addInPlace(right);
    if (desktopKeys.has("a") || desktopKeys.has("arrowleft")) move.subtractInPlace(right);

    if (move.lengthSquared() > 0.0001) {
      move.normalize().scaleInPlace(moveSpeed * dt);
      mesh.position.addInPlace(move);

      if (mesh.physicsImpostor) {
        mesh.physicsImpostor.setLinearVelocity(Vector3.Zero());
      }
    }

    mesh.position.y = playerHeight * 0.5;

    cam.position.y = playerHeight * 0.5;

    const body = mesh.physicsImpostor.physicsBody;
    if (body) {
      body.position.x = mesh.position.x;
      body.position.y = mesh.position.y;
      body.position.z = mesh.position.z;
      body.angularVelocity.set(0, 0, 0);
    }
  });

  // Create host mesh FIRST
  const menuHost = BABYLON.MeshBuilder.CreateBox("menuHost", { size: 0.01 }, scene);
  menuHost.isVisible = false;
  menuHost.rotationQuaternion = new BABYLON.Quaternion();
  let menuVisible = false;

  // Create GUI manager
  const guiManager = new BABYLON.GUI.GUI3DManager(scene);

  // Create panel
  const menuPanel = new BABYLON.GUI.StackPanel3D();
  guiManager.addControl(menuPanel);

  // Link panel to host
  menuPanel.linkToTransformNode(menuHost);

  // Hide panel initially
  menuPanel.isVisible = false;
  menuPanel.margin = 0.2;

  // Add buttons
  function addMenuButton(text, callback) {
    const button = new BABYLON.GUI.HolographicButton(text + "_btn");
    menuPanel.addControl(button);
    button.text = text;
    button.onPointerUpObservable.add(callback);
    return button;
  }

  addMenuButton("Switch Environment", () => console.log("Switch environment clicked"));
  addMenuButton("Open Server Chat", () => console.log("Open chat clicked"));
  addMenuButton("Exit Website", () => {
    const answer = window.confirm("Are you sure you want to leave this scene?");
    if (answer) {
      window.location.href = "https://google.com";
    }
  });

  const closeBtn = new BABYLON.GUI.HolographicButton("close_btn");
  menuPanel.addControl(closeBtn);
  closeBtn.text = "Close The Menu";
  closeBtn.onPointerUpObservable.add(() => {
    hideMenu();
  });

  function placeMenuInFrontOfCamera(distance = 1.6) {
    const cam = scene.activeCamera;
    if (!cam) return;

    const camPos = cam.globalPosition.clone();
    const forward = cam.getDirection(BABYLON.Axis.Z).normalize();
    const pos = camPos.add(forward.scale(distance));
    menuHost.position.copyFrom(pos);
    const lookDir = camPos.subtract(menuHost.position).normalize();
    menuHost.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(
      lookDir,
      BABYLON.Axis.Y
    );
  }

  function showMenu() {
    placeMenuInFrontOfCamera();
    menuPanel.isVisible = true;
    menuVisible = true;
  }

  function hideMenu() {
    menuPanel.isVisible = false;
    menuVisible = false;
    menuHost.position.set(9999, 9999, 9999);
  }

  function toggleMenu() {
    if (menuVisible) {
      hideMenu();
    } else {
      showMenu();
    }
  }

  scene.openMenu = showMenu;
  scene.closeMenu = hideMenu;
  scene.toggleMenu = toggleMenu;

  xr.input.onControllerAddedObservable.add((controller) => {
    controller.onMotionControllerInitObservable.add((motionController) => {
      const xrIdsToTry = [
        "xr-standard-thumbstick",
        "xr-standard-touchpad",
        "a-button",
        "x-button",
        "y-button",
        "b-button",
      ];

      for (const componentId of xrIdsToTry) {
        const component = motionController.getComponent(componentId);
        if (!component) continue;

        let lastPressed = false;
        component.onButtonStateChangedObservable.add(() => {
          const pressed = component.pressed;
          if (pressed && !lastPressed) {
            toggleMenu();
          }
          lastPressed = pressed;
        });

        break;
      }
    });
  });

  scene.onBeforeRenderObservable.add(() => {
    if (!menuVisible) return;
    placeMenuInFrontOfCamera();
  });

  // Toggle with ESC
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
      desktopKeys.add(key);
      e.preventDefault();
    }

    if (e.key === "Escape") {
      toggleMenu();
    }

    if (key === "m") {
      if (scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR) {
        scene.navigation.toggleXRMode();
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
      desktopKeys.delete(key);
      e.preventDefault();
    }
  });

  await scene.whenReadyAsync();

  return scene;
}

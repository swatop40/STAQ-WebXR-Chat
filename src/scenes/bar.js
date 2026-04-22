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

  const ground = MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);
  ground.position.y = -0;

  const room = await SceneLoader.ImportMeshAsync(null, "/scene-models/", "bar.glb", scene);
  console.log("Imported meshes:", room.meshes.map((m) => m.name));

  await placeModel(
    scene,
    "chair.glb",
    new Vector3(3.20, 0.68, 8.75),
    new Vector3(0, 0, 0),
    new Vector3(0.5, 0.5, 0.5)
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

  scene.navigation = {
    desktopMode: "smooth",
    xrMode: "smooth",
    toggleXRMode() {
      xrMode = xrMode === "teleport" ? "smooth" : "teleport";
      this.xrMode = xrMode;
      console.log(`[NAV] XR mode: ${xrMode}`);
      return xrMode;
    },
  };

  const xr = await scene.createDefaultXRExperienceAsync({
    uiOptions: { sessionMode: "immersive-vr" },
    floorMeshes: [ground],
  });

  scene.xrHelper = xr;
  const xrOrigin = new BABYLON.TransformNode("xrOrigin", scene);
  xrOrigin.position.copyFrom(XR_SPAWN_FLOOR);
  scene.xrOrigin = xrOrigin;

  xr.baseExperience.onInitialXRPoseSetObservable.add((xrCamera) => {
    xrCamera.position.set(XR_SPAWN_FLOOR.x, xrCamera.position.y, XR_SPAWN_FLOOR.z);
    xrOrigin.position.copyFromFloats(xrCamera.globalPosition.x, 0, xrCamera.globalPosition.z);
  });

  xr.baseExperience.onStateChangedObservable.add((state) => {
    if (state === BABYLON.WebXRState.IN_XR) {
      xr.baseExperience.sessionManager.worldScalingFactor = XR_WORLD_SCALE_FACTOR;
      const xrCamera = xr.baseExperience.camera;
      xrCamera.position.set(XR_SPAWN_FLOOR.x, xrCamera.position.y, XR_SPAWN_FLOOR.z);
      xrOrigin.position.copyFromFloats(xrCamera.globalPosition.x, 0, xrCamera.globalPosition.z);
    } else if (state === BABYLON.WebXRState.NOT_IN_XR) {
      xr.baseExperience.sessionManager.worldScalingFactor = 1;
      scene.playerMesh.position.copyFrom(PLAYER_SPAWN);
      xrOrigin.position.copyFrom(XR_SPAWN_FLOOR);
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

  function applyXRMovementMode() {
    if (xrMode === "smooth") {
      xr.teleportation?.detach();
    } else {
      xr.teleportation?.attach();
    }

    console.log(`[XR] Applied movement mode: ${xrMode}`);
  }

  applyXRMovementMode();

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
  const mirrorTex = new MirrorTexture("mirrorTex", 1024, scene, true);

  function updateMirrorPlane() {
    const world = mirror.computeWorldMatrix(true);
    const mirrorOrigin = world.getTranslation();
    const mirrorNormal = Vector3.TransformNormal(Vector3.Forward(), world).normalize();
    mirrorTex.mirrorPlane = Plane.FromPositionAndNormal(mirrorOrigin, mirrorNormal);
  }

  updateMirrorPlane();
  mirrorTex.refreshRate = 2;

  mirrorTex.renderList = scene.meshes.filter(
    (m) => m !== mirror && m.name !== "player" && m.name !== "menuHost"
  );

  if (!scene.customRenderTargets.includes(mirrorTex)) {
    scene.customRenderTargets.push(mirrorTex);
  }

  mirrorMat.reflectionTexture = mirrorTex;
  mirrorMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
  mirrorMat.specularColor = new Color3(1, 1, 1);

  mirror.material = mirrorMat;

  scene.mirrorTex = mirrorTex;
  scene.mirrorMesh = mirror;

  scene.onBeforeRenderObservable.add(() => {
    updateMirrorPlane();

    if (!scene.playerMesh || !scene.activeCamera) return;

    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    mirrorTex.refreshRate = inXR ? 1 : 2;

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
            if (scene.xrOrigin) {
              scene.xrOrigin.position.addInPlaceFromFloats(move.x, 0, move.z);
            }
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
  menuHost.rotationQuaternion = BABYLON.Quaternion.Identity();
  menuHost.scaling = new Vector3(0.64, 0.64, 0.64);
  menuHost.setEnabled(false);
  let menuVisible = false;
  let menuAnchorRoot = null;
  const menuActivator = MeshBuilder.CreateSphere(
    "menuActivator",
    { diameter: 0.09, segments: 12 },
    scene
  );
  const menuActivatorMat = new StandardMaterial("menuActivatorMat", scene);
  menuActivatorMat.diffuseColor = new Color3(0.13, 0.47, 0.91);
  menuActivatorMat.emissiveColor = new Color3(0.08, 0.22, 0.42);
  menuActivatorMat.specularColor = new Color3(0, 0, 0);
  menuActivator.material = menuActivatorMat;
  menuActivator.isVisible = false;
  menuActivator.isPickable = true;
  menuActivator.isNearPickable = false;
  menuActivator.actionManager = new BABYLON.ActionManager(scene);

  const menuBoard = MeshBuilder.CreatePlane(
    "menuBoard",
    { width: 1.98, height: 0.42, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    scene
  );
  menuBoard.parent = menuHost;
  menuBoard.position.z = 0.02;
  menuBoard.isPickable = true;
  menuBoard.setEnabled(false);

  const menuTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(
    menuBoard,
    3328,
    960,
    false
  );

  const menuCard = new BABYLON.GUI.Rectangle("menuCard");
  menuCard.width = "99.2%";
  menuCard.height = "90%";
  menuCard.thickness = 3;
  menuCard.cornerRadius = 28;
  menuCard.color = "#bfd0df";
  menuCard.background = "#0d1a29F2";
  menuTexture.addControl(menuCard);

  const menuPanel = new BABYLON.GUI.Grid("menuGrid");
  menuPanel.width = "97%";
  menuPanel.height = "86%";
  menuPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  menuPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  for (let i = 0; i < 6; i += 1) {
    menuPanel.addColumnDefinition(1 / 6);
  }
  menuPanel.addRowDefinition(1);
  menuCard.addControl(menuPanel);

  let menuButtonIndex = 0;

  function addMenuButton(text, callback) {
    const button = BABYLON.GUI.Button.CreateSimpleButton(`${text}_btn`, text);
    button.width = "95%";
    button.height = "96%";
    button.thickness = 2;
    button.cornerRadius = 18;
    button.color = "white";
    button.background = "#4e6f8d";
    button.fontSize = 72;
    button.fontFamily = "Arial";
    button.paddingLeft = "6px";
    button.paddingRight = "6px";
    button.textBlock.textWrapping = true;
    button.textBlock.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    button.textBlock.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    button.onPointerUpObservable.add(callback);
    menuPanel.addControl(button, 0, menuButtonIndex);
    menuButtonIndex += 1;
    return button;
  }

  addMenuButton("Emotes", () => console.log("Open emotes clicked"));
  addMenuButton("Switch Environment", () => {
    const answer = window.confirm("Are you sure you want to leave this scene?")
    if (answer) {
        window.location.href = "/choose-scene.html";
      }
    });
  addMenuButton("Open Server Chat", () => console.log("Open chat clicked"));
  addMenuButton("Settings", () => {
    const nextMode = scene.navigation.toggleXRMode();
    applyXRMovementMode();
    console.log(`[SETTINGS] XR locomotion set to ${nextMode}`);
  });
  addMenuButton("Exit Website", () => {
    const answer = window.confirm("Are you sure you want to leave this scene?");
    if (answer) {
      window.location.href = "https://google.com";
    }
  });
  addMenuButton("Close The Menu", () => {
    hideMenu();
  });

  function getMenuCamera() {
    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    return inXR ? scene.xrHelper?.baseExperience?.camera ?? scene.activeCamera : scene.activeCamera;
  }

  function getMenuAnchorNode() {
    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    if (inXR) {
      return scene.xrOrigin || scene.xrHelper?.baseExperience?.camera || scene.activeCamera;
    }
    return scene.playerMesh || scene.activeCamera;
  }

  function worldToLocalPosition(node, worldPos) {
    const inv = node.getWorldMatrix().clone();
    inv.invert();
    return BABYLON.Vector3.TransformCoordinates(worldPos, inv);
  }

  function placeMenuInFrontOfCamera(attachToRoot = false) {
    const cam = getMenuCamera();
    if (!cam) return;

    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    const distance = inXR ? 1.72 : 1.85;
    const verticalOffset = inXR ? -0.5 : -0.54;
    const hostScale = inXR ? 0.78 : 0.9;

    menuHost.scaling.set(hostScale, hostScale, hostScale);
    menuHost.parent = null;

    const camPos = cam.globalPosition.clone();
    const forward = cam.getDirection(BABYLON.Axis.Z);
    forward.y = 0;
    if (forward.lengthSquared() > 0.0001) {
      forward.normalize();
    } else {
      forward.copyFromFloats(0, 0, 1);
    }

    const pos = camPos.add(forward.scale(distance)).add(new BABYLON.Vector3(0, verticalOffset, 0));
    menuHost.position.copyFrom(pos);

    const lookDir = camPos.subtract(menuHost.position);
    lookDir.y = 0;
    if (lookDir.lengthSquared() > 0.0001) {
      lookDir.normalize();
    } else {
      lookDir.copyFromFloats(0, 0, -1);
    }

    menuHost.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(
      lookDir,
      BABYLON.Vector3.Up()
    );

    if (attachToRoot) {
      menuAnchorRoot = getMenuAnchorNode();
      if (menuAnchorRoot) {
        const worldPos = menuHost.position.clone();
        const worldRot = menuHost.rotationQuaternion.clone();
        menuHost.parent = menuAnchorRoot;
        menuHost.position.copyFrom(worldToLocalPosition(menuAnchorRoot, worldPos));
        menuHost.rotationQuaternion = worldRot;
      }
    }
  }

  function showMenu() {
    menuHost.setEnabled(true);
    placeMenuInFrontOfCamera(true);
    menuBoard.setEnabled(true);
    menuVisible = true;
  }

  function hideMenu() {
    menuBoard.setEnabled(false);
    menuVisible = false;
    menuAnchorRoot = null;
    menuHost.parent = null;
    menuHost.setEnabled(false);
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
  menuActivator.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () => {
      toggleMenu();
    })
  );

  const xrMenuButtonStates = new Map();

  function isMenuFaceButtonPressed(controller) {
    const motionController = controller.motionController;
    if (motionController?.components) {
      for (const [id, component] of Object.entries(motionController.components)) {
        const normalizedId = id.toLowerCase();
        if (normalizedId === "a-button" || normalizedId === "x-button") {
          return component.pressed;
        }
      }
    }

    const primaryFaceButton = controller.inputSource?.gamepad?.buttons?.[4];
    return !!primaryFaceButton?.pressed;
  }

  function updateXRMenuActivator() {
    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    menuActivator.isVisible = inXR;
    if (!inXR) return;

    if (menuActivator.parent) {
      menuActivator.parent = null;
    }

    const leftController = xr.input.controllers.find(
      (controller) => controller.inputSource?.handedness === "left"
    );
    const anchor = leftController?.grip || leftController?.pointer || null;

    if (anchor) {
      const origin = anchor.getAbsolutePosition();
      const right = anchor.getDirection(BABYLON.Axis.X).normalize();
      const up = anchor.getDirection(BABYLON.Axis.Y).normalize();
      const forward = anchor.getDirection(BABYLON.Axis.Z).normalize();

      menuActivator.position.copyFrom(
        origin
          .add(right.scale(-0.065))
          .add(up.scale(0.04))
          .add(forward.scale(0.02))
      );
    } else {
      const cam = scene.xrHelper?.baseExperience?.camera ?? scene.activeCamera;
      if (!cam) return;

      const camPos = cam.globalPosition.clone();
      const forward = cam.getDirection(BABYLON.Axis.Z).normalize();
      const right = cam.getDirection(BABYLON.Axis.X).normalize();
      const up = cam.getDirection(BABYLON.Axis.Y).normalize();

      menuActivator.position.copyFrom(
        camPos
          .add(forward.scale(0.55))
          .add(right.scale(-0.22))
          .add(up.scale(-0.18))
      );
    }
  }

  xr.baseExperience.sessionManager.onXRFrameObservable.add(() => {
    updateXRMenuActivator();

    const inXR = scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;
    if (!inXR) {
      xrMenuButtonStates.clear();
      return;
    }

    const xrCamera = scene.xrHelper?.baseExperience?.camera;
    if (xrCamera && scene.xrOrigin) {
      scene.xrOrigin.position.copyFromFloats(xrCamera.globalPosition.x, 0, xrCamera.globalPosition.z);
    }

    for (const controller of xr.input.controllers) {
      const controllerId = controller.uniqueId || controller.inputSource?.handedness || "unknown";
      const isPressed = isMenuFaceButtonPressed(controller);
      const wasPressed = xrMenuButtonStates.get(controllerId) ?? false;

      if (isPressed && !wasPressed) {
        toggleMenu();
      }

      xrMenuButtonStates.set(controllerId, isPressed);
    }
  });

  scene.onBeforeRenderObservable.add(() => {
    updateXRMenuActivator();
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

  export async function loadScene(engine) {
  return await startScene(engine);
  }
}

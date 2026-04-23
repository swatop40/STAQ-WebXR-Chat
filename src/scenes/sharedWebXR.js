import {
  Axis,
  Color3,
  Mesh,
  MeshBuilder,
  MirrorTexture,
  Plane,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  WebXRFeatureName,
  WebXRState,
  ActionManager,
  ExecuteCodeAction,
} from "babylonjs";
import * as GUI from "babylonjs-gui";

export const DEFAULT_XR_SETTINGS = {
  worldScaleFactor: 1.9,
  desktopMoveSpeed: 2.6,
  desktopSprintSpeed: 4.2,
  xrMoveSpeed: 1.8,
  xrTurnMode: "snap",
  xrSmoothTurnSpeed: 1.8,
  xrSnapTurnAngle: Math.PI / 6,
  xrSnapTurnCooldownMs: 280,
  xrTurnDeadzone: 0.65,
  menuDistanceDesktop: 1.85,
  menuDistanceXR: 1.72,
  menuVerticalOffsetDesktop: -0.54,
  menuVerticalOffsetXR: -0.5,
  menuScaleDesktop: 0.9,
  menuScaleXR: 0.78,
};

const MOVE_KEYS = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
];

function isInXR(scene) {
  return scene.xrHelper?.baseExperience?.state === WebXRState.IN_XR;
}

function getThumbstickAxes(controller) {
  const axes = controller.inputSource?.gamepad?.axes || [];

  if (axes.length >= 4) {
    return { x: axes[2] ?? 0, y: axes[3] ?? 0 };
  }

  return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
}

function isMobileBrowser() {
  return /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

function setupMirror(scene, mirror) {
  if (!mirror) return null;

  const mirrorMat = new StandardMaterial("mirrorMat", scene);
  const mirrorTex = new MirrorTexture("mirrorTex", isMobileBrowser() ? 512 : 1024, scene, true);

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

  return { mirrorTex, updateMirrorPlane };
}

function setupMenu(scene, xr, applyXRMovementMode, settings) {
  const menuHost = MeshBuilder.CreateBox("menuHost", { size: 0.01 }, scene);
  menuHost.isVisible = false;
  menuHost.rotationQuaternion = Quaternion.Identity();
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
  menuActivator.actionManager = new ActionManager(scene);

  const menuBoard = MeshBuilder.CreatePlane(
    "menuBoard",
    { width: 1.98, height: 0.42, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );
  menuBoard.parent = menuHost;
  menuBoard.position.z = 0.02;
  menuBoard.isPickable = true;
  menuBoard.setEnabled(false);

  const menuTexture = GUI.AdvancedDynamicTexture.CreateForMesh(
    menuBoard,
    3328,
    960,
    false
  );

  const menuCard = new GUI.Rectangle("menuCard");
  menuCard.width = "99.2%";
  menuCard.height = "90%";
  menuCard.thickness = 3;
  menuCard.cornerRadius = 28;
  menuCard.color = "#bfd0df";
  menuCard.background = "#0d1a29F2";
  menuTexture.addControl(menuCard);

  const menuPanel = new GUI.Grid("menuGrid");
  menuPanel.width = "97%";
  menuPanel.height = "86%";
  menuPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  menuPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  for (let i = 0; i < 6; i += 1) {
    menuPanel.addColumnDefinition(1 / 6);
  }
  menuPanel.addRowDefinition(1);
  menuCard.addControl(menuPanel);

  let menuButtonIndex = 0;

  function addMenuButton(text, callback) {
    const button = GUI.Button.CreateSimpleButton(`${text}_btn`, text);
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
    button.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    button.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    button.onPointerUpObservable.add(callback);
    menuPanel.addControl(button, 0, menuButtonIndex);
    menuButtonIndex += 1;
    return button;
  }

  function hideMenu() {
    menuBoard.setEnabled(false);
    menuVisible = false;
    menuAnchorRoot = null;
    menuHost.setParent(null);
    menuHost.setEnabled(false);
  }

  addMenuButton("Emotes", () => console.log("Open emotes clicked"));
  addMenuButton("Switch Environment", () => {
    const answer = window.confirm("Are you sure you want to leave this scene?");
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
    const answer = window.confirm("Are you sure you want to leave STAQ-WebXR?");
    if (answer) {
      window.location.href = "https://google.com";
    }
  });
  addMenuButton("Close The Menu", hideMenu);

  function getMenuCamera() {
    return isInXR(scene)
      ? scene.xrHelper?.baseExperience?.camera ?? scene.activeCamera
      : scene.activeCamera;
  }

  function getMenuAnchorNode() {
    if (isInXR(scene)) {
      return scene.xrOrigin || scene.xrHelper?.baseExperience?.camera || scene.activeCamera;
    }
    return scene.playerMesh || scene.activeCamera;
  }

  function placeMenuInFrontOfCamera(attachToRoot = false) {
    const cam = getMenuCamera();
    if (!cam) return;

    const inXR = isInXR(scene);
    const distance = inXR ? settings.menuDistanceXR : settings.menuDistanceDesktop;
    const verticalOffset = inXR
      ? settings.menuVerticalOffsetXR
      : settings.menuVerticalOffsetDesktop;
    const hostScale = inXR ? settings.menuScaleXR : settings.menuScaleDesktop;

    menuHost.scaling.set(hostScale, hostScale, hostScale);
    menuHost.setParent(null);

    const camPos = cam.globalPosition.clone();
    const forward = cam.getDirection(Axis.Z);
    forward.y = 0;
    if (forward.lengthSquared() > 0.0001) {
      forward.normalize();
    } else {
      forward.copyFromFloats(0, 0, 1);
    }

    const pos = camPos.add(forward.scale(distance)).add(new Vector3(0, verticalOffset, 0));
    menuHost.position.copyFrom(pos);

    const lookDir = camPos.subtract(menuHost.position);
    lookDir.y = 0;
    if (lookDir.lengthSquared() > 0.0001) {
      lookDir.normalize();
    } else {
      lookDir.copyFromFloats(0, 0, -1);
    }

    menuHost.rotationQuaternion = Quaternion.FromLookDirectionLH(lookDir, Vector3.Up());

    if (attachToRoot) {
      menuAnchorRoot = getMenuAnchorNode();
      if (menuAnchorRoot) {
        menuHost.setParent(menuAnchorRoot);
      }
    }
  }

  function showMenu() {
    menuHost.setEnabled(true);
    placeMenuInFrontOfCamera(true);
    menuBoard.setEnabled(true);
    menuVisible = true;
  }

  function toggleMenu() {
    if (menuVisible) {
      hideMenu();
    } else {
      showMenu();
    }
  }

  function refreshMenuPosition() {
    if (menuVisible) {
      placeMenuInFrontOfCamera(true);
    }
  }

  scene.openMenu = showMenu;
  scene.closeMenu = hideMenu;
  scene.toggleMenu = toggleMenu;

  menuActivator.actionManager.registerAction(
    new ExecuteCodeAction(ActionManager.OnPickTrigger, toggleMenu)
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
    const inXR = isInXR(scene);
    menuActivator.isVisible = inXR;
    if (!inXR || !xr) return;

    if (menuActivator.parent) {
      menuActivator.parent = null;
    }

    const leftController = xr.input.controllers.find(
      (controller) => controller.inputSource?.handedness === "left"
    );
    const anchor = leftController?.grip || leftController?.pointer || null;

    if (anchor) {
      const origin = anchor.getAbsolutePosition();
      const right = anchor.getDirection(Axis.X).normalize();
      const up = anchor.getDirection(Axis.Y).normalize();
      const forward = anchor.getDirection(Axis.Z).normalize();

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
      const forward = cam.getDirection(Axis.Z).normalize();
      const right = cam.getDirection(Axis.X).normalize();
      const up = cam.getDirection(Axis.Y).normalize();

      menuActivator.position.copyFrom(
        camPos
          .add(forward.scale(0.55))
          .add(right.scale(-0.22))
          .add(up.scale(-0.18))
      );
    }
  }

  if (xr) {
    xr.baseExperience.sessionManager.onXRFrameObservable.add(() => {
      updateXRMenuActivator();

      if (!isInXR(scene)) {
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
  }

  scene.onBeforeRenderObservable.add(updateXRMenuActivator);

  return { toggleMenu, refreshMenuPosition };
}

export async function setupSharedWebXR(scene, options) {
  const settings = { ...DEFAULT_XR_SETTINGS, ...(options.settings || {}) };
  const {
    ground,
    mirror,
    desktopKeys,
    playerHeight,
    playerSpawn,
  } = options;

  const xrSpawnFloor = new Vector3(
    playerSpawn.x / settings.worldScaleFactor,
    0,
    playerSpawn.z / settings.worldScaleFactor
  );

  let xrMode = "smooth";

  scene.navigation = {
    desktopMode: "smooth",
    xrMode,
    toggleXRMode() {
      xrMode = xrMode === "teleport" ? "smooth" : "teleport";
      this.xrMode = xrMode;
      console.log(`[NAV] XR mode: ${xrMode}`);
      return xrMode;
    },
  };

  const xrOrigin = new TransformNode("xrOrigin", scene);
  xrOrigin.position.copyFrom(xrSpawnFloor);
  scene.xrOrigin = xrOrigin;

  let xr = null;

  try {
    if (!navigator.xr) {
      throw new Error("navigator.xr is unavailable");
    }

    xr = await scene.createDefaultXRExperienceAsync({
      uiOptions: { sessionMode: "immersive-vr" },
      floorMeshes: [ground],
    });
    scene.xrHelper = xr;
  } catch (err) {
    scene.xrHelper = null;
    console.warn("[XR] WebXR unavailable; continuing in desktop/mobile mode.", err);
  }

  if (xr) {
    xr.baseExperience.onInitialXRPoseSetObservable.add((xrCamera) => {
      xrCamera.position.set(xrSpawnFloor.x, xrCamera.position.y, xrSpawnFloor.z);
      xrOrigin.position.copyFromFloats(xrCamera.globalPosition.x, 0, xrCamera.globalPosition.z);
    });

    xr.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        xr.baseExperience.sessionManager.worldScalingFactor = settings.worldScaleFactor;
        const xrCamera = xr.baseExperience.camera;
        xrCamera.position.set(xrSpawnFloor.x, xrCamera.position.y, xrSpawnFloor.z);
        xrOrigin.position.copyFromFloats(xrCamera.globalPosition.x, 0, xrCamera.globalPosition.z);
      } else if (state === WebXRState.NOT_IN_XR) {
        xr.baseExperience.sessionManager.worldScalingFactor = 1;
        scene.playerMesh.position.copyFrom(playerSpawn);
        xrOrigin.position.copyFrom(xrSpawnFloor);
      }
    });

    const fm = xr.baseExperience.featuresManager;
    const teleportation = fm.enableFeature(WebXRFeatureName.TELEPORTATION, "stable", {
      xrInput: xr.input,
      floorMeshes: [ground],
      renderingGroupId: 1,
      parabolicRayEnabled: false,
    });

    xr.teleportation = teleportation;

    if (WebXRFeatureName.TURNING) {
      try {
        fm.enableFeature(WebXRFeatureName.TURNING, "stable", {
          snapTurns: true,
          snapTurnAngle: Math.PI / 6,
        });
        console.log("[XR] Turning enabled");
      } catch (e) {
        console.warn("[XR] Turning feature not available; using default controller turning.", e);
      }
    }
  }

  function applyXRMovementMode() {
    if (!xr) {
      console.log("[XR] Movement mode ignored because WebXR is unavailable.");
      return;
    }

    if (xrMode === "smooth") {
      xr.teleportation?.detach();
    } else {
      xr.teleportation?.attach();
    }

    console.log(`[XR] Applied movement mode: ${xrMode}`);
  }

  applyXRMovementMode();
  if (xr) {
    console.log("[XR] Smooth movement enabled");
  }

  const mirrorSetup = setupMirror(scene, mirror);
  const menu = setupMenu(scene, xr, applyXRMovementMode, settings);
  let lastSnapTurnAt = 0;

  function rotateXRView(angle) {
    const xrCamera = scene.xrHelper?.baseExperience?.camera;
    if (!xrCamera) return;

    const yawRotation = Quaternion.RotationAxis(Vector3.Up(), angle);
    xrCamera.rotationQuaternion = yawRotation.multiply(
      xrCamera.rotationQuaternion || Quaternion.Identity()
    );

    if (scene.xrOrigin) {
      scene.xrOrigin.rotation.y += angle;
    }

    menu.refreshMenuPosition();
  }

  scene.onBeforeRenderObservable.add(() => {
    mirrorSetup?.updateMirrorPlane();

    if (!scene.playerMesh || !scene.activeCamera) return;

    const inXR = isInXR(scene);
    if (mirrorSetup) {
      mirrorSetup.mirrorTex.refreshRate = inXR ? 1 : 2;
    }

    if (inXR) {
      const xrCamera = scene.xrHelper.baseExperience.camera;
      const dt = scene.getEngine().getDeltaTime() / 1000;
      let moveX = 0;
      let moveY = 0;
      let turnX = 0;

      for (const controller of scene.xrHelper.input.controllers) {
        if (!controller.inputSource?.gamepad?.axes?.length) continue;

        const axes = getThumbstickAxes(controller);
        const handedness = controller.inputSource?.handedness;

        if (handedness === "right") {
          turnX = axes.x;
          continue;
        }

        if (Math.abs(axes.x) > 0.1 || Math.abs(axes.y) > 0.1) {
          moveX = axes.x;
          moveY = axes.y;
        }
      }

      if (Math.abs(turnX) > settings.xrTurnDeadzone) {
        if (settings.xrTurnMode === "smooth") {
          rotateXRView(turnX * settings.xrSmoothTurnSpeed * dt);
        } else {
          const now = performance.now();
          if (now - lastSnapTurnAt > settings.xrSnapTurnCooldownMs) {
            rotateXRView(Math.sign(turnX) * settings.xrSnapTurnAngle);
            lastSnapTurnAt = now;
          }
        }
      }

      if (xrMode === "smooth") {
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
            move.normalize().scaleInPlace(settings.xrMoveSpeed * dt);
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
    const moveSpeed = desktopKeys.has("shift")
      ? settings.desktopSprintSpeed
      : settings.desktopMoveSpeed;

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

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (MOVE_KEYS.includes(key)) {
      desktopKeys.add(key);
      e.preventDefault();
    }

    if (e.key === "Escape") {
      scene.toggleMenu();
    }

    if (key === "m" && isInXR(scene)) {
      scene.navigation.toggleXRMode();
      applyXRMovementMode();
    }
  });

  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS.includes(key)) {
      desktopKeys.delete(key);
      e.preventDefault();
    }
  });

  return { xr, menu, applyXRMovementMode };
}

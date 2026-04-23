import {
  Axis,
  Color3,
  Mesh,
  MeshBuilder,
  MirrorTexture,
  Plane,
  PhysicsImpostor,
  PointerEventTypes,
  Quaternion,
  Ray,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
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

const PUSH_TO_TALK_KEY = "v";
const PUSH_TO_TALK_FACE_BUTTON_IDS = new Set([
  "b-button",
  "y-button",
  "button-b",
  "button-y",
]);

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

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.();
  return tagName === "input" || tagName === "textarea" || target?.isContentEditable;
}

function worldToLocalPosition(node, worldPos) {
  const inv = node.getWorldMatrix().clone();
  inv.invert();
  return Vector3.TransformCoordinates(worldPos, inv);
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

function setupDartInteractions(scene, xr, options = {}) {
  const xrGripStates = new Map();
  const xrHeldDarts = new Map();
  const xrMotionSamples = new Map();
  const flyingDarts = new Set();
  const dartFlightPositions = new Map();
  const dartScore = {
    activePlayer: 0,
    turnThrows: 0,
    throwsPerTurn: 3,
    gameOver: false,
    players: [
      { name: "Player 1", remaining: 300 },
      { name: "Player 2", remaining: 300 },
    ],
    hitBoard: null,
    hitText: null,
    gameBoard: null,
    playerTexts: [],
    statusText: null,
  };
  const desktopHold = {
    root: null,
    anchor: null,
    viewRoot: null,
    charging: false,
    chargeStartedAt: 0,
  };

  const desktopChargeMaxMs = 1600;
  const desktopMinThrowSpeed = 4.5;
  const desktopMaxThrowSpeed = 13;
  const dartGamePanelTransform = options.dartGamePanelTransform || null;
  const dartFlightRotationOffset = Quaternion.FromEulerAngles(0, Math.PI, 0);
  const desktopHeldDartRotation = Quaternion.FromEulerAngles(0.35, 0, -0.22);
  const dartBoardScoreRings = [
    { maxRadius: 0.12, points: 50, label: "Bullseye" },
    { maxRadius: 0.28, points: 40, label: "Inner Red" },
    { maxRadius: 0.52, points: 30, label: "Inner Gray" },
    { maxRadius: 0.78, points: 20, label: "Outer Red" },
    { maxRadius: 1.05, points: 10, label: "Outer Gray" },
  ];

  function getDartRoot(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.isThrowableDart) {
        return current.metadata.dartRoot || current;
      }
      current = current.parent;
    }
    return null;
  }

  function getDartBoardRoot(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.isDartBoardTarget) {
        return current.metadata.dartBoardRoot || current;
      }
      current = current.parent;
    }
    return null;
  }

  function isSceneCollider(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.isSceneCollider) return true;
      current = current.parent;
    }
    return false;
  }

  function setDartPickable(root, isPickable) {
    root.isPickable = isPickable;
    for (const child of root.getChildMeshes(false)) {
      child.isPickable = isPickable;
    }
  }

  function setDartVisible(root, isVisible) {
    root.setEnabled(isVisible);
  }

  function cloneDartForDesktopView(root) {
    const viewRoot = root.clone(`${root.name}_desktopView`, null, false);
    viewRoot.isPickable = false;
    viewRoot.metadata = {
      isDesktopHeldDartView: true,
      sourceDart: root,
    };
    viewRoot.setEnabled(true);

    for (const mesh of viewRoot.getChildMeshes(false)) {
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.metadata = {
        ...(mesh.metadata || {}),
        isDesktopHeldDartView: true,
        sourceDart: root,
      };
    }

    return viewRoot;
  }

  function disposeDesktopDartView() {
    desktopHold.viewRoot?.dispose(false, false);
    desktopHold.viewRoot = null;
  }

  function pickDartWithRay(ray) {
    const pick = scene.pickWithRay(ray, (mesh) => !!getDartRoot(mesh));
    return pick?.hit ? getDartRoot(pick.pickedMesh) : null;
  }

  function pickDesktopDart() {
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !!getDartRoot(mesh));
    return pick?.hit ? getDartRoot(pick.pickedMesh) : null;
  }

  function getControllerRay(controller) {
    const pointer = controller.pointer || controller.grip;
    if (!pointer) return null;

    const origin = pointer.getAbsolutePosition();
    const direction = pointer.getDirection(Axis.Z);
    if (direction.lengthSquared() < 0.0001) return null;

    direction.normalize();
    return new Ray(origin, direction, 6);
  }

  function isGripPressed(controller) {
    const components = controller.motionController?.components || {};
    for (const [id, component] of Object.entries(components)) {
      const normalizedId = id.toLowerCase();
      if (
        normalizedId.includes("squeeze") ||
        normalizedId.includes("grip") ||
        normalizedId === "xr-standard-squeeze"
      ) {
        return !!component.pressed;
      }
    }

    const squeezeButton = controller.inputSource?.gamepad?.buttons?.[1];
    return !!squeezeButton?.pressed;
  }

  function disposeDartPhysics(root) {
    if (root.physicsImpostor) {
      root.physicsImpostor.dispose();
      root.physicsImpostor = null;
    }
  }

  function ensureDartPhysics(root) {
    if (!root.physicsImpostor) {
      root.physicsImpostor = new PhysicsImpostor(
        root,
        PhysicsImpostor.BoxImpostor,
        { mass: 0.08, restitution: 0.15, friction: 0.6 },
        scene
      );
    }
    return root.physicsImpostor;
  }

  function alignDartWithVelocity(root, velocity) {
    if (!root || !velocity || velocity.lengthSquared() < 0.01) return;

    const direction = velocity.normalizeToNew();
    root.rotationQuaternion = Quaternion
      .FromLookDirectionLH(direction, Vector3.Up())
      .multiply(dartFlightRotationOffset);
  }

  function getDartTipOffset(root, direction) {
    root.computeWorldMatrix(true);
    const origin = root.getAbsolutePosition();
    let bestProjection = -Infinity;

    for (const mesh of [root, ...root.getChildMeshes(false)]) {
      const positions = mesh.getVerticesData?.(VertexBuffer.PositionKind);
      if (!positions?.length) continue;

      const matrix = mesh.computeWorldMatrix(true);
      for (let index = 0; index < positions.length; index += 3) {
        const vertex = Vector3.TransformCoordinates(
          new Vector3(positions[index], positions[index + 1], positions[index + 2]),
          matrix
        );
        bestProjection = Math.max(
          bestProjection,
          Vector3.Dot(vertex.subtract(origin), direction)
        );
      }
    }

    if (Number.isFinite(bestProjection)) {
      return direction.scale(Math.max(bestProjection, 0.04));
    }

    return direction.scale(0.16);
  }

  function getDartBoardFrame(boardRoot, pick) {
    const bounds = boardRoot.getHierarchyBoundingVectors(true);
    const center = bounds.min.add(bounds.max).scale(0.5);
    let normal = boardRoot.getDirection(Axis.Z);

    if (!normal || normal.lengthSquared() < 0.0001) {
      normal = pick?.getNormal?.(true, true);
    }

    normal = normal.normalizeToNew();
    let right = boardRoot.getDirection(Axis.X);
    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Cross(Vector3.Up(), normal);
    }
    right.normalize();

    const cameraPosition = scene.xrHelper?.baseExperience?.camera?.globalPosition ??
      scene.activeCamera?.globalPosition ??
      scene.activeCamera?.position;
    let faceNormal = normal.clone();
    if (cameraPosition) {
      const toCamera = cameraPosition.subtract(center);
      if (toCamera.lengthSquared() > 0.0001 && Vector3.Dot(faceNormal, toCamera) < 0) {
        faceNormal.scaleInPlace(-1);
      }
    }

    const corners = [
      new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ];

    let radius = 0;
    for (const corner of corners) {
      const offset = corner.subtract(center);
      const planarOffset = offset.subtract(normal.scale(Vector3.Dot(offset, normal)));
      radius = Math.max(radius, planarOffset.length());
    }

    return {
      center,
      normal,
      faceNormal,
      right,
      radius: Math.max(radius, 0.001),
    };
  }

  function getDartBoardScore(boardRoot, pick) {
    if (!boardRoot || !pick?.pickedPoint) {
      return { points: 0, label: "Miss", normalizedRadius: 1 };
    }

    const { center, normal, radius } = getDartBoardFrame(boardRoot, pick);
    const offset = pick.pickedPoint.subtract(center);
    const planarOffset = offset.subtract(normal.scale(Vector3.Dot(offset, normal)));
    const normalizedRadius = planarOffset.length() / radius;
    const ring = dartBoardScoreRings.find((section) => normalizedRadius <= section.maxRadius);

    return {
      points: ring?.points ?? 0,
      label: ring?.label ?? "Miss",
      normalizedRadius,
      center,
      normal,
    };
  }

  function ensureDartScoreDisplay(boardRoot, pick) {
    if (dartScore.hitBoard && dartScore.hitText && dartScore.gameBoard) return;

    const frame = getDartBoardFrame(boardRoot, pick);
    const hitBoard = MeshBuilder.CreatePlane(
      "dartHitBoard",
      { width: 1.35, height: 0.42 },
      scene
    );
    hitBoard.billboardMode = Mesh.BILLBOARDMODE_ALL;
    hitBoard.position.copyFrom(
      frame.center
        .add(Vector3.Up().scale(frame.radius * 1.08))
        .add(frame.faceNormal.scale(0.12))
    );
    hitBoard.isPickable = false;

    const hitTexture = GUI.AdvancedDynamicTexture.CreateForMesh(hitBoard, 768, 240, false);
    const hitText = new GUI.TextBlock("dartHitText");
    hitText.color = "white";
    hitText.fontFamily = "Arial";
    hitText.fontSize = 58;
    hitText.textWrapping = true;
    hitText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    hitText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    hitText.text = "Ready";
    hitTexture.addControl(hitText);

    const gameBoard = MeshBuilder.CreatePlane(
      "dartGameBoard",
      { width: 1.65, height: 1.05 },
      scene
    );
    if (dartGamePanelTransform?.position) {
      gameBoard.position.copyFrom(dartGamePanelTransform.position);
    } else {
      gameBoard.position.copyFrom(
        frame.center
          .add(frame.right.scale(-(frame.radius + 2.6)))
          .add(frame.faceNormal.scale(0.14))
      );
    }

    if (dartGamePanelTransform?.rotationQuaternion) {
      gameBoard.rotationQuaternion = dartGamePanelTransform.rotationQuaternion.clone();
    } else if (dartGamePanelTransform?.rotation) {
      gameBoard.rotationQuaternion = null;
      gameBoard.rotation.copyFrom(dartGamePanelTransform.rotation);
    } else {
      gameBoard.rotationQuaternion = Quaternion.FromLookDirectionLH(frame.faceNormal, Vector3.Up());
    }

    if (dartGamePanelTransform?.scaling) {
      gameBoard.scaling.copyFrom(dartGamePanelTransform.scaling);
    }
    gameBoard.isPickable = false;

    const gameTexture = GUI.AdvancedDynamicTexture.CreateForMesh(gameBoard, 1024, 640, false);
    const panel = new GUI.Rectangle("dartGamePanel");
    panel.width = "100%";
    panel.height = "100%";
    panel.thickness = 3;
    panel.cornerRadius = 16;
    panel.color = "#d8e6f3";
    panel.background = "#101820E6";
    gameTexture.addControl(panel);

    const grid = new GUI.Grid("dartGameGrid");
    grid.addColumnDefinition(0.5);
    grid.addColumnDefinition(0.5);
    grid.addRowDefinition(0.72);
    grid.addRowDefinition(0.28);
    panel.addControl(grid);

    const playerTexts = dartScore.players.map((player, index) => {
      const text = new GUI.TextBlock(`dartPlayer${index + 1}Text`);
      text.color = "white";
      text.fontFamily = "Arial";
      text.fontSize = 66;
      text.textWrapping = true;
      text.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
      text.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
      grid.addControl(text, 0, index);
      return text;
    });

    const divider = new GUI.Rectangle("dartGameDivider");
    divider.width = "2px";
    divider.height = "72%";
    divider.color = "#d8e6f3";
    divider.background = "#d8e6f3";
    divider.thickness = 0;
    divider.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    divider.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
    panel.addControl(divider);

    const statusText = new GUI.TextBlock("dartGameStatusText");
    statusText.height = "28%";
    statusText.top = "36%";
    statusText.color = "#d8e6f3";
    statusText.fontFamily = "Arial";
    statusText.fontSize = 44;
    statusText.textWrapping = true;
    statusText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    statusText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    panel.addControl(statusText);

    dartScore.hitBoard = hitBoard;
    dartScore.hitText = hitText;
    dartScore.gameBoard = gameBoard;
    dartScore.playerTexts = playerTexts;
    dartScore.statusText = statusText;
    updateDartGameDisplay("Player 1 throws");
  }

  function updateDartGameDisplay(status = null) {
    if (!dartScore.playerTexts.length || !dartScore.statusText) return;

    for (let index = 0; index < dartScore.players.length; index += 1) {
      const player = dartScore.players[index];
      const activePrefix = index === dartScore.activePlayer ? "> " : "";
      dartScore.playerTexts[index].text = `${activePrefix}${player.name}\n${player.remaining}`;
      dartScore.playerTexts[index].color = index === dartScore.activePlayer ? "#7dd3fc" : "white";
    }

    const player = dartScore.players[dartScore.activePlayer];
    const throwLabel = `Dart ${dartScore.turnThrows + 1}/${dartScore.throwsPerTurn}`;
    dartScore.statusText.text = status || `${player.name} throws\n${throwLabel}`;
  }

  function findDartBoardRoot() {
    for (const mesh of scene.meshes) {
      const boardRoot = getDartBoardRoot(mesh);
      if (boardRoot) return boardRoot;
    }
    return null;
  }

  function initializeDartGameDisplay() {
    const boardRoot = findDartBoardRoot();
    if (boardRoot) {
      ensureDartScoreDisplay(boardRoot, null);
    }
  }

  function registerDartThrow(root) {
    if (!root || dartScore.gameOver) return;

    const throwingPlayerIndex = dartScore.activePlayer;
    root.metadata = {
      ...(root.metadata || {}),
      dartThrowPlayerIndex: throwingPlayerIndex,
    };

    dartScore.turnThrows += 1;
    let status = `${dartScore.players[throwingPlayerIndex].name} threw dart ${dartScore.turnThrows}/${dartScore.throwsPerTurn}`;

    if (dartScore.turnThrows >= dartScore.throwsPerTurn) {
      dartScore.turnThrows = 0;
      dartScore.activePlayer = (dartScore.activePlayer + 1) % dartScore.players.length;
      status = `${dartScore.players[dartScore.activePlayer].name} throws`;
    }

    updateDartGameDisplay(status);
  }

  function recordDartBoardScore(root, boardRoot, pick) {
    const score = getDartBoardScore(boardRoot, pick);
    ensureDartScoreDisplay(boardRoot, pick);

    const scoringPlayerIndex = root?.metadata?.dartThrowPlayerIndex ?? dartScore.activePlayer;
    const player = dartScore.players[scoringPlayerIndex];
    const nextRemaining = player.remaining - score.points;
    let status = `${player.name}: ${score.label} -${score.points}`;

    if (dartScore.gameOver) {
      status = "Game over";
    } else if (nextRemaining < 0) {
      status = `${player.name} busts on ${score.label}`;
    } else {
      player.remaining = nextRemaining;
      if (nextRemaining === 0) {
        status = `${player.name} wins`;
        dartScore.gameOver = true;
        dartScore.activePlayer = scoringPlayerIndex;
      }
    }

    if (dartScore.hitText) {
      dartScore.hitText.text = `${score.label}\n${score.points} points`;
    }

    updateDartGameDisplay(status);
    console.log(`[DART] ${status}`);
    return score;
  }

  function stickDartToBoard(root, pick, velocity) {
    const boardRoot = getDartBoardRoot(pick.pickedMesh);
    if (!root || !boardRoot || !pick.pickedPoint) return false;

    disposeDartPhysics(root);
    flyingDarts.delete(root);
    dartFlightPositions.delete(root);

    root.setParent(null);
    const velocityDirection = velocity.normalizeToNew();
    const surfaceNormal = pick.getNormal?.(true, true);
    const impactDirection = surfaceNormal?.lengthSquared?.() > 0.0001
      ? surfaceNormal.normalizeToNew().scale(Vector3.Dot(surfaceNormal, velocityDirection) >= 0 ? 1 : -1)
      : velocityDirection;
    alignDartWithVelocity(root, impactDirection);
    root.computeWorldMatrix(true);
    const tipOffset = getDartTipOffset(root, impactDirection);
    const embedDepth = 0.045;
    root.position.copyFrom(
      pick.pickedPoint
        .subtract(tipOffset)
        .add(impactDirection.scale(embedDepth))
    );
    setDartPickable(root, false);

    root.setParent(null);
    recordDartBoardScore(root, boardRoot, pick);
    console.log("[DART] Stuck to dart board");
    return true;
  }

  function stopDartAtSceneCollider(root, pick, velocity) {
    if (!root || !pick?.pickedPoint || !velocity || velocity.lengthSquared() < 0.01) return false;

    disposeDartPhysics(root);
    flyingDarts.delete(root);
    dartFlightPositions.delete(root);

    root.setParent(null);
    const impactDirection = velocity.normalizeToNew();
    alignDartWithVelocity(root, impactDirection);
    root.computeWorldMatrix(true);

    const surfaceNormal = pick.getNormal?.(true, true);
    const lift = surfaceNormal?.lengthSquared?.() > 0.0001
      ? surfaceNormal.normalizeToNew().scale(0.025)
      : Vector3.Zero();
    const tipOffset = getDartTipOffset(root, impactDirection);

    root.position.copyFrom(
      pick.pickedPoint
        .subtract(tipOffset)
        .add(lift)
    );
    setDartPickable(root, true);
    console.log("[DART] Hit scene collider");
    return true;
  }

  function tryStopDartAtSceneCollider(root, velocity) {
    if (!root || !velocity || velocity.lengthSquared() < 0.2) return false;

    const currentPosition = root.getAbsolutePosition();
    const previousPosition = dartFlightPositions.get(root) || currentPosition;
    const delta = currentPosition.subtract(previousPosition);
    const speed = velocity.length();
    const direction = delta.lengthSquared() > 0.0001
      ? delta.normalizeToNew()
      : velocity.normalizeToNew();
    const frameDistance = Math.max(
      delta.length(),
      speed * scene.getEngine().getDeltaTime() / 1000
    );
    const ray = new Ray(previousPosition, direction, frameDistance + 0.3);
    const pick = scene.pickWithRay(ray, (mesh) => (
      isSceneCollider(mesh) &&
      !getDartRoot(mesh) &&
      !getDartBoardRoot(mesh)
    ));

    if (!pick?.hit) {
      dartFlightPositions.set(root, currentPosition.clone());
      return false;
    }

    return stopDartAtSceneCollider(root, pick, velocity);
  }

  function tryStickDartToBoard(root, velocity) {
    if (!root || !velocity || velocity.lengthSquared() < 0.2) return false;

    const direction = velocity.normalizeToNew();
    const speed = velocity.length();
    const rayLength = Math.max(0.35, speed * scene.getEngine().getDeltaTime() / 1000 + 0.2);
    const origin = root.absolutePosition || root.getAbsolutePosition();
    const ray = new Ray(origin, direction, rayLength);
    const pick = scene.pickWithRay(ray, (mesh) => !!getDartBoardRoot(mesh));

    if (!pick?.hit) return false;
    return stickDartToBoard(root, pick, velocity);
  }

  function holdDartOnController(root, controller) {
    const holder = controller.grip || controller.pointer;
    if (!root || !holder) return false;

    disposeDartPhysics(root);
    dartFlightPositions.delete(root);
    setDartPickable(root, false);
    root.setParent(holder);
    root.position.set(0.035, -0.025, 0.09);
    root.rotationQuaternion = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
    return true;
  }

  function holdDartOnDesktop(root) {
    const cam = scene.activeCamera;
    if (!root || !cam) return false;

    disposeDartPhysics(root);
    dartFlightPositions.delete(root);
    setDartPickable(root, false);
    setDartVisible(root, true);

    const anchor = desktopHold.anchor || new TransformNode("desktopHeldDartAnchor", scene);
    desktopHold.anchor = anchor;
    anchor.parent = cam;
    anchor.position.set(0.22, -0.18, 0.55);
    anchor.rotationQuaternion = Quaternion.Identity();

    disposeDesktopDartView();
    const viewRoot = cloneDartForDesktopView(root);
    viewRoot.setParent(anchor);
    viewRoot.position.set(0, 0, 0);
    viewRoot.rotationQuaternion = desktopHeldDartRotation;
    viewRoot.computeWorldMatrix(true);
    const bounds = viewRoot.getHierarchyBoundingVectors(true);
    const centerWorld = bounds.min.add(bounds.max).scale(0.5);
    viewRoot.position.copyFrom(worldToLocalPosition(anchor, centerWorld).scale(-1));

    root.setParent(anchor);
    root.position.set(0.36, -0.42, 1.05);
    root.rotationQuaternion = desktopHeldDartRotation;
    desktopHold.root = root;
    desktopHold.viewRoot = viewRoot;
    desktopHold.charging = false;
    desktopHold.chargeStartedAt = 0;
    return true;
  }

  function releaseDart(root, velocity) {
    if (!root) return;

    const world = root.computeWorldMatrix(true);
    const worldPos = world.getTranslation();

    root.setParent(null);
    root.position.copyFrom(worldPos);
    alignDartWithVelocity(root, velocity);
    setDartPickable(root, true);
    registerDartThrow(root);

    const impostor = ensureDartPhysics(root);
    impostor.setLinearVelocity(velocity);
    impostor.setAngularVelocity(Vector3.Zero());
    flyingDarts.add(root);
    dartFlightPositions.set(root, worldPos.clone());
  }

  function releaseDesktopDart(root, velocity) {
    const cam = scene.activeCamera;
    if (!root || !cam) return;

    disposeDesktopDartView();

    const spawnPos = cam.globalPosition
      .add(cam.getDirection(Axis.Z).normalize().scale(0.7))
      .add(cam.getDirection(Axis.X).normalize().scale(0.18))
      .add(cam.getDirection(Axis.Y).normalize().scale(-0.12));

    root.setParent(null);
    root.position.copyFrom(spawnPos);
    setDartVisible(root, true);
    releaseDart(root, velocity);
  }

  function addControllerMotionSample(controller, controllerId) {
    const holder = controller.grip || controller.pointer;
    if (!holder) return;

    const samples = xrMotionSamples.get(controllerId) || [];
    samples.push({
      time: performance.now(),
      position: holder.getAbsolutePosition().clone(),
    });

    while (samples.length > 8) {
      samples.shift();
    }

    xrMotionSamples.set(controllerId, samples);
  }

  function getControllerThrowVelocity(controllerId, controller) {
    const samples = xrMotionSamples.get(controllerId) || [];
    const latest = samples[samples.length - 1];
    let previous = null;

    if (!latest) {
      const ray = getControllerRay(controller);
      return ray ? ray.direction.scale(5) : new Vector3(0, 1.5, 4);
    }

    for (let i = samples.length - 2; i >= 0; i -= 1) {
      if (latest.time - samples[i].time >= 45) {
        previous = samples[i];
        break;
      }
    }

    if (latest && previous) {
      const dt = Math.max((latest.time - previous.time) / 1000, 0.001);
      const velocity = latest.position.subtract(previous.position).scale(1 / dt);
      if (velocity.length() > 0.5) {
        return velocity.scale(1.15);
      }
    }

    const ray = getControllerRay(controller);
    return ray ? ray.direction.scale(5) : new Vector3(0, 1.5, 4);
  }

  function getDesktopChargeAmount() {
    if (!desktopHold.charging) return 0;
    return Math.min((performance.now() - desktopHold.chargeStartedAt) / desktopChargeMaxMs, 1);
  }

  initializeDartGameDisplay();

  scene.onPointerObservable.add((pointerInfo) => {
    if (isInXR(scene)) return;

    const button = pointerInfo.event?.button;
    if (button != null && button !== 0) return;

    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (!desktopHold.root) {
        const dart = pickDesktopDart();
        if (dart) {
          holdDartOnDesktop(dart);
        }
        return;
      }

      desktopHold.charging = true;
      desktopHold.chargeStartedAt = performance.now();
      return;
    }

    if (pointerInfo.type === PointerEventTypes.POINTERUP && desktopHold.root && desktopHold.charging) {
      const cam = scene.activeCamera;
      const charge = getDesktopChargeAmount();
      const speed = desktopMinThrowSpeed + (desktopMaxThrowSpeed - desktopMinThrowSpeed) * charge;
      const direction = cam.getDirection(Axis.Z).normalize();
      const velocity = direction.scale(speed).add(new Vector3(0, 1.2 + charge * 1.6, 0));

      releaseDesktopDart(desktopHold.root, velocity);
      desktopHold.root = null;
      desktopHold.charging = false;
      desktopHold.chargeStartedAt = 0;
    }
  });

  scene.onBeforeRenderObservable.add(() => {
    if (desktopHold.viewRoot && !isInXR(scene)) {
      const charge = getDesktopChargeAmount();
      const chargedRotation = Quaternion.FromEulerAngles(
        0.35 - charge * 0.55,
        0,
        -0.22
      );
      desktopHold.viewRoot.rotationQuaternion = chargedRotation;
      if (desktopHold.root) {
        desktopHold.root.rotationQuaternion = chargedRotation;
      }
    }

    for (const dart of Array.from(flyingDarts)) {
      const velocity = dart.physicsImpostor?.getLinearVelocity?.();
      if (!velocity || velocity.lengthSquared() < 0.2) {
        dart.physicsImpostor?.setAngularVelocity(Vector3.Zero());
        flyingDarts.delete(dart);
        dartFlightPositions.delete(dart);
        continue;
      }

      if (tryStickDartToBoard(dart, velocity)) {
        continue;
      }

      if (tryStopDartAtSceneCollider(dart, velocity)) {
        continue;
      }

      alignDartWithVelocity(dart, velocity);
      dart.physicsImpostor?.setAngularVelocity(Vector3.Zero());
    }
  });

  if (!xr) return;

  xr.baseExperience.sessionManager.onXRFrameObservable.add(() => {
    if (!isInXR(scene)) {
      xrGripStates.clear();
      xrHeldDarts.clear();
      xrMotionSamples.clear();
      return;
    }

    if (desktopHold.root) {
      disposeDesktopDartView();
      setDartVisible(desktopHold.root, true);
      setDartPickable(desktopHold.root, true);
      desktopHold.root = null;
      desktopHold.charging = false;
      desktopHold.chargeStartedAt = 0;
    }

    for (const controller of xr.input.controllers) {
      const controllerId = controller.uniqueId || controller.inputSource?.handedness || "unknown";
      const isPressed = isGripPressed(controller);
      const wasPressed = xrGripStates.get(controllerId) ?? false;

      addControllerMotionSample(controller, controllerId);

      if (isPressed && !wasPressed && !xrHeldDarts.has(controllerId)) {
        const ray = getControllerRay(controller);
        const dart = ray ? pickDartWithRay(ray) : null;
        if (dart && holdDartOnController(dart, controller)) {
          xrHeldDarts.set(controllerId, dart);
        }
      }

      if (!isPressed && wasPressed && xrHeldDarts.has(controllerId)) {
        const dart = xrHeldDarts.get(controllerId);
        const velocity = getControllerThrowVelocity(controllerId, controller);
        releaseDart(dart, velocity);
        xrHeldDarts.delete(controllerId);
      }

      xrGripStates.set(controllerId, isPressed);
    }
  });
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

  const settingsPanel = new GUI.Grid("settingsMenuGrid");
  settingsPanel.width = "97%";
  settingsPanel.height = "86%";
  settingsPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  settingsPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  settingsPanel.isVisible = false;
  for (let i = 0; i < 6; i += 1) {
    settingsPanel.addColumnDefinition(1 / 6);
  }
  settingsPanel.addRowDefinition(1);
  menuCard.addControl(settingsPanel);

  const volumePanel = new GUI.Grid("volumeMenuGrid");
  volumePanel.width = "97%";
  volumePanel.height = "86%";
  volumePanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  volumePanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  volumePanel.isVisible = false;
  for (let i = 0; i < 6; i += 1) {
    volumePanel.addColumnDefinition(1 / 6);
  }
  volumePanel.addRowDefinition(1);
  menuCard.addControl(volumePanel);

  let menuButtonIndex = 0;
  let settingsButtonIndex = 0;
  let volumeButtonIndex = 0;
  let pendingLeaveAction = null;

  function styleMenuButton(button, fontSize = 72, background = "#4e6f8d") {
    button.width = "95%";
    button.height = "96%";
    button.thickness = 2;
    button.cornerRadius = 18;
    button.color = "white";
    button.background = background;
    button.fontSize = fontSize;
    button.fontFamily = "Arial";
    button.paddingLeft = "6px";
    button.paddingRight = "6px";
    button.textBlock.textWrapping = true;
    button.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    button.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    return button;
  }

  function controlName(text, suffix) {
    return `${text.replace(/[^a-z0-9]+/gi, "_")}_${suffix}`;
  }

  function addMenuButton(text, callback) {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "btn"), text);
    styleMenuButton(button);
    button.onPointerUpObservable.add(callback);
    menuPanel.addControl(button, 0, menuButtonIndex);
    menuButtonIndex += 1;
    return button;
  }

  function addSettingsButton(text, callback) {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "settings_btn"), text);
    styleMenuButton(button);
    button.onPointerUpObservable.add(callback);
    settingsPanel.addControl(button, 0, settingsButtonIndex);
    settingsButtonIndex += 1;
    return button;
  }

  function addVolumeButton(text, callback) {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "volume_btn"), text);
    styleMenuButton(button);
    button.onPointerUpObservable.add(callback);
    volumePanel.addControl(button, 0, volumeButtonIndex);
    volumeButtonIndex += 1;
    return button;
  }

  function showMainPanel() {
    menuPanel.isVisible = true;
    settingsPanel.isVisible = false;
    volumePanel.isVisible = false;
    leaveConfirmPanel.isVisible = false;
  }

  function showSettingsPanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = true;
    volumePanel.isVisible = false;
    leaveConfirmPanel.isVisible = false;
  }

  function showVolumePanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    volumePanel.isVisible = true;
    leaveConfirmPanel.isVisible = false;
  }

  const leaveConfirmPanel = new GUI.Grid("leaveConfirmPanel");
  leaveConfirmPanel.width = "93%";
  leaveConfirmPanel.height = "82%";
  leaveConfirmPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  leaveConfirmPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  leaveConfirmPanel.isVisible = false;
  leaveConfirmPanel.addRowDefinition(0.43);
  leaveConfirmPanel.addRowDefinition(0.57);
  leaveConfirmPanel.addColumnDefinition(0.5);
  leaveConfirmPanel.addColumnDefinition(0.5);
  menuCard.addControl(leaveConfirmPanel);

  const leaveConfirmText = new GUI.TextBlock("leaveConfirmText");
  leaveConfirmText.text = "Are you sure you want to leave?";
  leaveConfirmText.color = "white";
  leaveConfirmText.fontFamily = "Arial";
  leaveConfirmText.fontSize = 82;
  leaveConfirmText.textWrapping = true;
  leaveConfirmText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  leaveConfirmText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  leaveConfirmText.columnSpan = 2;
  leaveConfirmPanel.addControl(leaveConfirmText, 0, 0);

  function showMainMenuPanel() {
    pendingLeaveAction = null;
    leaveConfirmText.text = "Are you sure you want to leave?";
    leaveYesButton.isEnabled = true;
    leaveNoButton.isEnabled = true;
    showMainPanel();
  }

  function showLeaveConfirm(action) {
    pendingLeaveAction = action;
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    volumePanel.isVisible = false;
    leaveConfirmPanel.isVisible = true;
  }

  const leaveYesButton = GUI.Button.CreateSimpleButton("leaveYes_btn", "Yes");
  styleMenuButton(leaveYesButton, 82, "#2f7d5f");
  leaveYesButton.width = "92%";
  leaveYesButton.height = "92%";
  leaveYesButton.onPointerUpObservable.add(() => {
    const action = pendingLeaveAction;
    pendingLeaveAction = null;
    if (action) action();
  });
  leaveConfirmPanel.addControl(leaveYesButton, 1, 0);

  const leaveNoButton = GUI.Button.CreateSimpleButton("leaveNo_btn", "No");
  styleMenuButton(leaveNoButton, 82, "#7c3f48");
  leaveNoButton.width = "92%";
  leaveNoButton.height = "92%";
  leaveNoButton.onPointerUpObservable.add(showMainMenuPanel);
  leaveConfirmPanel.addControl(leaveNoButton, 1, 1);

  function navigateAfterXRExit(url) {
    const baseExperience = scene.xrHelper?.baseExperience || xr?.baseExperience;

    if (!baseExperience || baseExperience.state !== WebXRState.IN_XR) {
      window.location.href = url;
      return;
    }

    leaveConfirmText.text = "Leaving VR...";
    leaveYesButton.isEnabled = false;
    leaveNoButton.isEnabled = false;

    let didNavigate = false;
    let stateObserver = null;
    let fallbackTimer = null;

    const navigate = () => {
      if (didNavigate) return;

      didNavigate = true;
      if (stateObserver) {
        baseExperience.onStateChangedObservable.remove(stateObserver);
      }
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }

      window.setTimeout(() => {
        window.location.href = url;
      }, 100);
    };

    stateObserver = baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.NOT_IN_XR) {
        navigate();
      }
    });

    fallbackTimer = window.setTimeout(navigate, 1800);

    const exitPromise = typeof baseExperience.exitXRAsync === "function"
      ? baseExperience.exitXRAsync()
      : baseExperience.sessionManager?.session?.end?.();

    if (exitPromise) {
      Promise.resolve(exitPromise).then(navigate).catch((err) => {
        console.warn("[XR] Failed to exit before navigation; leaving page anyway.", err);
        navigate();
      });
    }
  }

  function hideMenu() {
    showMainMenuPanel();
    menuBoard.setEnabled(false);
    menuVisible = false;
    menuAnchorRoot = null;
    menuHost.setParent(null);
    menuHost.setEnabled(false);
  }

  function getMicModeLabel() {
    const mode = scene.voiceControls?.getMicMode?.() || "open";
    if (mode === "muted") return "Mic Muted";
    if (mode === "pushToTalk") return "Push To Talk";
    return "Open Mic";
  }

  function updateSettingsLabels() {
    locomotionButton.textBlock.text =
      scene.navigation.xrMode === "teleport" ? "Locomotion: Teleport" : "Locomotion: Smooth";
    turnModeButton.textBlock.text =
      scene.navigation.xrTurnMode === "smooth" ? "Turning: Smooth" : "Turning: Snap";
    micModeButton.textBlock.text = getMicModeLabel();
  }

  function getVolumeLabels() {
    return scene.audioControls?.getVolumeLabels?.() || {
      scene: "Scene Vol: 100%",
      players: "Player Vol: 100%",
    };
  }

  function updateVolumeLabels() {
    const labels = getVolumeLabels();
    sceneVolumeDownButton.textBlock.text = `${labels.scene}\n-`;
    sceneVolumeUpButton.textBlock.text = `${labels.scene}\n+`;
    playerVolumeDownButton.textBlock.text = `${labels.players}\n-`;
    playerVolumeUpButton.textBlock.text = `${labels.players}\n+`;
  }

  addMenuButton("Open Server Chat", () => console.log("Open chat clicked"));
  addMenuButton("Emotes", () => console.log("Open emotes clicked"));
  addMenuButton("Settings", () => {
    updateSettingsLabels();
    showSettingsPanel();
  });
  addMenuButton("Switch Environment", () => {
    showLeaveConfirm(() => {
      navigateAfterXRExit("/choose-scene.html");
    });
  });
  addMenuButton("Exit Website", () => {
    showLeaveConfirm(() => {
      navigateAfterXRExit("https://google.com");
    });
  });
  addMenuButton("Close The Menu", hideMenu);

  const locomotionButton = addSettingsButton("Locomotion: Smooth", () => {
    const nextMode = scene.navigation.toggleXRMode();
    applyXRMovementMode();
    console.log(`[SETTINGS] XR locomotion set to ${nextMode}`);
    updateSettingsLabels();
  });

  const turnModeButton = addSettingsButton("Turning: Snap", () => {
    const nextMode = scene.navigation.toggleXRTurnMode();
    console.log(`[SETTINGS] XR turning set to ${nextMode}`);
    updateSettingsLabels();
  });

  addSettingsButton("Volume Settings", () => {
    updateVolumeLabels();
    showVolumePanel();
  });

  const micModeButton = addSettingsButton("Open Mic", () => {
    scene.voiceControls?.cycleMicMode?.();
    updateSettingsLabels();
  });

  addSettingsButton("Settings", () => {
    console.log("[SETTINGS] More settings coming soon");
  });

  addSettingsButton("Back", () => {
    showMainMenuPanel();
  });

  const sceneVolumeDownButton = addVolumeButton("Scene Vol\n-", () => {
    scene.audioControls?.adjustSceneVolume?.(-0.1);
    updateVolumeLabels();
  });

  const sceneVolumeUpButton = addVolumeButton("Scene Vol\n+", () => {
    scene.audioControls?.adjustSceneVolume?.(0.1);
    updateVolumeLabels();
  });

  const playerVolumeDownButton = addVolumeButton("Player Vol\n-", () => {
    scene.audioControls?.adjustPlayerVolume?.(-0.1);
    updateVolumeLabels();
  });

  const playerVolumeUpButton = addVolumeButton("Player Vol\n+", () => {
    scene.audioControls?.adjustPlayerVolume?.(0.1);
    updateVolumeLabels();
  });

  addVolumeButton("Volume", () => {
    console.log("[SETTINGS] Volume controls adjust in 10% steps");
  });

  addVolumeButton("Back", () => {
    updateSettingsLabels();
    showSettingsPanel();
  });

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
  const xrPushToTalkButtonStates = new Map();

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

  function isPushToTalkFaceButtonPressed(controller) {
    const motionController = controller.motionController;
    if (motionController?.components) {
      for (const [id, component] of Object.entries(motionController.components)) {
        const normalizedId = id.toLowerCase();
        if (PUSH_TO_TALK_FACE_BUTTON_IDS.has(normalizedId)) {
          return component.pressed;
        }
      }
    }

    const secondaryFaceButton = controller.inputSource?.gamepad?.buttons?.[5];
    return !!secondaryFaceButton?.pressed;
  }

  function setPushToTalkPressed(pressed) {
    scene.voiceControls?.setPushToTalkPressed?.(pressed);
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
        xrPushToTalkButtonStates.clear();
        setPushToTalkPressed(false);
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

        xrPushToTalkButtonStates.set(
          controllerId,
          isPushToTalkFaceButtonPressed(controller)
        );
      }

      setPushToTalkPressed(
        [...xrPushToTalkButtonStates.values()].some(Boolean)
      );
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
  let xrTurnMode = settings.xrTurnMode;

  scene.navigation = {
    desktopMode: "smooth",
    xrMode,
    xrTurnMode,
    toggleXRMode() {
      xrMode = xrMode === "teleport" ? "smooth" : "teleport";
      this.xrMode = xrMode;
      console.log(`[NAV] XR mode: ${xrMode}`);
      return xrMode;
    },
    toggleXRTurnMode() {
      xrTurnMode = xrTurnMode === "smooth" ? "snap" : "smooth";
      this.xrTurnMode = xrTurnMode;
      console.log(`[NAV] XR turn mode: ${xrTurnMode}`);
      return xrTurnMode;
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
  setupDartInteractions(scene, xr, options);
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
        if (scene.navigation.xrTurnMode === "smooth") {
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

    if (key === PUSH_TO_TALK_KEY && !isInXR(scene) && !isTypingTarget(e.target)) {
      scene.voiceControls?.setPushToTalkPressed?.(true);
      e.preventDefault();
    }

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
    if (key === PUSH_TO_TALK_KEY && !isInXR(scene)) {
      scene.voiceControls?.setPushToTalkPressed?.(false);
      e.preventDefault();
    }

    if (MOVE_KEYS.includes(key)) {
      desktopKeys.delete(key);
      e.preventDefault();
    }
  });

  return { xr, menu, applyXRMovementMode };
}

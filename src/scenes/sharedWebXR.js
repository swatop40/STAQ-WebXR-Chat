import {
  Axis,
  Color3,
  Mesh,
  MeshBuilder,
  Matrix,
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
  desktopMoveSpeed: 5.2,
  desktopSprintSpeed: 8.4,
  desktopLookSensitivity: 1,
  xrMoveSpeed: 3.6,
  playerStepHeight: 0.28,
  xrMoveDeadzone: 0.18,
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

function applyAxisDeadzone(value, deadzone) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;

  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * normalized;
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

function registerSharedStateReady(scene, callback) {
  if (!scene || typeof callback !== "function") return;

  if (scene.sharedStateControls) {
    callback(scene.sharedStateControls);
    return;
  }

  if (!scene._sharedStateReadyCallbacks) {
    scene._sharedStateReadyCallbacks = [];
  }

  scene._sharedStateReadyCallbacks.push(callback);
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
    restartButton: null,
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
  scene.dartInteractionState = {
    xrHeldDarts,
    desktopHold,
  };
  const dartBoardScoreRings = [
    { maxRadius: 0.12, points: 50, label: "Bullseye" },
    { maxRadius: 0.28, points: 40, label: "Inner Red" },
    { maxRadius: 0.52, points: 30, label: "Inner Gray" },
    { maxRadius: 0.78, points: 20, label: "Outer Red" },
    { maxRadius: 1.05, points: 10, label: "Outer Gray" },
  ];
  const dartLastSyncAt = new Map();
  let applyingRemoteDartGameState = false;

  function getDartStateKey(root) {
    return root?.name || null;
  }

  function serializeQuaternion(quaternion) {
    return quaternion
      ? { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
      : null;
  }

  function serializeVector3(vector) {
    return vector
      ? { x: vector.x, y: vector.y, z: vector.z }
      : null;
  }

  function serializeDartTransform(root, overrides = {}) {
    if (!root) return null;

    const matrix = root.computeWorldMatrix(true);
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    matrix.decompose(scaling, rotation, position);

    return {
      position: serializeVector3(position),
      rotation: serializeQuaternion(rotation),
      scaling: serializeVector3(scaling),
      enabled: root.isEnabled(),
      isPickable: !!root.isPickable,
      isHeld: !!root.metadata?.isHeld,
      ownerId: overrides.ownerId ?? root.metadata?.heldBy ?? null,
      ...overrides,
    };
  }

  function emitDartState(root, overrides = {}, force = false) {
    const key = getDartStateKey(root);
    const controls = scene.sharedStateControls;
    if (!key || !controls) return;

    const now = performance.now();
    if (!force && now - (dartLastSyncAt.get(key) || 0) < 80) return;
    dartLastSyncAt.set(key, now);
    controls.emit("dart", key, serializeDartTransform(root, overrides));
  }

  function emitDartGameState(force = false) {
    if (applyingRemoteDartGameState) return;

    scene.sharedStateControls?.emit("dartGame", "default", {
      activePlayer: dartScore.activePlayer,
      turnThrows: dartScore.turnThrows,
      throwsPerTurn: dartScore.throwsPerTurn,
      gameOver: dartScore.gameOver,
      players: dartScore.players.map((player) => ({ ...player })),
      hitText: dartScore.hitText?.text || "Ready",
      statusText: dartScore.statusText?.text || "Player 1 throws",
      force: !!force,
    });
  }

  function isSuppressedInteractionMesh(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.suppressSceneInteraction) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

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

  function restoreDartBaseScale(root) {
    const baseLocalScaling = root?.metadata?.baseLocalScaling;
    if (baseLocalScaling) {
      root.scaling.copyFrom(baseLocalScaling);
    }
  }

  function alignDartWithVelocity(root, velocity) {
    if (!root || !velocity || velocity.lengthSquared() < 0.01) return;

    const direction = velocity.normalizeToNew();
    const referenceUp = Math.abs(Vector3.Dot(direction, Vector3.Up())) > 0.98
      ? Vector3.Forward()
      : Vector3.Up();
    root.rotationQuaternion = Quaternion
      .FromLookDirectionLH(direction, referenceUp)
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
    gameBoard.isPickable = true;
    gameBoard.metadata = {
      ...(gameBoard.metadata || {}),
      suppressSceneInteraction: true,
    };

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

    const restartButton = GUI.Button.CreateSimpleButton("dartGameRestartButton", "Restart");
    restartButton.width = "24%";
    restartButton.height = "16%";
    restartButton.top = "36%";
    restartButton.left = "35%";
    restartButton.thickness = 2;
    restartButton.cornerRadius = 14;
    restartButton.color = "white";
    restartButton.background = "#4e6f8d";
    restartButton.fontFamily = "Arial";
    restartButton.fontSize = 34;
    restartButton.textBlock.textWrapping = true;
    restartButton.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    restartButton.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    restartButton.onPointerUpObservable.add(() => {
      resetDartGame();
    });
    panel.addControl(restartButton);

    dartScore.hitBoard = hitBoard;
    dartScore.hitText = hitText;
    dartScore.gameBoard = gameBoard;
    dartScore.playerTexts = playerTexts;
    dartScore.statusText = statusText;
    dartScore.restartButton = restartButton;
    updateDartGameDisplay("Player 1 throws");
  }

  function resetDartGame() {
    dartScore.activePlayer = 0;
    dartScore.turnThrows = 0;
    dartScore.gameOver = false;
    dartScore.players[0].remaining = 300;
    dartScore.players[1].remaining = 300;

    if (dartScore.hitText) {
      dartScore.hitText.text = "Ready";
    }

    updateDartGameDisplay("Player 1 throws");
    emitDartGameState(true);
    console.log("[DART] Game restarted");
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
    emitDartGameState();
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

  function advanceDartTurn(status = null) {
    dartScore.turnThrows = 0;
    dartScore.activePlayer = (dartScore.activePlayer + 1) % dartScore.players.length;
    updateDartGameDisplay(status || `${dartScore.players[dartScore.activePlayer].name} throws`);
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
      status = `${player.name}: Bust!`;
      if (dartScore.activePlayer === scoringPlayerIndex) {
        advanceDartTurn(`${player.name}: Bust!`);
      }
    } else {
      player.remaining = nextRemaining;
      if (nextRemaining === 0) {
        status = `${player.name} wins`;
        dartScore.gameOver = true;
        dartScore.activePlayer = scoringPlayerIndex;
      }
    }

    if (dartScore.hitText) {
      dartScore.hitText.text = nextRemaining < 0
        ? "Bust!"
        : `${score.label}\n${score.points} points`;
    }

    if (!(nextRemaining < 0 && !dartScore.gameOver)) {
      updateDartGameDisplay(status);
    }
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
    restoreDartBaseScale(root);
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
    emitDartState(root, {
      isHeld: false,
      ownerId: null,
      isPickable: false,
    }, true);
    console.log("[DART] Stuck to dart board");
    return true;
  }

  function stopDartAtSceneCollider(root, pick, velocity) {
    if (!root || !pick?.pickedPoint || !velocity || velocity.lengthSquared() < 0.01) return false;

    disposeDartPhysics(root);
    flyingDarts.delete(root);
    dartFlightPositions.delete(root);

    root.setParent(null);
    restoreDartBaseScale(root);
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
    emitDartState(root, {
      isHeld: false,
      ownerId: null,
      isPickable: true,
    }, true);
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
    root.metadata = {
      ...(root.metadata || {}),
      isHeld: true,
      heldBy: scene.sharedStateControls?.getSelfId?.() || controller.uniqueId || "xr",
    };
    emitDartState(root, { isHeld: true, ownerId: root.metadata.heldBy, isPickable: false }, true);
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
    root.metadata = {
      ...(root.metadata || {}),
      isHeld: true,
      heldBy: scene.sharedStateControls?.getSelfId?.() || "desktop",
    };
    desktopHold.root = root;
    desktopHold.viewRoot = viewRoot;
    desktopHold.charging = false;
    desktopHold.chargeStartedAt = 0;
    emitDartState(root, { isHeld: true, ownerId: root.metadata.heldBy, isPickable: false }, true);
    return true;
  }

  function releaseDart(root, velocity) {
    if (!root) return;

    const world = root.computeWorldMatrix(true);
    const worldPos = world.getTranslation();

    root.setParent(null);
    restoreDartBaseScale(root);
    root.position.copyFrom(worldPos);
    alignDartWithVelocity(root, velocity);
    setDartPickable(root, true);
    root.metadata = {
      ...(root.metadata || {}),
      isHeld: false,
      heldBy: null,
    };
    registerDartThrow(root);

    const impostor = ensureDartPhysics(root);
    impostor.setLinearVelocity(velocity);
    impostor.setAngularVelocity(Vector3.Zero());
    flyingDarts.add(root);
    dartFlightPositions.set(root, worldPos.clone());
    emitDartState(root, { isHeld: false, ownerId: null, isPickable: true }, true);
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

  function isAnyObjectHeld() {
    return !!scene.objectInteractionState?.desktopHold?.root ||
      (scene.objectInteractionState?.xrHeldObjects?.size || 0) > 0;
  }

  registerSharedStateReady(scene, (controls) => {
    const seenDarts = new Set();
    for (const mesh of scene.meshes) {
      const root = getDartRoot(mesh);
      if (!root || seenDarts.has(root)) continue;
      seenDarts.add(root);
      const key = getDartStateKey(root);
      if (!key) continue;

      controls.subscribe("dart", key, (state) => {
        if (
          !state ||
          state.ownerId === controls.getSelfId?.() ||
          state.lastActorId === controls.getSelfId?.()
        ) return;
        if (root === desktopHold.root) return;
        if ([...xrHeldDarts.values()].includes(root)) return;

        disposeDartPhysics(root);
        flyingDarts.delete(root);
        dartFlightPositions.delete(root);
        root.setParent(null);

        if (state.position) {
          root.position.copyFromFloats(state.position.x || 0, state.position.y || 0, state.position.z || 0);
        }
        if (state.rotation) {
          root.rotationQuaternion = new Quaternion(
            state.rotation.x || 0,
            state.rotation.y || 0,
            state.rotation.z || 0,
            state.rotation.w || 1
          );
        }
        if (state.scaling) {
          root.scaling.copyFromFloats(state.scaling.x || 1, state.scaling.y || 1, state.scaling.z || 1);
        } else {
          restoreDartBaseScale(root);
        }

        setDartVisible(root, state.enabled !== false);
        setDartPickable(root, state.isPickable !== false);
        root.metadata = {
          ...(root.metadata || {}),
          isHeld: !!state.isHeld,
          heldBy: state.ownerId || null,
        };
      });
    }

    controls.subscribe("dartGame", "default", (state) => {
      if (!state || !Array.isArray(state.players)) return;

      applyingRemoteDartGameState = true;
      try {
        dartScore.activePlayer = Number.isFinite(state.activePlayer) ? state.activePlayer : 0;
        dartScore.turnThrows = Number.isFinite(state.turnThrows) ? state.turnThrows : 0;
        dartScore.throwsPerTurn = Number.isFinite(state.throwsPerTurn)
          ? state.throwsPerTurn
          : dartScore.throwsPerTurn;
        dartScore.gameOver = !!state.gameOver;
        dartScore.players = state.players.map((player, index) => ({
          name: player?.name || `Player ${index + 1}`,
          remaining: Number.isFinite(player?.remaining) ? player.remaining : 300,
        }));
        if (dartScore.hitText && typeof state.hitText === "string") {
          dartScore.hitText.text = state.hitText;
        }
        updateDartGameDisplay(typeof state.statusText === "string" ? state.statusText : null);
      } finally {
        applyingRemoteDartGameState = false;
      }
    });
  });

  initializeDartGameDisplay();

  scene.onPointerObservable.add((pointerInfo) => {
    if (isInXR(scene)) return;

    const button = pointerInfo.event?.button;
    if (button != null && button !== 0) return;
    if (scene.isPointerOverSceneUI?.()) return;
    if (isSuppressedInteractionMesh(pointerInfo.pickInfo?.pickedMesh)) return;

    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (!desktopHold.root) {
        if (isAnyObjectHeld()) return;
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
      emitDartState(dart);
    }

    if (desktopHold.root) {
      emitDartState(desktopHold.root);
    }

    for (const root of xrHeldDarts.values()) {
      emitDartState(root);
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

      if (!xrHeldDarts.has(controllerId) && isAnyObjectHeld()) {
        xrGripStates.set(controllerId, isPressed);
        continue;
      }

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

function setupObjectInteractions(scene, xr) {
  const desktopHold = {
    root: null,
    anchor: null,
    charging: false,
    chargeStartedAt: 0,
  };
  const desktopHoldBasePosition = new Vector3(0.34, -0.30, 1.05);
  const desktopHoldBaseRotation = Quaternion.Identity();
  const xrGripStates = new Map();
  const xrTriggerStates = new Map();
  const xrHeldObjects = new Map();
  const xrMotionSamples = new Map();
  const desktopChargeMaxMs = 1400;
  const desktopMinThrowSpeed = 2.4;
  const desktopMaxThrowSpeed = 9.5;
  const xrDropSpeedThreshold = 1.2;
  const objectLastSyncAt = new Map();

  scene.objectInteractionState = {
    desktopHold,
    xrHeldObjects,
  };

  function getObjectStateKey(root) {
    return root?.name || null;
  }

  function serializeQuaternion(quaternion) {
    return quaternion
      ? { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
      : null;
  }

  function serializeVector3(vector) {
    return vector
      ? { x: vector.x, y: vector.y, z: vector.z }
      : null;
  }

  function getSceneInteractableRoot(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.suppressSceneInteraction) {
        return null;
      }
      if (current.metadata?.isSceneInteractable) {
        return current.metadata.interactableRoot || current;
      }
      current = current.parent;
    }
    return null;
  }

  function isSuppressedInteractionMesh(mesh) {
    let current = mesh;
    while (current) {
      if (current.metadata?.suppressSceneInteraction) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function isPickupRoot(mesh) {
    const root = getSceneInteractableRoot(mesh);
    return !!root?.metadata?.pickupEnabled;
  }

  function isActivatableRoot(mesh) {
    const root = getSceneInteractableRoot(mesh);
    return !!root?.metadata?.activateOnSelect;
  }

  function setInteractablePickable(root, isPickable) {
    root.isPickable = isPickable;
    for (const child of root.getChildMeshes(false)) {
      child.isPickable = isPickable;
    }
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

  function isTriggerPressed(controller) {
    const components = controller.motionController?.components || {};
    for (const [id, component] of Object.entries(components)) {
      const normalizedId = id.toLowerCase();
      if (
        normalizedId.includes("trigger") ||
        normalizedId === "xr-standard-trigger"
      ) {
        return !!component.pressed;
      }
    }

    const triggerButton = controller.inputSource?.gamepad?.buttons?.[0];
    return !!triggerButton?.pressed;
  }

  function pickDesktopSceneInteractable() {
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => !!getSceneInteractableRoot(mesh));
    return pick?.hit ? getSceneInteractableRoot(pick.pickedMesh) : null;
  }

  function pickDesktopInteractable() {
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => isPickupRoot(mesh));
    return pick?.hit ? getSceneInteractableRoot(pick.pickedMesh) : null;
  }

  function pickSceneInteractableWithRay(ray) {
    const pick = scene.pickWithRay(ray, (mesh) => !!getSceneInteractableRoot(mesh));
    return pick?.hit ? getSceneInteractableRoot(pick.pickedMesh) : null;
  }

  function pickInteractableWithRay(ray) {
    const pick = scene.pickWithRay(ray, (mesh) => isPickupRoot(mesh));
    return pick?.hit ? getSceneInteractableRoot(pick.pickedMesh) : null;
  }

  function captureWorldTransform(root) {
    const matrix = root.computeWorldMatrix(true);
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    matrix.decompose(scaling, rotation, position);
    return { scaling, rotation, position };
  }

  function emitObjectState(root, overrides = {}, force = false) {
    const controls = scene.sharedStateControls;
    const key = getObjectStateKey(root);
    if (!controls || !key || !root) return;

    const now = performance.now();
    if (!force && now - (objectLastSyncAt.get(key) || 0) < 80) return;
    objectLastSyncAt.set(key, now);

    const world = captureWorldTransform(root);
    controls.emit("object", key, {
      position: serializeVector3(world.position),
      rotation: serializeQuaternion(world.rotation),
      scaling: serializeVector3(world.scaling),
      enabled: root.isEnabled(),
      isPickable: !!root.isPickable,
      isHeld: !!root.metadata?.isHeld,
      ownerId: overrides.ownerId ?? root.metadata?.heldBy ?? null,
      ...overrides,
    });
  }

  function getDesktopChargeAmount() {
    if (!desktopHold.charging) return 0;
    return Math.min((performance.now() - desktopHold.chargeStartedAt) / desktopChargeMaxMs, 1);
  }

  function isAnyDartHeld() {
    return !!scene.dartInteractionState?.desktopHold?.root ||
      (scene.dartInteractionState?.xrHeldDarts?.size || 0) > 0;
  }

  function isAnyObjectHeld() {
    return !!scene.objectInteractionState?.desktopHold?.root ||
      (scene.objectInteractionState?.xrHeldObjects?.size || 0) > 0;
  }

  function getControllerReleaseVelocity(controllerId, controller) {
    const samples = xrMotionSamples.get(controllerId) || [];
    const latest = samples[samples.length - 1];
    let previous = null;

    if (!latest) {
      const ray = getControllerRay(controller);
      return ray ? ray.direction.scale(xrDropSpeedThreshold) : Vector3.Zero();
    }

    for (let i = samples.length - 2; i >= 0; i -= 1) {
      if (latest.time - samples[i].time >= 45) {
        previous = samples[i];
        break;
      }
    }

    if (latest && previous) {
      const dt = Math.max((latest.time - previous.time) / 1000, 0.001);
      return latest.position.subtract(previous.position).scale(1 / dt);
    }

    return Vector3.Zero();
  }

  function captureRootBounds(root) {
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors?.(true);
    if (!bounds?.min || !bounds?.max) return null;

    const center = bounds.min.add(bounds.max).scale(0.5);
    const size = bounds.max.subtract(bounds.min);
    return { center, size };
  }

  function disposeHeldObjectPhysics(root) {
    const collider = root?.metadata?.dropPhysicsCollider;
    if (collider?.physicsImpostor) {
      collider.physicsImpostor.dispose();
      collider.physicsImpostor = null;
    }
    collider?.dispose?.(false, false);

    if (root?.metadata) {
      root.metadata.dropPhysicsCollider = null;
      root.metadata.dropPhysicsOffset = null;
      root.metadata.dropPhysicsActive = false;
    }
  }

  function ensureHeldObjectPhysics(root) {
    if (!root) return null;

    let collider = root.metadata?.dropPhysicsCollider;
    if (!collider) {
      const worldTransform = captureWorldTransform(root);
      const bounds = captureRootBounds(root);
      if (!bounds) return null;

      collider = MeshBuilder.CreateBox(
        `${root.name || "heldObject"}_dropCollider`,
        {
          width: Math.max(bounds.size.x + 0.04, 0.05),
          height: Math.max(bounds.size.y + 0.04, 0.05),
          depth: Math.max(bounds.size.z + 0.04, 0.05),
        },
        scene
      );
      collider.isVisible = false;
      collider.isPickable = false;
      collider.position.copyFrom(bounds.center);
      collider.rotationQuaternion = worldTransform.rotation.clone();

      const inverseRotation = worldTransform.rotation.clone().normalize();
      inverseRotation.conjugateInPlace();
      const inverseRotationMatrix = Matrix.Identity();
      inverseRotation.toRotationMatrix(inverseRotationMatrix);
      const localOffset = Vector3.TransformCoordinates(
        worldTransform.position.subtract(bounds.center),
        inverseRotationMatrix
      );

      root.metadata = {
        ...(root.metadata || {}),
        dropPhysicsCollider: collider,
        dropPhysicsOffset: localOffset,
      };
    }

    if (!collider.physicsImpostor) {
      collider.physicsImpostor = new PhysicsImpostor(
        collider,
        PhysicsImpostor.BoxImpostor,
        { mass: 0.35, restitution: 0.05, friction: 0.9 },
        scene
      );
    }
    return collider.physicsImpostor;
  }

  function getGrabPointLocalTransform(root, mode = "xr") {
    const grabPoint = mode === "desktop"
      ? root.metadata?.desktopGrabPointNode
      : root.metadata?.xrGrabPointNode;
    if (!grabPoint) {
      return {
        position: Vector3.Zero(),
        rotation: Quaternion.Identity(),
      };
    }

    const rotation = grabPoint.rotationQuaternion?.clone() || Quaternion.FromEulerAngles(
      grabPoint.rotation.x || 0,
      grabPoint.rotation.y || 0,
      grabPoint.rotation.z || 0
    );

    return {
      position: grabPoint.position.clone(),
      rotation,
    };
  }

  function getHolderCompensatedScale(root, holder) {
    const baseLocalScaling = root?.metadata?.baseLocalScaling?.clone?.() || root?.scaling?.clone?.() || Vector3.One();
    if (!holder?.computeWorldMatrix) {
      return baseLocalScaling;
    }

    const holderScaling = new Vector3();
    const holderRotation = new Quaternion();
    const holderPosition = new Vector3();
    holder.computeWorldMatrix(true).decompose(holderScaling, holderRotation, holderPosition);

    return new Vector3(
      Math.abs(holderScaling.x) > 0.0001 ? baseLocalScaling.x / holderScaling.x : baseLocalScaling.x,
      Math.abs(holderScaling.y) > 0.0001 ? baseLocalScaling.y / holderScaling.y : baseLocalScaling.y,
      Math.abs(holderScaling.z) > 0.0001 ? baseLocalScaling.z / holderScaling.z : baseLocalScaling.z
    );
  }

  function releaseHeldObject(root, linearVelocity = null, angularVelocity = null) {
    if (!root) return;

    const worldTransform = captureWorldTransform(root);
    root.setParent(null);
    root.position.copyFrom(worldTransform.position);
    root.scaling.copyFrom(worldTransform.scaling);
    root.rotationQuaternion = worldTransform.rotation.clone();
    const physics = ensureHeldObjectPhysics(root);
    physics?.setLinearVelocity(linearVelocity || Vector3.Zero());
    physics?.setAngularVelocity(angularVelocity || Vector3.Zero());
    if (root.metadata) {
      root.metadata.dropPhysicsActive = true;
    }
    setInteractablePickable(root, true);
    root.metadata = {
      ...(root.metadata || {}),
      isHeld: false,
      heldBy: null,
    };
    emitObjectState(root, { isHeld: false, ownerId: null }, true);
  }

  function applyHeldTransformFromGrabPoint(root, mode = "xr") {
    const grabPoint = getGrabPointLocalTransform(root, mode);
    const inverseRotation = grabPoint.rotation.clone().normalize();
    inverseRotation.conjugateInPlace();
    const inverseRotationMatrix = Matrix.Identity();
    inverseRotation.toRotationMatrix(inverseRotationMatrix);
    const scaledGrabOffset = new Vector3(
      grabPoint.position.x * root.scaling.x,
      grabPoint.position.y * root.scaling.y,
      grabPoint.position.z * root.scaling.z
    );
    const inversePosition = Vector3.TransformCoordinates(
      scaledGrabOffset.scale(-1),
      inverseRotationMatrix
    );
    root.position.copyFrom(inversePosition);
    root.rotationQuaternion = inverseRotation;
  }

  function applyDesktopChargeVisual(root, anchor) {
    if (!root || !anchor) return;

    const charge = getDesktopChargeAmount();
    anchor.position.set(
      desktopHoldBasePosition.x,
      desktopHoldBasePosition.y - 0.06 * charge,
      desktopHoldBasePosition.z - 0.22 * charge
    );
    anchor.rotationQuaternion = Quaternion.FromEulerAngles(
      -0.08 * charge,
      0,
      -0.10 * charge
    );

    applyHeldTransformFromGrabPoint(root, "desktop");
    if (charge <= 0) return;

    const chargedRotation = Quaternion.FromEulerAngles(
      0.22 - charge * 0.42,
      0,
      -0.08 - charge * 0.18
    );
    root.rotationQuaternion = root.rotationQuaternion.multiply(chargedRotation);
  }

  function holdObject(root, holder, heldBy, mode = "xr") {
    if (!root || !holder || root.metadata?.isHeld || !root.metadata?.pickupEnabled) return false;

    disposeHeldObjectPhysics(root);
    setInteractablePickable(root, false);
    root.parent = holder;
    root.scaling.copyFrom(getHolderCompensatedScale(root, holder));
    applyHeldTransformFromGrabPoint(root, mode);
    root.metadata = {
      ...(root.metadata || {}),
      isHeld: true,
      heldBy,
    };
    emitObjectState(root, { isHeld: true, ownerId: heldBy, isPickable: false }, true);
    return true;
  }

  function holdObjectOnDesktop(root) {
    const cam = scene.activeCamera;
    if (!root || !cam) return false;

    const anchor = desktopHold.anchor || new TransformNode("desktopHeldObjectAnchor", scene);
    desktopHold.anchor = anchor;
    anchor.parent = cam;
    anchor.position.copyFrom(desktopHoldBasePosition);
    anchor.rotationQuaternion = desktopHoldBaseRotation.clone();

    if (!holdObject(root, anchor, "desktop", "desktop")) return false;

    desktopHold.root = root;
    desktopHold.charging = false;
    desktopHold.chargeStartedAt = 0;
    return true;
  }

  function holdObjectOnController(root, controller) {
    const holder = controller.grip || controller.pointer;
    if (!holder) return false;
    return holdObject(root, holder, controller.uniqueId || controller.inputSource?.handedness || "xr", "xr");
  }

  function releaseDesktopObject() {
    if (!desktopHold.root) return;
    releaseHeldObject(desktopHold.root);
    desktopHold.root = null;
    desktopHold.charging = false;
    desktopHold.chargeStartedAt = 0;
    if (desktopHold.anchor) {
      desktopHold.anchor.position.copyFrom(desktopHoldBasePosition);
      desktopHold.anchor.rotationQuaternion = desktopHoldBaseRotation.clone();
    }
  }

  function throwDesktopObject(root) {
    const cam = scene.activeCamera;
    if (!root || !cam) return;

    const charge = getDesktopChargeAmount();
    const speed = desktopMinThrowSpeed + (desktopMaxThrowSpeed - desktopMinThrowSpeed) * charge;
    const direction = cam.getDirection(Axis.Z).normalize();
    const velocity = direction.scale(speed).add(new Vector3(0, 0.35 + charge * 0.8, 0));

    releaseHeldObject(root, velocity, Vector3.Zero());
    desktopHold.root = null;
    desktopHold.charging = false;
    desktopHold.chargeStartedAt = 0;
    if (desktopHold.anchor) {
      desktopHold.anchor.position.copyFrom(desktopHoldBasePosition);
      desktopHold.anchor.rotationQuaternion = desktopHoldBaseRotation.clone();
    }
  }

  registerSharedStateReady(scene, (controls) => {
    const seenRoots = new Set();
    for (const mesh of scene.meshes) {
      const root = getSceneInteractableRoot(mesh);
      if (!root || !root.metadata?.pickupEnabled || seenRoots.has(root)) continue;
      seenRoots.add(root);

      const key = getObjectStateKey(root);
      if (!key) continue;

      controls.subscribe("object", key, (state) => {
        if (
          !state ||
          state.ownerId === controls.getSelfId?.() ||
          state.lastActorId === controls.getSelfId?.()
        ) return;
        if (root === desktopHold.root) return;
        if ([...xrHeldObjects.values()].includes(root)) return;

        disposeHeldObjectPhysics(root);
        root.setParent(null);

        if (state.position) {
          root.position.copyFromFloats(state.position.x || 0, state.position.y || 0, state.position.z || 0);
        }
        if (state.rotation) {
          root.rotationQuaternion = new Quaternion(
            state.rotation.x || 0,
            state.rotation.y || 0,
            state.rotation.z || 0,
            state.rotation.w || 1
          );
        }
        if (state.scaling) {
          root.scaling.copyFromFloats(state.scaling.x || 1, state.scaling.y || 1, state.scaling.z || 1);
        } else if (root.metadata?.baseLocalScaling) {
          root.scaling.copyFrom(root.metadata.baseLocalScaling);
        }

        root.setEnabled(state.enabled !== false);
        setInteractablePickable(root, state.isPickable !== false);
        root.metadata = {
          ...(root.metadata || {}),
          isHeld: !!state.isHeld,
          heldBy: state.ownerId || null,
          dropPhysicsActive: false,
        };
      });
    }
  });

  scene.onPointerObservable.add((pointerInfo) => {
    if (isInXR(scene)) return;

    const button = pointerInfo.event?.button;
    if (button != null && button !== 0) {
      return;
    }

    if (scene.isPointerOverSceneUI?.()) return;
    if (isSuppressedInteractionMesh(pointerInfo.pickInfo?.pickedMesh)) {
      return;
    }

    if (scene.dartInteractionState?.desktopHold?.root) return;

    if (desktopHold.root) {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        desktopHold.charging = true;
        desktopHold.chargeStartedAt = performance.now();
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP && desktopHold.charging) {
        throwDesktopObject(desktopHold.root);
      }
      return;
    }

    if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) {
      return;
    }

    const root = pickDesktopSceneInteractable();
    if (!root) return;

    if (root.metadata?.activateOnSelect && !root.metadata?.pickupEnabled) {
      root.metadata.onActivate?.(root, { mode: "desktop" });
      return;
    }

    if (root.metadata?.pickupEnabled) {
      if (isAnyDartHeld()) return;
      holdObjectOnDesktop(root);
    }
  });

  scene.onBeforeRenderObservable.add(() => {
    if (desktopHold.root && !isInXR(scene)) {
      applyDesktopChargeVisual(desktopHold.root, desktopHold.anchor);
      emitObjectState(desktopHold.root);
    }

    const syncedRoots = new Set();
    for (const mesh of scene.meshes) {
      const root = mesh?.metadata?.interactableRoot || null;
      if (!root?.metadata?.dropPhysicsActive || syncedRoots.has(root)) continue;
      syncedRoots.add(root);

      const collider = root.metadata.dropPhysicsCollider;
      if (!collider) continue;

      const colliderMatrix = collider.computeWorldMatrix(true);
      const colliderScaling = new Vector3();
      const colliderRotation = new Quaternion();
      const colliderPosition = new Vector3();
      colliderMatrix.decompose(colliderScaling, colliderRotation, colliderPosition);

      const offset = root.metadata.dropPhysicsOffset || Vector3.Zero();
      const rotationMatrix = Matrix.Identity();
      colliderRotation.toRotationMatrix(rotationMatrix);
      const rotatedOffset = Vector3.TransformCoordinates(offset, rotationMatrix);

      root.position.copyFrom(colliderPosition.add(rotatedOffset));
      root.rotationQuaternion = colliderRotation.clone();
      emitObjectState(root);
    }

    if (desktopHold.root && isInXR(scene)) {
      releaseDesktopObject();
    }

    for (const root of xrHeldObjects.values()) {
      emitObjectState(root);
    }
  });

  if (!xr) return;

  xr.baseExperience.sessionManager.onXRFrameObservable.add(() => {
    if (!isInXR(scene)) {
      for (const root of xrHeldObjects.values()) {
        releaseHeldObject(root);
      }
      xrGripStates.clear();
      xrTriggerStates.clear();
      xrHeldObjects.clear();
      xrMotionSamples.clear();
      return;
    }

    for (const controller of xr.input.controllers) {
      const controllerId = controller.uniqueId || controller.inputSource?.handedness || "unknown";
      const isPressed = isGripPressed(controller);
      const wasPressed = xrGripStates.get(controllerId) ?? false;
      const isTriggerDown = isTriggerPressed(controller);
      const wasTriggerDown = xrTriggerStates.get(controllerId) ?? false;

      addControllerMotionSample(controller, controllerId);

      if (scene.dartInteractionState?.xrHeldDarts?.has(controllerId)) {
        xrGripStates.set(controllerId, isPressed);
        xrTriggerStates.set(controllerId, isTriggerDown);
        continue;
      }

      if (!xrHeldObjects.has(controllerId) && isAnyDartHeld()) {
        xrGripStates.set(controllerId, isPressed);
        xrTriggerStates.set(controllerId, isTriggerDown);
        continue;
      }

      if (isPressed && !wasPressed && !xrHeldObjects.has(controllerId)) {
        const ray = getControllerRay(controller);
        const root = ray ? pickInteractableWithRay(ray) : null;
        if (root && holdObjectOnController(root, controller)) {
          xrHeldObjects.set(controllerId, root);
        }
      }

      if (!isPressed && wasPressed && xrHeldObjects.has(controllerId)) {
        const root = xrHeldObjects.get(controllerId);
        const velocity = getControllerReleaseVelocity(controllerId, controller);
        if (velocity.length() >= xrDropSpeedThreshold) {
          releaseHeldObject(root, velocity, Vector3.Zero());
        } else {
          releaseHeldObject(root);
        }
        xrHeldObjects.delete(controllerId);
      }

      if (isTriggerDown && !wasTriggerDown && !xrHeldObjects.has(controllerId)) {
        const ray = getControllerRay(controller);
        const root = ray ? pickSceneInteractableWithRay(ray) : null;
        if (root?.metadata?.activateOnSelect && !root.metadata?.pickupEnabled) {
          root.metadata.onActivate?.(root, { mode: "xr", controller });
        }
      }

      xrGripStates.set(controllerId, isPressed);
      xrTriggerStates.set(controllerId, isTriggerDown);
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
  menuBoard.metadata = {
    ...(menuBoard.metadata || {}),
    suppressSceneInteraction: true,
  };
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

  const desktopControlsPanel = new GUI.Grid("desktopControlsGrid");
  desktopControlsPanel.width = "97%";
  desktopControlsPanel.height = "86%";
  desktopControlsPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  desktopControlsPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  desktopControlsPanel.isVisible = false;
  for (let i = 0; i < 6; i += 1) {
    desktopControlsPanel.addColumnDefinition(1 / 6);
  }
  desktopControlsPanel.addRowDefinition(1);
  menuCard.addControl(desktopControlsPanel);

  const vrControlsPanel = new GUI.Grid("vrControlsGrid");
  vrControlsPanel.width = "97%";
  vrControlsPanel.height = "86%";
  vrControlsPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  vrControlsPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  vrControlsPanel.isVisible = false;
  for (let i = 0; i < 6; i += 1) {
    vrControlsPanel.addColumnDefinition(1 / 6);
  }
  vrControlsPanel.addRowDefinition(1);
  menuCard.addControl(vrControlsPanel);

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

  const listBoard = MeshBuilder.CreatePlane(
    "menuListBoard",
    { width: 1.98, height: 0.92, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );
  listBoard.parent = menuHost;
  listBoard.position.set(0, 0.66, 0.02);
  listBoard.isPickable = true;
  listBoard.metadata = {
    ...(listBoard.metadata || {}),
    suppressSceneInteraction: true,
  };
  listBoard.setEnabled(false);

  const listTexture = GUI.AdvancedDynamicTexture.CreateForMesh(
    listBoard,
    3328,
    1536,
    false
  );

  const listCard = new GUI.Rectangle("menuListCard");
  listCard.width = "99.2%";
  listCard.height = "94%";
  listCard.thickness = 3;
  listCard.cornerRadius = 28;
  listCard.color = "#bfd0df";
  listCard.background = "#0d1a29F2";
  listTexture.addControl(listCard);

  const mutePanel = new GUI.Grid("muteMenuGrid");
  mutePanel.width = "97%";
  mutePanel.height = "88%";
  mutePanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  mutePanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  mutePanel.isVisible = false;
  for (let i = 0; i < 4; i += 1) {
    mutePanel.addColumnDefinition(1 / 4);
  }
  mutePanel.addRowDefinition(0.5);
  mutePanel.addRowDefinition(0.5);
  listCard.addControl(mutePanel);

  const chatPanel = new GUI.Grid("chatMenuGrid");
  chatPanel.width = "97%";
  chatPanel.height = "88%";
  chatPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  chatPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  chatPanel.isVisible = false;
  chatPanel.addRowDefinition(0.66);
  chatPanel.addRowDefinition(0.16);
  chatPanel.addRowDefinition(0.18);
  chatPanel.addColumnDefinition(1);
  listCard.addControl(chatPanel);

  const chatScroll = new GUI.ScrollViewer("chatScroll");
  chatScroll.width = "98%";
  chatScroll.height = "96%";
  chatScroll.thickness = 1;
  chatScroll.color = "#5f738a";
  chatScroll.background = "#08111b";
  chatScroll.barColor = "#7aa6d1";
  chatScroll.thumbLength = 0.2;
  chatPanel.addControl(chatScroll, 0, 0);

  const chatMessagesStack = new GUI.StackPanel("chatMessagesStack");
  chatMessagesStack.width = "100%";
  chatMessagesStack.isVertical = true;
  chatMessagesStack.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  chatMessagesStack.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
  chatMessagesStack.paddingLeft = "24px";
  chatMessagesStack.paddingRight = "24px";
  chatMessagesStack.paddingTop = "18px";
  chatMessagesStack.paddingBottom = "18px";
  chatScroll.addControl(chatMessagesStack);

  const chatInputGrid = new GUI.Grid("chatInputGrid");
  chatInputGrid.width = "98%";
  chatInputGrid.height = "94%";
  chatInputGrid.addColumnDefinition(0.72);
  chatInputGrid.addColumnDefinition(0.14);
  chatInputGrid.addColumnDefinition(0.14);
  chatPanel.addControl(chatInputGrid, 1, 0);

  const chatInput = new GUI.InputText("chatInput");
  chatInput.width = "96%";
  chatInput.height = "76%";
  chatInput.maxWidth = 0.96;
  chatInput.color = "white";
  chatInput.background = "#112131";
  chatInput.focusedBackground = "#172a3f";
  chatInput.focusedColor = "white";
  chatInput.thickness = 2;
  chatInput.cornerRadius = 14;
  chatInput.fontSize = 72;
  chatInput.promptMessage = "Type a message";
  chatInput.textHighlightColor = "#2563eb";
  chatInput.paddingLeft = "16px";
  chatInput.paddingRight = "16px";
  chatInput.onFocusObservable.add(() => {
    if (isInXR(scene) && keyboardBoard) {
      keyboardBoard.setEnabled(true);
    }
  });
  chatInputGrid.addControl(chatInput, 0, 0);

  const chatSendButton = GUI.Button.CreateSimpleButton("chatSendButton", "Send");
  styleMenuButton(chatSendButton, 156, "#2f7d5f");
  chatSendButton.width = "90%";
  chatSendButton.height = "76%";
  chatInputGrid.addControl(chatSendButton, 0, 1);

  const chatKeyboardButton = GUI.Button.CreateSimpleButton("chatKeyboardButton", "Keyboard");
  styleMenuButton(chatKeyboardButton, 72, "#5b6b7c");
  chatKeyboardButton.width = "90%";
  chatKeyboardButton.height = "76%";
  chatInputGrid.addControl(chatKeyboardButton, 0, 2);

  const chatControlsGrid = new GUI.Grid("chatControlsGrid");
  chatControlsGrid.width = "98%";
  chatControlsGrid.height = "90%";
  chatControlsGrid.addColumnDefinition(0.2);
  chatControlsGrid.addColumnDefinition(0.2);
  chatControlsGrid.addColumnDefinition(0.2);
  chatControlsGrid.addColumnDefinition(0.4);
  chatPanel.addControl(chatControlsGrid, 2, 0);

  const chatClearButton = GUI.Button.CreateSimpleButton("chatClearButton", "Clear");
  styleMenuButton(chatClearButton, 138, "#5b6b7c");
  chatClearButton.width = "88%";
  chatClearButton.height = "78%";
  chatControlsGrid.addControl(chatClearButton, 0, 0);

  const chatBackButton = GUI.Button.CreateSimpleButton("chatBackButton", "Back");
  styleMenuButton(chatBackButton, 138, "#5b6b7c");
  chatBackButton.width = "88%";
  chatBackButton.height = "78%";
  chatControlsGrid.addControl(chatBackButton, 0, 1);

  const chatHintText = new GUI.TextBlock("chatHintText");
  chatHintText.text = "Desktop: type here";
  chatHintText.color = "#d8e6f3";
  chatHintText.fontFamily = "Arial";
  chatHintText.fontSize = 0;
  chatHintText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
  chatHintText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  chatHintText.paddingLeft = "14px";
  chatHintText.columnSpan = 2;
  chatControlsGrid.addControl(chatHintText, 0, 2);

  const keyboardBoard = MeshBuilder.CreatePlane(
    "menuKeyboardBoard",
    { width: 2.35, height: 1.16, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );
  keyboardBoard.parent = menuHost;
  keyboardBoard.position.set(0, -0.78, 0.02);
  keyboardBoard.isPickable = true;
  keyboardBoard.metadata = {
    ...(keyboardBoard.metadata || {}),
    suppressSceneInteraction: true,
  };
  keyboardBoard.setEnabled(false);

  const keyboardTexture = GUI.AdvancedDynamicTexture.CreateForMesh(
    keyboardBoard,
    3328,
    1180,
    false
  );

  const keyboardCard = new GUI.Rectangle("menuKeyboardCard");
  keyboardCard.width = "99.2%";
  keyboardCard.height = "94%";
  keyboardCard.thickness = 3;
  keyboardCard.cornerRadius = 28;
  keyboardCard.color = "#bfd0df";
  keyboardCard.background = "#0d1a29F2";
  keyboardTexture.addControl(keyboardCard);

  const keyboardGrid = new GUI.Grid("chatKeyboardGrid");
  keyboardGrid.width = "97%";
  keyboardGrid.height = "90%";
  keyboardGrid.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  keyboardGrid.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  for (let i = 0; i < 10; i += 1) {
    keyboardGrid.addColumnDefinition(0.1);
  }
  keyboardGrid.addRowDefinition(0.22);
  keyboardGrid.addRowDefinition(0.22);
  keyboardGrid.addRowDefinition(0.22);
  keyboardGrid.addRowDefinition(0.34);
  keyboardCard.addControl(keyboardGrid);

  let menuButtonIndex = 0;
  let settingsButtonIndex = 0;
  let desktopButtonIndex = 0;
  let vrButtonIndex = 0;
  let volumeButtonIndex = 0;
  let muteButtonIndex = 0;
  let pendingLeaveAction = null;
  const menuButtonFontSize = 76;
  const listButtonFontSize = 76;

  function styleMenuButton(button, fontSize = menuButtonFontSize, background = "#4e6f8d") {
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

  function addSettingsButton(text, callback, row = null, column = null, fontSize = menuButtonFontSize, background = "#4e6f8d") {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "settings_btn"), text);
    styleMenuButton(button, fontSize, background);
    button.onPointerUpObservable.add(callback);
    const targetIndex = row == null || column == null ? settingsButtonIndex : row * 6 + column;
    settingsPanel.addControl(button, Math.floor(targetIndex / 6), targetIndex % 6);
    settingsButtonIndex = Math.max(settingsButtonIndex, targetIndex + 1);
    return button;
  }

  function addDesktopButton(text, callback, row = null, column = null, fontSize = menuButtonFontSize, background = "#4e6f8d") {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "desktop_btn"), text);
    styleMenuButton(button, fontSize, background);
    button.onPointerUpObservable.add(callback);
    const targetIndex = row == null || column == null ? desktopButtonIndex : row * 6 + column;
    desktopControlsPanel.addControl(button, Math.floor(targetIndex / 6), targetIndex % 6);
    desktopButtonIndex = Math.max(desktopButtonIndex, targetIndex + 1);
    return button;
  }

  function addVRButton(text, callback, row = null, column = null, fontSize = menuButtonFontSize, background = "#4e6f8d") {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "vr_btn"), text);
    styleMenuButton(button, fontSize, background);
    button.onPointerUpObservable.add(callback);
    const targetIndex = row == null || column == null ? vrButtonIndex : row * 6 + column;
    vrControlsPanel.addControl(button, Math.floor(targetIndex / 6), targetIndex % 6);
    vrButtonIndex = Math.max(vrButtonIndex, targetIndex + 1);
    return button;
  }

  function addVolumeButton(text, callback, row = null, column = null, fontSize = menuButtonFontSize, background = "#4e6f8d") {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "volume_btn"), text);
    styleMenuButton(button, fontSize, background);
    button.onPointerUpObservable.add(callback);
    const targetIndex = row == null || column == null ? volumeButtonIndex : row * 6 + column;
    volumePanel.addControl(button, Math.floor(targetIndex / 6), targetIndex % 6);
    volumeButtonIndex = Math.max(volumeButtonIndex, targetIndex + 1);
    return button;
  }

  function addMuteButton(text, callback, row = null, column = null, fontSize = listButtonFontSize, background = "#4e6f8d") {
    const button = GUI.Button.CreateSimpleButton(controlName(text, "mute_btn"), text);
    styleMenuButton(button, fontSize, background);
    button.width = "76%";
    button.height = "62%";
    button.onPointerUpObservable.add(callback);
    const targetIndex = row == null || column == null ? muteButtonIndex : row * 4 + column;
    mutePanel.addControl(button, Math.floor(targetIndex / 4), targetIndex % 4);
    muteButtonIndex = Math.max(muteButtonIndex, targetIndex + 1);
    return button;
  }

  function setChatKeyboardVisible(visible) {
    keyboardBoard.setEnabled(!!visible && isInXR(scene));
    chatHintText.text = isInXR(scene)
      ? (keyboardBoard.isEnabled() ? "VR keyboard active" : "Open keyboard to type")
      : "Desktop: type here";
  }

  function sendChatMessage() {
    const text = chatInput.text || "";
    const didSend = scene.chatControls?.sendMessage?.(text);
    if (didSend) {
      chatInput.text = "";
    }
  }

  function appendChatInput(value) {
    chatInput.text = `${chatInput.text || ""}${value}`;
  }

  function getChatMessagesSignature() {
    const messages = scene.chatControls?.getMessages?.() || [];
    return messages.map((message) => message.id).join("|");
  }

  function refreshChatPanel() {
    activeListPanelMode = "chat";
    const messages = scene.chatControls?.getMessages?.() || [];

    chatMessagesStack.clearControls();

    if (!messages.length) {
      const emptyText = new GUI.TextBlock("chatMessagesEmpty");
      emptyText.text = "No messages yet";
      emptyText.color = "white";
      emptyText.fontFamily = "Arial";
      emptyText.fontSize = 126;
      emptyText.textWrapping = true;
      emptyText.resizeToFit = true;
      emptyText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
      emptyText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
      emptyText.height = "56px";
      chatMessagesStack.addControl(emptyText);
    } else {
      for (const message of messages) {
        const messageText = new GUI.TextBlock(`chatMessage_${message.id}`);
        messageText.text = `${message.senderName}: ${message.text}`;
        messageText.color = "white";
        messageText.fontFamily = "Arial";
        messageText.fontSize = 126;
        messageText.textWrapping = true;
        messageText.resizeToFit = true;
        messageText.width = 0.96;
        messageText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        messageText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        messageText.paddingBottom = "20px";
        chatMessagesStack.addControl(messageText);
      }
    }

    lastChatMessagesSignature = getChatMessagesSignature();
    chatScroll.verticalBar.value = 1;
  }

  function showChatPanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = true;
    listBoard.setEnabled(true);
    leaveConfirmPanel.isVisible = false;
    chatKeyboardButton.isVisible = true;
    chatKeyboardButton.isEnabled = isInXR(scene);
    setChatKeyboardVisible(isInXR(scene));
    refreshChatPanel();
  }

  function addKeyboardKey(label, callback, row, column, columnSpan = 1, background = "#39556f") {
    const button = GUI.Button.CreateSimpleButton(controlName(label, "chatkey_btn"), label);
    styleMenuButton(button, 120, background);
    button.width = "92%";
    button.height = "82%";
    button.onPointerUpObservable.add(callback);
    if (columnSpan > 1) {
      button.columnSpan = columnSpan;
    }
    keyboardGrid.addControl(button, row, column);
    return button;
  }

  function showMainPanel() {
    menuPanel.isVisible = true;
    settingsPanel.isVisible = false;
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = false;
  }

  function showSettingsPanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = true;
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = false;
  }

  function showDesktopControlsPanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    desktopControlsPanel.isVisible = true;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = false;
  }

  function showVRControlsPanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = true;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = false;
  }

  function showVolumePanel() {
    menuPanel.isVisible = false;
    settingsPanel.isVisible = false;
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = true;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = false;
  }

  function showMutePanel() {
    listBoard.setEnabled(true);
    mutePanel.isVisible = true;
    chatPanel.isVisible = false;
    keyboardBoard.setEnabled(false);
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
    desktopControlsPanel.isVisible = false;
    vrControlsPanel.isVisible = false;
    volumePanel.isVisible = false;
    mutePanel.isVisible = false;
    chatPanel.isVisible = false;
    listBoard.setEnabled(false);
    keyboardBoard.setEnabled(false);
    leaveConfirmPanel.isVisible = true;
  }

  const leaveYesButton = GUI.Button.CreateSimpleButton("leaveYes_btn", "Yes");
  styleMenuButton(leaveYesButton, menuButtonFontSize, "#2f7d5f");
  leaveYesButton.width = "92%";
  leaveYesButton.height = "92%";
  leaveYesButton.onPointerUpObservable.add(() => {
    const action = pendingLeaveAction;
    pendingLeaveAction = null;
    if (action) action();
  });
  leaveConfirmPanel.addControl(leaveYesButton, 1, 0);

  const leaveNoButton = GUI.Button.CreateSimpleButton("leaveNo_btn", "No");
  styleMenuButton(leaveNoButton, menuButtonFontSize, "#7c3f48");
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

  function speedLabel(value) {
    return value.toFixed(1);
  }

  function sensitivityLabel(value) {
    return `${Math.round(value * 100)}%`;
  }

  function clampSetting(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applyDesktopLookSensitivity() {
    const mouseInput = scene.desktopMouseInput;
    if (!mouseInput) return;

    const sensibility = 2000 / Math.max(settings.desktopLookSensitivity, 0.1);
    mouseInput.angularSensibilityX = sensibility;
    mouseInput.angularSensibilityY = sensibility;
  }

  let locomotionButton = null;
  let turnModeButton = null;
  let desktopSpeedDownButton = null;
  let desktopSpeedUpButton = null;
  let desktopLookDownButton = null;
  let desktopLookUpButton = null;
  let xrSpeedDownButton = null;
  let xrSpeedUpButton = null;
  let xrTurnSpeedDownButton = null;
  let xrTurnSpeedUpButton = null;
  let micModeButton = null;
  let activeListPanelMode = null;
  let lastRemotePlayersSignature = "";
  let lastChatMessagesSignature = "";

  function updateSettingsLabels() {
    if (locomotionButton) {
      locomotionButton.textBlock.text =
        scene.navigation.xrMode === "teleport" ? "Locomotion\nTeleport" : "Locomotion\nSmooth";
    }
    if (turnModeButton) {
      turnModeButton.textBlock.text =
        scene.navigation.xrTurnMode === "smooth" ? "Turning\nSmooth" : "Turning\nSnap";
    }
    if (desktopSpeedDownButton) desktopSpeedDownButton.textBlock.text = `Desktop Move\n${speedLabel(settings.desktopMoveSpeed)} -`;
    if (desktopSpeedUpButton) desktopSpeedUpButton.textBlock.text = `Desktop Move\n${speedLabel(settings.desktopMoveSpeed)} +`;
    if (desktopLookDownButton) desktopLookDownButton.textBlock.text = `Desktop Look\n${sensitivityLabel(settings.desktopLookSensitivity)} -`;
    if (desktopLookUpButton) desktopLookUpButton.textBlock.text = `Desktop Look\n${sensitivityLabel(settings.desktopLookSensitivity)} +`;
    if (xrSpeedDownButton) xrSpeedDownButton.textBlock.text = `VR Move\n${speedLabel(settings.xrMoveSpeed)} -`;
    if (xrSpeedUpButton) xrSpeedUpButton.textBlock.text = `VR Move\n${speedLabel(settings.xrMoveSpeed)} +`;
    if (xrTurnSpeedDownButton) xrTurnSpeedDownButton.textBlock.text = `VR Turn\n${speedLabel(settings.xrSmoothTurnSpeed)} -`;
    if (xrTurnSpeedUpButton) xrTurnSpeedUpButton.textBlock.text = `VR Turn\n${speedLabel(settings.xrSmoothTurnSpeed)} +`;
    if (micModeButton) micModeButton.textBlock.text = getMicModeLabel();
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

  function rebuildMutePanel() {
    mutePanel.clearControls();
    muteButtonIndex = 0;
    activeListPanelMode = "mute";
    const players = scene.audioControls?.listRemotePlayers?.() || [];

    if (!players.length) {
      const emptyButton = addMuteButton("No Players\nBack", () => {
        updateVolumeLabels();
        showVolumePanel();
      }, 0, 0, listButtonFontSize, "#5b6b7c");
      emptyButton.width = "98%";
    } else {
      players.slice(0, 7).forEach((player) => {
        const text = `${player.muted ? "Unmute" : "Mute"}\n${player.name}`;
        addMuteButton(text, () => {
          scene.audioControls?.toggleRemoteMute?.(player.id);
          rebuildMutePanel();
        });
      });
    }

    addMuteButton("Back", () => {
      updateVolumeLabels();
      showVolumePanel();
    }, 1, 3, listButtonFontSize, "#5b6b7c");
  }

  function rebuildPlayerListPanel() {
    mutePanel.clearControls();
    muteButtonIndex = 0;
    activeListPanelMode = "players";
    const players = scene.audioControls?.listRemotePlayers?.() || [];

    if (!players.length) {
      addMuteButton("No Players\nBack", showMainMenuPanel, 0, 0, listButtonFontSize, "#5b6b7c");
    } else {
      players.slice(0, 7).forEach((player) => {
        const text = `${player.muted ? "Unmute" : "Mute"}\n${player.name}`;
        addMuteButton(text, () => {
          scene.audioControls?.toggleRemoteMute?.(player.id);
          rebuildPlayerListPanel();
        }, null, null, listButtonFontSize, player.muted ? "#7c3f48" : "#4e6f8d");
      });
    }

    addMuteButton("Back", showMainMenuPanel, 1, 3, listButtonFontSize, "#5b6b7c");
  }

  [
    "QWERTYUIOP",
    "ASDFGHJKL",
    "ZXCVBNM",
  ].forEach((rowText, rowIndex) => {
    const startColumn = Math.floor((10 - rowText.length) / 2);
    rowText.split("").forEach((char, charIndex) => {
      addKeyboardKey(char, () => appendChatInput(char), rowIndex, startColumn + charIndex);
    });
  });

  addKeyboardKey("Space", () => appendChatInput(" "), 3, 0, 4, "#4e6f8d");
  addKeyboardKey("Back", () => {
    chatInput.text = (chatInput.text || "").slice(0, -1);
  }, 3, 4, 2, "#6f4e4e");
  addKeyboardKey("Send", sendChatMessage, 3, 6, 2, "#2f7d5f");
  addKeyboardKey("Close", () => setChatKeyboardVisible(false), 3, 8, 2, "#5b6b7c");

  chatSendButton.onPointerUpObservable.add(sendChatMessage);
  chatKeyboardButton.onPointerUpObservable.add(() => {
    setChatKeyboardVisible(!keyboardBoard.isEnabled());
  });
  chatClearButton.onPointerUpObservable.add(() => {
    chatInput.text = "";
  });
  chatBackButton.onPointerUpObservable.add(showMainMenuPanel);
  chatInput.onKeyboardEventProcessedObservable.add((eventData) => {
    const key = eventData?.event?.key || eventData?.key || "";
    if (key === "Enter") {
      sendChatMessage();
    }
  });

  addMenuButton("Open Server Chat", () => {
    showChatPanel();
  });
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
  addMenuButton("Players", () => {
    rebuildPlayerListPanel();
    showMutePanel();
  });
  addMenuButton("Close The Menu", hideMenu);

  locomotionButton = addSettingsButton("Locomotion\nSmooth", () => {
    const nextMode = scene.navigation.toggleXRMode();
    applyXRMovementMode();
    console.log(`[SETTINGS] XR locomotion set to ${nextMode}`);
    updateSettingsLabels();
  }, 0, 0);

  turnModeButton = addSettingsButton("Turning\nSnap", () => {
    const nextMode = scene.navigation.toggleXRTurnMode();
    console.log(`[SETTINGS] XR turning set to ${nextMode}`);
    updateSettingsLabels();
  }, 0, 1);

  addSettingsButton("Desktop\nControls", () => {
    updateSettingsLabels();
    showDesktopControlsPanel();
  }, 0, 2);

  addSettingsButton("VR\nControls", () => {
    updateSettingsLabels();
    showVRControlsPanel();
  }, 0, 3);

  addSettingsButton("Audio", () => {
    updateVolumeLabels();
    showVolumePanel();
  }, 0, 4);

  addSettingsButton("Back", showMainMenuPanel, 0, 5, menuButtonFontSize, "#5b6b7c");

  desktopSpeedDownButton = addDesktopButton("Move Speed\n-", () => {
    settings.desktopMoveSpeed = clampSetting(settings.desktopMoveSpeed - 0.2, 0.8, 8);
    updateSettingsLabels();
  }, 0, 0);

  desktopSpeedUpButton = addDesktopButton("Move Speed\n+", () => {
    settings.desktopMoveSpeed = clampSetting(settings.desktopMoveSpeed + 0.2, 0.8, 8);
    updateSettingsLabels();
  }, 0, 1);

  desktopLookDownButton = addDesktopButton("Look Sens\n-", () => {
    settings.desktopLookSensitivity = clampSetting(settings.desktopLookSensitivity - 0.1, 0.2, 3);
    applyDesktopLookSensitivity();
    updateSettingsLabels();
  }, 0, 2);

  desktopLookUpButton = addDesktopButton("Look Sens\n+", () => {
    settings.desktopLookSensitivity = clampSetting(settings.desktopLookSensitivity + 0.1, 0.2, 3);
    applyDesktopLookSensitivity();
    updateSettingsLabels();
  }, 0, 3);

  addDesktopButton("Settings", () => {
    updateSettingsLabels();
    showSettingsPanel();
  }, 0, 4, menuButtonFontSize, "#5b6b7c");

  addDesktopButton("Back", showMainMenuPanel, 0, 5, menuButtonFontSize, "#5b6b7c");

  xrSpeedDownButton = addVRButton("Move Speed\n-", () => {
    settings.xrMoveSpeed = clampSetting(settings.xrMoveSpeed - 0.2, 0.4, 6);
    updateSettingsLabels();
  }, 0, 0);

  xrSpeedUpButton = addVRButton("Move Speed\n+", () => {
    settings.xrMoveSpeed = clampSetting(settings.xrMoveSpeed + 0.2, 0.4, 6);
    updateSettingsLabels();
  }, 0, 1);

  xrTurnSpeedDownButton = addVRButton("Turn Speed\n-", () => {
    settings.xrSmoothTurnSpeed = clampSetting(settings.xrSmoothTurnSpeed - 0.2, 0.4, 5);
    updateSettingsLabels();
  }, 0, 2);

  xrTurnSpeedUpButton = addVRButton("Turn Speed\n+", () => {
    settings.xrSmoothTurnSpeed = clampSetting(settings.xrSmoothTurnSpeed + 0.2, 0.4, 5);
    updateSettingsLabels();
  }, 0, 3);

  addVRButton("Settings", () => {
    updateSettingsLabels();
    showSettingsPanel();
  }, 0, 4, menuButtonFontSize, "#5b6b7c");

  addVRButton("Back", showMainMenuPanel, 0, 5, menuButtonFontSize, "#5b6b7c");

  const sceneVolumeDownButton = addVolumeButton("Scene Vol\n-", () => {
    scene.audioControls?.adjustSceneVolume?.(-0.1);
    updateVolumeLabels();
  }, 0, 0);

  const sceneVolumeUpButton = addVolumeButton("Scene Vol\n+", () => {
    scene.audioControls?.adjustSceneVolume?.(0.1);
    updateVolumeLabels();
  }, 0, 1);

  const playerVolumeDownButton = addVolumeButton("Player Vol\n-", () => {
    scene.audioControls?.adjustPlayerVolume?.(-0.1);
    updateVolumeLabels();
  }, 0, 2);

  const playerVolumeUpButton = addVolumeButton("Player Vol\n+", () => {
    scene.audioControls?.adjustPlayerVolume?.(0.1);
    updateVolumeLabels();
  }, 0, 3);

  micModeButton = addVolumeButton("Open Mic", () => {
    scene.voiceControls?.cycleMicMode?.();
    updateSettingsLabels();
  }, 0, 4);

  addVolumeButton("Back", () => {
    updateSettingsLabels();
    showSettingsPanel();
  }, 0, 5, menuButtonFontSize, "#5b6b7c");

  applyDesktopLookSensitivity();
  updateSettingsLabels();

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

  scene.isPointerOverSceneUI = () => {
    if (!menuVisible) return false;

    const pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (mesh) => mesh === menuBoard || mesh === listBoard || mesh === keyboardBoard
    );
    return !!pick?.hit;
  };

  function getRemotePlayersSignature() {
    const players = scene.audioControls?.listRemotePlayers?.() || [];
    return players
      .map((player) => `${player.id}:${player.name}:${player.muted ? 1 : 0}`)
      .sort()
      .join("|");
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
  scene.onBeforeRenderObservable.add(() => {
    if (!isInXR(scene) && keyboardBoard.isEnabled()) {
      keyboardBoard.setEnabled(false);
      chatHintText.text = "Desktop: type here";
    }

    const nextSignature = getRemotePlayersSignature();
    if (nextSignature !== lastRemotePlayersSignature) {
      lastRemotePlayersSignature = nextSignature;

      if (listBoard.isEnabled() && mutePanel.isVisible) {
        if (activeListPanelMode === "players") {
          rebuildPlayerListPanel();
        } else if (activeListPanelMode === "mute") {
          rebuildMutePanel();
        }
      }
    }

    const nextChatSignature = getChatMessagesSignature();
    if (nextChatSignature !== lastChatMessagesSignature) {
      lastChatMessagesSignature = nextChatSignature;
      if (listBoard.isEnabled() && chatPanel.isVisible && activeListPanelMode === "chat") {
        refreshChatPanel();
      }
    }
  });

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
  setupObjectInteractions(scene, xr);
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

  function movePlayerWithCollisions(moveVector) {
    if (!scene.playerMesh || !moveVector || moveVector.lengthSquared() <= 0.000001) {
      return Vector3.Zero();
    }

    const baseY = playerHeight * 0.5;
    const stepHeight = Math.max(settings.playerStepHeight || 0, 0);
    const startPosition = scene.playerMesh.position.clone();
    scene.playerMesh.moveWithCollisions(moveVector);
    const appliedMove = scene.playerMesh.position.subtract(startPosition);
    const appliedHorizontal = new Vector3(appliedMove.x, 0, appliedMove.z);

    if (moveVector.y === 0 && moveVector.lengthSquared() > 0.000001) {
      const requestedHorizontal = new Vector3(moveVector.x, 0, moveVector.z);
      const wasBlocked = requestedHorizontal.lengthSquared() > 0.000001 &&
        appliedHorizontal.length() + 0.001 < requestedHorizontal.length();

      if (wasBlocked && stepHeight > 0) {
        scene.playerMesh.position.copyFrom(startPosition);
        scene.playerMesh.moveWithCollisions(new Vector3(0, stepHeight, 0));
        scene.playerMesh.moveWithCollisions(moveVector);
        scene.playerMesh.moveWithCollisions(new Vector3(0, -(stepHeight + 0.08), 0));

        if (scene.playerMesh.position.y < baseY) {
          scene.playerMesh.position.y = baseY;
        }

        const steppedMove = scene.playerMesh.position.subtract(startPosition);
        const steppedHorizontal = new Vector3(steppedMove.x, 0, steppedMove.z);
        if (steppedHorizontal.length() + 0.001 >= appliedHorizontal.length()) {
          return steppedMove;
        }

        scene.playerMesh.position.copyFrom(startPosition.add(appliedMove));
      }
    }

    if (moveVector.y === 0) {
      scene.playerMesh.moveWithCollisions(new Vector3(0, -(stepHeight + 0.12), 0));
    }

    if (scene.playerMesh.position.y < baseY) {
      scene.playerMesh.position.y = baseY;
    }

    return scene.playerMesh.position.subtract(startPosition);
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

        const rawAxes = getThumbstickAxes(controller);
        const axes = {
          x: applyAxisDeadzone(rawAxes.x, settings.xrMoveDeadzone),
          y: applyAxisDeadzone(rawAxes.y, settings.xrMoveDeadzone),
        };
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
            if (scene.xrOrigin) {
              scene.playerMesh.position.x = scene.xrOrigin.position.x;
              scene.playerMesh.position.z = scene.xrOrigin.position.z;
            }
            const appliedMove = movePlayerWithCollisions(new Vector3(move.x, 0, move.z));
            if (appliedMove.lengthSquared() > 0.000001) {
              xrCamera.position.addInPlaceFromFloats(appliedMove.x, 0, appliedMove.z);
              if (scene.xrOrigin) {
                scene.xrOrigin.position.addInPlaceFromFloats(appliedMove.x, 0, appliedMove.z);
              }
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
      movePlayerWithCollisions(new Vector3(move.x, 0, move.z));
    }

    mesh.rotationQuaternion = Quaternion.Identity();
    mesh.rotation.set(0, 0, 0);
    if (mesh.position.y < playerHeight * 0.5) {
      mesh.position.y = playerHeight * 0.5;
    }
    cam.position.y = playerHeight * 0.5;

    if (mesh.physicsImpostor) {
      mesh.physicsImpostor.setLinearVelocity(Vector3.Zero());
      mesh.physicsImpostor.setAngularVelocity(Vector3.Zero());
    }

    const body = mesh.physicsImpostor?.physicsBody;
    if (body) {
      body.position.x = mesh.position.x;
      body.position.y = mesh.position.y;
      body.position.z = mesh.position.z;
      if (body.quaternion) {
        body.quaternion.set(0, 0, 0, 1);
      }
      body.velocity.set(0, 0, 0);
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

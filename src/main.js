import * as BABYLON from "babylonjs";
import * as GUI from "babylonjs-gui";
import { io } from "socket.io-client";

import { startScene } from "./scenes/start.js";

let externalSceneLoader = null;

export function setSceneLoader(fn) {
  externalSceneLoader = fn;
}

const socket = io({
  transports: ["websocket", "polling"],
  autoConnect: false,
});

socket.on("connect", () => console.log("[NET] Connected:", socket.id));
socket.on("connect_error", (err) => console.error("[NET] connect_error:", err.message));
socket.on("disconnect", () => console.log("[NET] Disconnected"));

const canvas = document.getElementById("renderCanvas");
if (!canvas) throw new Error("Canvas #renderCanvas not found");

const engine = new BABYLON.Engine(canvas, true);

let sceneRef = null;
let selfId = null;

const remoteMeshes = new Map();
const pendingRemoteMeshes = new Map();

let avatarBodyContainer = null;

let localAvatarRoot = null;
let localAvatarParts = null;

let playerName = "Player";
let uiTexture = null;
let appStarted = false;
const remoteNameLabels = new Map();

function isMobileBrowser() {
  return /Android|iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

function shouldShowDebugLayer() {
  return !isMobileBrowser();
}

function showRuntimeError(message, error = null) {
  console.error(message, error);

  let box = document.getElementById("runtimeErrorOverlay");
  if (!box) {
    box = document.createElement("pre");
    box.id = "runtimeErrorOverlay";
    box.style.cssText = [
      "position:fixed",
      "left:8px",
      "right:8px",
      "bottom:8px",
      "max-height:40vh",
      "overflow:auto",
      "z-index:9999",
      "padding:10px",
      "border-radius:8px",
      "background:rgba(127,29,29,0.92)",
      "color:white",
      "font:12px/1.35 monospace",
      "white-space:pre-wrap",
    ].join(";");
    document.body.appendChild(box);
  }

  const details = error?.stack || error?.message || String(error || "");
  box.textContent = `${message}${details ? `\n${details}` : ""}`;
}

window.addEventListener("error", (event) => {
  showRuntimeError("[APP] Runtime error", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showRuntimeError("[APP] Unhandled promise rejection", event.reason);
});

const AVATAR_RIG = {
  rootOffset: new BABYLON.Vector3(0, -0.9, 0),
  avatarScale: new BABYLON.Vector3(0.8, 0.8, 0.8),
  bodyVisualScale: new BABYLON.Vector3(0.78, 0.78, 0.78),
  headVisualScale: new BABYLON.Vector3(0.92, 0.92, 0.92),
  nameAnchorOffset: new BABYLON.Vector3(0, 0.3, 0),
  visualYOffset: -1.9,
  headAnchorYOffset: 0,
  desktopBodyAnchorHeadOffset: .2,
  xrBodyAnchorYOffset: -0.5,
  handAnchorYOffset: 0.2,
  leftShoulderOffset: new BABYLON.Vector3(-0.42, 1.55, 0.02),
  rightShoulderOffset: new BABYLON.Vector3(0.42, 1.55, 0.02),
  leftHipOffset: new BABYLON.Vector3(-0.18, 0.58, 0),
  rightHipOffset: new BABYLON.Vector3(0.18, 0.58, 0),
  footOutset: 0.18,
  footForwardOffset: 0.04,
  upperArmLength: 0.38,
  lowerArmLength: 0.4,
  upperArmDiameter: 0.12,
  lowerArmDiameter: 0.1,
  legDiameter: 0.12,
  handSphereDiameter: 0.16,
  referenceUserHeight: 1.7,
  minScaleFactor: 0.65,
  maxScaleFactor: 0.95,
  vrAvatarScaleMultiplier: 0.72,
  desktopAvatarScaleMultiplier: 0.88,
  swapXRHands: false,
};

// Voice chat variables
let localStream = null;
let micMode = "open";
let sceneVolume = 1;
let playerVolume = 1;
const VOICE_RADIUS = 12;
const peerConnections = new Map();
const remoteAudioEls = new Map();

function logConnectedPlayers(context, playersLike = null) {
  const ids = playersLike
    ? Object.values(playersLike)
        .map((p) => p?.id)
        .filter(Boolean)
    : Array.from(remoteMeshes.keys());

  console.log(`[NET] ${context} connected players:`, ids);
}

function cleanupRemoteAudio(playerId) {
  const audioEl = remoteAudioEls.get(playerId);
  if (audioEl) {
    try {
      audioEl.pause();
    } catch (err) {
      console.warn("[VOICE] remote audio pause issue:", playerId, err);
    }

    try {
      audioEl.srcObject = null;
      audioEl.remove();
    } catch (err) {
      console.warn("[VOICE] remote audio cleanup issue:", playerId, err);
    }

    remoteAudioEls.delete(playerId);
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function applyMicMode() {
  const tracks = localStream?.getAudioTracks?.() || [];
  const enabled = micMode === "open";

  for (const track of tracks) {
    track.enabled = enabled;
  }

  console.log(`[VOICE] Mic mode: ${micMode}`);
}

function applyPlayerVolume() {
  for (const playerId of remoteAudioEls.keys()) {
    updateRemoteAudioVolume(playerId);
  }
}

function applySceneVolume() {
  const audioEngine = BABYLON.Engine.audioEngine;
  if (audioEngine?.setGlobalVolume) {
    audioEngine.setGlobalVolume(sceneVolume);
  }
}

function getRemoteVoiceMesh(playerId) {
  const remoteRoot = remoteMeshes.get(playerId);
  if (!remoteRoot) return null;

  return (
    remoteRoot.metadata?.headMesh ||
    remoteRoot.metadata?.bodyMesh ||
    remoteRoot.getChildMeshes(false)[0] ||
    null
  );
}

function getRemoteVoicePosition(playerId) {
  const voiceMesh = getRemoteVoiceMesh(playerId);
  return voiceMesh?.getAbsolutePosition?.() || null;
}

function getVoiceFalloff(distance) {
  if (!Number.isFinite(distance)) return 0;
  if (distance >= VOICE_RADIUS) return 0;
  if (distance <= 0) return 1;
  return 1 - (distance / VOICE_RADIUS);
}

function updateRemoteAudioVolume(playerId) {
  const audioEl = remoteAudioEls.get(playerId);
  const listenerCamera = sceneRef?.activeCamera;
  const voicePosition = getRemoteVoicePosition(playerId);
  if (!audioEl || !listenerCamera || !voicePosition) return;

  const listenerPos = listenerCamera.globalPosition || listenerCamera.position;
  const distance = BABYLON.Vector3.Distance(listenerPos, voicePosition);
  const falloff = getVoiceFalloff(distance);
  audioEl.volume = clamp01(sceneVolume * playerVolume * falloff);
}

function updateAllRemoteAudioVolumes() {
  for (const playerId of remoteAudioEls.keys()) {
    updateRemoteAudioVolume(playerId);
  }
}

async function createRemoteAudio(playerId, stream) {
  cleanupRemoteAudio(playerId);

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.controls = false;
  audioEl.muted = false;
  audioEl.style.display = "none";
  audioEl.srcObject = stream;
  document.body.appendChild(audioEl);
  remoteAudioEls.set(playerId, audioEl);
  updateRemoteAudioVolume(playerId);

  try {
    await audioEl.play();
  } catch (err) {
    console.warn("[VOICE] remote audio play failed:", playerId, err);
  }

  return audioEl;
}

function getPercentLabel(value) {
  return `${Math.round(value * 100)}%`;
}

function createVoiceControls() {
  return {
    getMicMode() {
      return micMode;
    },
    cycleMicMode() {
      const modes = ["open", "muted", "pushToTalk"];
      const currentIndex = modes.indexOf(micMode);
      micMode = modes[(currentIndex + 1) % modes.length];
      applyMicMode();
      return micMode;
    },
  };
}

function createAudioControls() {
  return {
    getVolumeLabels() {
      return {
        scene: `Scene Vol: ${getPercentLabel(sceneVolume)}`,
        players: `Player Vol: ${getPercentLabel(playerVolume)}`,
      };
    },
    adjustSceneVolume(delta) {
      sceneVolume = clamp01(sceneVolume + delta);
      applySceneVolume();
      console.log(`[AUDIO] Scene volume: ${getPercentLabel(sceneVolume)}`);
      return sceneVolume;
    },
    adjustPlayerVolume(delta) {
      playerVolume = clamp01(playerVolume + delta);
      applyPlayerVolume();
      console.log(`[AUDIO] Player volume: ${getPercentLabel(playerVolume)}`);
      return playerVolume;
    },
  };
}

function addAvatarToMirror(scene, root) {
  const mirrorTex = scene?.mirrorTex;
  const mirrorMesh = scene?.mirrorMesh;

  if (!mirrorTex || !root) return;

  const childMeshes = root.getChildMeshes(false);

  for (const mesh of childMeshes) {
    if (!mesh || mesh === mirrorMesh) continue;
    if (!mirrorTex.renderList.includes(mesh)) {
      mirrorTex.renderList.push(mesh);
    }
  }
}

function removeAvatarFromMirror(scene, root) {
  const mirrorTex = scene?.mirrorTex;
  if (!mirrorTex || !root) return;

  const childMeshes = root.getChildMeshes(false);
  mirrorTex.renderList = mirrorTex.renderList.filter(
    (m) => !childMeshes.includes(m)
  );
}

async function loadAvatarTemplates(scene) {
  if (!avatarBodyContainer) {
    avatarBodyContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
      "/object-models/",
      "avatar-body.glb",
      scene
    );
  }
}

function quatFrom(obj) {
  return new BABYLON.Quaternion(obj.x, obj.y, obj.z, obj.w);
}

function scaleVector(vec, factor) {
  return new BABYLON.Vector3(vec.x * factor, vec.y * factor, vec.z * factor);
}

function identityQuat() {
  return BABYLON.Quaternion.Identity();
}

function worldToLocalPosition(node, worldPos) {
  const inv = node.getWorldMatrix().clone();
  inv.invert();
  return BABYLON.Vector3.TransformCoordinates(worldPos, inv);
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function moveAngleToward(current, target, maxStep) {
  const delta = normalizeAngle(target - current);

  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

function createArmSegment(scene, name, diameter, diffuseColor) {
  const mesh = BABYLON.MeshBuilder.CreateCylinder(
    name,
    { height: 1, diameter, tessellation: 10 },
    scene
  );

  const material = new BABYLON.StandardMaterial(`${name}_mat`, scene);
  material.diffuseColor = diffuseColor;
  material.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  mesh.material = material;
  mesh.rotationQuaternion = identityQuat();
  return mesh;
}

function createHandSphere(scene, name, diffuseColor) {
  const mesh = BABYLON.MeshBuilder.CreateSphere(
    name,
    { diameter: AVATAR_RIG.handSphereDiameter, segments: 12 },
    scene
  );

  const material = new BABYLON.StandardMaterial(`${name}_mat`, scene);
  material.diffuseColor = diffuseColor;
  material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  mesh.material = material;
  return mesh;
}

function rotationFromUpToDirection(direction) {
  const up = BABYLON.Vector3.Up();
  const dir = direction.normalize();
  const dot = BABYLON.Vector3.Dot(up, dir);

  if (dot > 0.999999) {
    return identityQuat();
  }

  if (dot < -0.999999) {
    return BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, Math.PI);
  }

  const cross = BABYLON.Vector3.Cross(up, dir);
  const q = new BABYLON.Quaternion(cross.x, cross.y, cross.z, 1 + dot);
  q.normalize();
  return q;
}

function solveElbowPosition(shoulderPos, wristPos, bendHint, upperLen, lowerLen) {
  const targetVector = wristPos.subtract(shoulderPos);
  const distance = targetVector.length();

  if (distance < 0.0001) {
    return shoulderPos.clone();
  }

  const minReach = Math.max(Math.abs(upperLen - lowerLen) + 0.001, 0.001);
  const maxReach = upperLen + lowerLen - 0.001;
  const clampedDistance = BABYLON.Scalar.Clamp(distance, minReach, maxReach);
  const direction = targetVector.scale(1 / distance);

  let planeNormal = bendHint.subtract(direction.scale(BABYLON.Vector3.Dot(bendHint, direction)));

  if (planeNormal.lengthSquared() < 0.0001) {
    planeNormal = BABYLON.Vector3.Cross(direction, BABYLON.Axis.Y);
  }

  if (planeNormal.lengthSquared() < 0.0001) {
    planeNormal = BABYLON.Vector3.Cross(direction, BABYLON.Axis.X);
  }

  planeNormal.normalize();

  const along = (
    (upperLen * upperLen - lowerLen * lowerLen + clampedDistance * clampedDistance) /
    (2 * clampedDistance)
  );
  const height = Math.sqrt(Math.max(upperLen * upperLen - along * along, 0));

  return shoulderPos
    .add(direction.scale(along))
    .add(planeNormal.scale(height));
}

function placeLimbSegment(rootNode, mesh, startWorld, endWorld) {
  const start = worldToLocalPosition(rootNode, startWorld);
  const end = worldToLocalPosition(rootNode, endWorld);
  const delta = end.subtract(start);
  const length = delta.length();

  if (length < 0.0001) {
    mesh.setEnabled(false);
    return;
  }

  mesh.setEnabled(true);
  mesh.position.copyFrom(start.add(end).scale(0.5));
  mesh.scaling.set(1, length, 1);
  mesh.rotationQuaternion = rotationFromUpToDirection(delta);
}

function updateNameAnchor(parts, rootNode) {
  if (!parts?.nameAnchor || !rootNode) return;

  if (parts.headMesh) {
    parts.headMesh.computeWorldMatrix(true);

    const headBounds = parts.headMesh.getBoundingInfo().boundingBox;
    const min = headBounds.minimumWorld;
    const max = headBounds.maximumWorld;
    const labelWorldPos = new BABYLON.Vector3(
      (min.x + max.x) * 0.5,
      max.y + AVATAR_RIG.nameAnchorOffset.y,
      (min.z + max.z) * 0.5
    );

    parts.nameAnchor.position.copyFrom(worldToLocalPosition(rootNode, labelWorldPos));
    return;
  }

  if (parts.headAnchor) {
    const labelWorldPos = parts.headAnchor
      .getAbsolutePosition()
      .add(AVATAR_RIG.nameAnchorOffset);
    parts.nameAnchor.position.copyFrom(worldToLocalPosition(rootNode, labelWorldPos));
  }
}

function getAvatarScaleFactorForHeight(height) {
  const ratio = height / AVATAR_RIG.referenceUserHeight;
  const clamped = BABYLON.Scalar.Clamp(
    ratio,
    AVATAR_RIG.minScaleFactor,
    AVATAR_RIG.maxScaleFactor
  );
  return clamped * AVATAR_RIG.vrAvatarScaleMultiplier;
}

function applyAvatarTransform(rootNode, worldPos, scaleFactor = 1, avatarMode = "desktop") {
  if (!rootNode || !worldPos) return;

  rootNode.position.set(
    worldPos.x,
    worldPos.y + AVATAR_RIG.rootOffset.y * scaleFactor,
    worldPos.z
  );
  rootNode.scaling.copyFrom(scaleVector(AVATAR_RIG.avatarScale, scaleFactor));
  rootNode.metadata = rootNode.metadata || {};
  rootNode.metadata.avatarScaleFactor = scaleFactor;
  rootNode.metadata.avatarMode = avatarMode;
  rootNode.metadata.floorY =
    avatarMode === "vr" ? 0 : worldPos.y + AVATAR_RIG.rootOffset.y;
}

function createArmRig(scene, prefix, root, bodyAnchor) {
  const leftShoulderAnchor = new BABYLON.TransformNode(`${prefix}LeftShoulderAnchor`, scene);
  const rightShoulderAnchor = new BABYLON.TransformNode(`${prefix}RightShoulderAnchor`, scene);

  leftShoulderAnchor.parent = bodyAnchor;
  rightShoulderAnchor.parent = bodyAnchor;

  leftShoulderAnchor.position.copyFrom(AVATAR_RIG.leftShoulderOffset);
  rightShoulderAnchor.position.copyFrom(AVATAR_RIG.rightShoulderOffset);

  const leftUpperArm = createArmSegment(
    scene,
    `${prefix}LeftUpperArm`,
    AVATAR_RIG.upperArmDiameter,
    new BABYLON.Color3(0.16, 0.16, 0.2)
  );
  const leftLowerArm = createArmSegment(
    scene,
    `${prefix}LeftLowerArm`,
    AVATAR_RIG.lowerArmDiameter,
    new BABYLON.Color3(0.22, 0.22, 0.28)
  );
  const rightUpperArm = createArmSegment(
    scene,
    `${prefix}RightUpperArm`,
    AVATAR_RIG.upperArmDiameter,
    new BABYLON.Color3(0.16, 0.16, 0.2)
  );
  const rightLowerArm = createArmSegment(
    scene,
    `${prefix}RightLowerArm`,
    AVATAR_RIG.lowerArmDiameter,
    new BABYLON.Color3(0.22, 0.22, 0.28)
  );

  leftUpperArm.parent = root;
  leftLowerArm.parent = root;
  rightUpperArm.parent = root;
  rightLowerArm.parent = root;

  return {
    leftShoulderAnchor,
    rightShoulderAnchor,
    leftUpperArm,
    leftLowerArm,
    rightUpperArm,
    rightLowerArm,
  };
}

function createLegRig(scene, prefix, root, bodyAnchor) {
  const leftHipAnchor = new BABYLON.TransformNode(`${prefix}LeftHipAnchor`, scene);
  const rightHipAnchor = new BABYLON.TransformNode(`${prefix}RightHipAnchor`, scene);

  leftHipAnchor.parent = bodyAnchor;
  rightHipAnchor.parent = bodyAnchor;

  leftHipAnchor.position.copyFrom(AVATAR_RIG.leftHipOffset);
  rightHipAnchor.position.copyFrom(AVATAR_RIG.rightHipOffset);

  const leftLeg = createArmSegment(
    scene,
    `${prefix}LeftLeg`,
    AVATAR_RIG.legDiameter,
    new BABYLON.Color3(0.16, 0.16, 0.2)
  );
  const rightLeg = createArmSegment(
    scene,
    `${prefix}RightLeg`,
    AVATAR_RIG.legDiameter,
    new BABYLON.Color3(0.16, 0.16, 0.2)
  );

  leftLeg.parent = root;
  rightLeg.parent = root;

  return {
    leftHipAnchor,
    rightHipAnchor,
    leftLeg,
    rightLeg,
  };
}

function updateArmPose(parts, rootNode, side) {
  const isLeft = side === "left";
  const shoulderAnchor = isLeft ? parts.leftShoulderAnchor : parts.rightShoulderAnchor;
  const handAnchor = isLeft ? parts.leftHandAnchor : parts.rightHandAnchor;
  const upperArmMesh = isLeft ? parts.leftUpperArm : parts.rightUpperArm;
  const lowerArmMesh = isLeft ? parts.leftLowerArm : parts.rightLowerArm;

  if (!shoulderAnchor || !handAnchor || !upperArmMesh || !lowerArmMesh || !parts.bodyAnchor) {
    return;
  }

  const shoulderWorld = shoulderAnchor.getAbsolutePosition();
  const wristWorld = handAnchor.getAbsolutePosition();
  const bodyForward = parts.bodyAnchor.getDirection(BABYLON.Axis.Z).normalize();
  const bodyRight = parts.bodyAnchor.getDirection(BABYLON.Axis.X).normalize();
  const worldScale = parts.bodyAnchor.absoluteScaling?.y ?? rootNode.absoluteScaling?.y ?? 1;
  const bendHint = BABYLON.Vector3.Down()
    .scale(0.7)
    .add(bodyForward.scale(-0.2))
    .add(bodyRight.scale(isLeft ? -0.2 : 0.2));

  const elbowWorld = solveElbowPosition(
    shoulderWorld,
    wristWorld,
    bendHint,
    AVATAR_RIG.upperArmLength * worldScale,
    AVATAR_RIG.lowerArmLength * worldScale
  );

  placeLimbSegment(rootNode, upperArmMesh, shoulderWorld, elbowWorld);
  placeLimbSegment(rootNode, lowerArmMesh, elbowWorld, wristWorld);
}

function updateLegPose(parts, rootNode, side) {
  const isLeft = side === "left";
  const hipAnchor = isLeft ? parts.leftHipAnchor : parts.rightHipAnchor;
  const legMesh = isLeft ? parts.leftLeg : parts.rightLeg;

  if (!hipAnchor || !legMesh || !parts.bodyAnchor) {
    return;
  }

  const hipWorld = hipAnchor.getAbsolutePosition();
  const bodyRight = parts.bodyAnchor.getDirection(BABYLON.Axis.X).normalize();
  const bodyForward = parts.bodyAnchor.getDirection(BABYLON.Axis.Z).normalize();
  const worldScale = parts.bodyAnchor.absoluteScaling?.y ?? rootNode.absoluteScaling?.y ?? 1;
  const floorY = rootNode.metadata?.floorY ?? rootNode.position.y;
  const footWorld = new BABYLON.Vector3(hipWorld.x, floorY, hipWorld.z)
    .add(bodyRight.scale((isLeft ? -1 : 1) * AVATAR_RIG.footOutset * worldScale))
    .add(bodyForward.scale(AVATAR_RIG.footForwardOffset * worldScale));

  placeLimbSegment(rootNode, legMesh, hipWorld, footWorld);
}

function applyAvatarPose(parts, rootNode, pose) {
  if (!parts || !rootNode || !pose) return;
  const avatarMode = pose.avatarMode || rootNode.metadata?.avatarMode || "desktop";

  if (parts.bodyAnchor) {
    parts.bodyAnchor.position.set(0, 0, 0);
    parts.bodyAnchor.rotation.set(0, pose.rootRotY ?? 0, 0);
    parts.bodyAnchor.scaling.copyFrom(AVATAR_RIG.bodyVisualScale);
  }

  if (parts.headAnchor && pose.head?.pos && pose.head?.rot) {
    const localHeadPos = worldToLocalPosition(
      rootNode,
      new BABYLON.Vector3(pose.head.pos.x, pose.head.pos.y, pose.head.pos.z)
    );

    parts.headAnchor.position.copyFrom(localHeadPos);
    parts.headAnchor.position.y += AVATAR_RIG.headAnchorYOffset + AVATAR_RIG.visualYOffset;
    parts.headAnchor.rotationQuaternion = quatFrom(pose.head.rot);
    parts.headAnchor.scaling.copyFrom(AVATAR_RIG.headVisualScale);

    if (parts.bodyAnchor && avatarMode === "desktop") {
      parts.bodyAnchor.position.y =
        parts.headAnchor.position.y + AVATAR_RIG.desktopBodyAnchorHeadOffset;
    } else if (parts.bodyAnchor && avatarMode === "vr") {
      parts.bodyAnchor.position.y += AVATAR_RIG.xrBodyAnchorYOffset;
    }
  }

  if (parts.leftHandAnchor && pose.leftHand?.pos && pose.leftHand?.rot) {
    const localLeftPos = worldToLocalPosition(
      rootNode,
      new BABYLON.Vector3(pose.leftHand.pos.x, pose.leftHand.pos.y, pose.leftHand.pos.z)
    );

    parts.leftHandAnchor.position.copyFrom(localLeftPos);
    parts.leftHandAnchor.position.y += AVATAR_RIG.handAnchorYOffset;
    parts.leftHandAnchor.rotationQuaternion = quatFrom(pose.leftHand.rot);
  }

  if (parts.rightHandAnchor && pose.rightHand?.pos && pose.rightHand?.rot) {
    const localRightPos = worldToLocalPosition(
      rootNode,
      new BABYLON.Vector3(pose.rightHand.pos.x, pose.rightHand.pos.y, pose.rightHand.pos.z)
    );

    parts.rightHandAnchor.position.copyFrom(localRightPos);
    parts.rightHandAnchor.position.y += AVATAR_RIG.handAnchorYOffset;
    parts.rightHandAnchor.rotationQuaternion = quatFrom(pose.rightHand.rot);
  }

  updateArmPose(parts, rootNode, "left");
  updateArmPose(parts, rootNode, "right");
  updateLegPose(parts, rootNode, "left");
  updateLegPose(parts, rootNode, "right");
  updateNameAnchor(parts, rootNode);
}

async function ensureRemoteMesh(scene, id) {
  const existing = remoteMeshes.get(id);
  if (existing) return existing;

  const pending = pendingRemoteMeshes.get(id);
  if (pending) return await pending;

  const creationPromise = (async () => {
    await loadAvatarTemplates(scene);

    const root = new BABYLON.TransformNode(`remote_${id}`, scene);
    applyAvatarTransform(root, BABYLON.Vector3.Zero(), 1);

    const bodyAnchor = new BABYLON.TransformNode(`bodyAnchor_${id}`, scene);
    const headAnchor = new BABYLON.TransformNode(`headAnchor_${id}`, scene);
    const leftHandAnchor = new BABYLON.TransformNode(`leftHandAnchor_${id}`, scene);
    const rightHandAnchor = new BABYLON.TransformNode(`rightHandAnchor_${id}`, scene);
    const nameAnchor = new BABYLON.TransformNode(`nameAnchor_${id}`, scene);

    bodyAnchor.parent = root;
    headAnchor.parent = root;
    leftHandAnchor.parent = root;
    rightHandAnchor.parent = root;
    nameAnchor.parent = root;

    nameAnchor.position.copyFrom(AVATAR_RIG.nameAnchorOffset);
    const armRig = createArmRig(scene, `remote_${id}_`, root, bodyAnchor);
    const legRig = createLegRig(scene, `remote_${id}_`, root, bodyAnchor);

    const bodyInstance = avatarBodyContainer.instantiateModelsToScene(
      (name) => `${name}_body_${id}`,
      false
    );

    bodyInstance.rootNodes.forEach((node) => {
      node.parent = bodyAnchor;
      node.setEnabled(true);
    });

    const leftHandMesh = createHandSphere(
      scene,
      `leftHandSphere_${id}`,
      new BABYLON.Color3(0.86, 0.73, 0.62)
    );
    leftHandMesh.parent = leftHandAnchor;

    const rightHandMesh = createHandSphere(
      scene,
      `rightHandSphere_${id}`,
      new BABYLON.Color3(0.86, 0.73, 0.62)
    );
    rightHandMesh.parent = rightHandAnchor;

    const bodyChildren = bodyAnchor.getChildMeshes(false);
    const headMesh =
      bodyChildren.find((m) => m.name.toLowerCase().includes("head")) || null;

    if (headMesh) {
      headMesh.parent = headAnchor;
    }

    const bodyMesh =
      bodyAnchor.getChildMeshes(false).find((m) => m !== headMesh) ||
      bodyAnchor.getChildMeshes(false)[0] ||
      null;

    root.metadata = {
      bodyAnchor,
      headAnchor,
      leftHandAnchor,
      rightHandAnchor,
      nameAnchor,
      leftShoulderAnchor: armRig.leftShoulderAnchor,
      rightShoulderAnchor: armRig.rightShoulderAnchor,
      leftHipAnchor: legRig.leftHipAnchor,
      rightHipAnchor: legRig.rightHipAnchor,
      leftUpperArm: armRig.leftUpperArm,
      leftLowerArm: armRig.leftLowerArm,
      rightUpperArm: armRig.rightUpperArm,
      rightLowerArm: armRig.rightLowerArm,
      leftLeg: legRig.leftLeg,
      rightLeg: legRig.rightLeg,
      bodyMesh,
      headMesh,
      leftHandMesh,
      rightHandMesh,
    };

    const mirrorTex = scene?.mirrorTex;
    if (mirrorTex) {
      const avatarParts = root.getChildMeshes(false).filter(Boolean);

      for (const part of avatarParts) {
        if (!mirrorTex.renderList.includes(part)) {
          mirrorTex.renderList.push(part);
        }
      }

      console.log(
        `[MIRROR] Added avatar parts for ${id}:`,
        avatarParts.map((m) => m.name)
      );
    }

    remoteMeshes.set(id, root);
    pendingRemoteMeshes.delete(id);
    return root;
  })();

  pendingRemoteMeshes.set(id, creationPromise);
  return await creationPromise;
}

async function ensureLocalAvatar(scene) {
  if (localAvatarRoot) return localAvatarRoot;

  await loadAvatarTemplates(scene);

  const root = new BABYLON.TransformNode("localAvatar", scene);
  applyAvatarTransform(root, BABYLON.Vector3.Zero(), 1);

  const bodyAnchor = new BABYLON.TransformNode("localBodyAnchor", scene);
  const headAnchor = new BABYLON.TransformNode("localHeadAnchor", scene);
  const leftHandAnchor = new BABYLON.TransformNode("localLeftHandAnchor", scene);
  const rightHandAnchor = new BABYLON.TransformNode("localRightHandAnchor", scene);

  bodyAnchor.parent = root;
  headAnchor.parent = root;
  leftHandAnchor.parent = root;
  rightHandAnchor.parent = root;

  const armRig = createArmRig(scene, "local_", root, bodyAnchor);
  const legRig = createLegRig(scene, "local_", root, bodyAnchor);

  const bodyInstance = avatarBodyContainer.instantiateModelsToScene(
    (name) => `${name}_body_local`,
    false
  );

  bodyInstance.rootNodes.forEach((node) => {
    node.parent = bodyAnchor;
    node.setEnabled(true);
  });

  const leftHandMesh = createHandSphere(
    scene,
    "leftHandSphere_local",
    new BABYLON.Color3(0.86, 0.73, 0.62)
  );
  leftHandMesh.parent = leftHandAnchor;

  const rightHandMesh = createHandSphere(
    scene,
    "rightHandSphere_local",
    new BABYLON.Color3(0.86, 0.73, 0.62)
  );
  rightHandMesh.parent = rightHandAnchor;

  const bodyChildren = bodyAnchor.getChildMeshes(false);
  const headMesh =
    bodyChildren.find((m) => m.name.toLowerCase().includes("head")) || null;

  if (headMesh) {
    headMesh.parent = headAnchor;
  }

  const bodyMesh =
    bodyAnchor.getChildMeshes(false).find((m) => m !== headMesh) ||
    bodyAnchor.getChildMeshes(false)[0] ||
    null;

  if (headMesh) {
    headMesh.isVisible = true;
  }

  localAvatarRoot = root;
  localAvatarParts = {
    root,
    bodyMesh,
    headMesh,
    leftHandMesh,
    rightHandMesh,
    bodyAnchor,
    headAnchor,
    leftHandAnchor,
    rightHandAnchor,
    leftShoulderAnchor: armRig.leftShoulderAnchor,
    rightShoulderAnchor: armRig.rightShoulderAnchor,
    leftHipAnchor: legRig.leftHipAnchor,
    rightHipAnchor: legRig.rightHipAnchor,
    leftUpperArm: armRig.leftUpperArm,
    leftLowerArm: armRig.leftLowerArm,
    rightUpperArm: armRig.rightUpperArm,
    rightLowerArm: armRig.rightLowerArm,
    leftLeg: legRig.leftLeg,
    rightLeg: legRig.rightLeg,
    bodyYaw: 0,
  };

  const mirrorTex = scene?.mirrorTex;
  if (mirrorTex) {
    root.getChildMeshes(false)
      .filter(Boolean)
      .forEach((part) => {
        if (!mirrorTex.renderList.includes(part)) {
          mirrorTex.renderList.push(part);
        }
      });
  }

  console.log(
    "[LOCAL AVATAR] created:",
    root.getChildMeshes(false).map((m) => m.name)
  );

  return root;
}

function ensureRemoteNameLabel(id, mesh, name = "Player") {
  const anchor = mesh.metadata?.nameAnchor || mesh;

  let label = remoteNameLabels.get(id);
  if (label) {
    label.textBlock.text = name;
    label.rect.linkWithMesh(anchor);
    return label;
  }

  const rect = new GUI.Rectangle(`nameRect_${id}`);
  rect.width = "140px";
  rect.height = "32px";
  rect.cornerRadius = 10;
  rect.thickness = 1;
  rect.background = "black";
  rect.alpha = 0.65;

  const text = new GUI.TextBlock(`nameText_${id}`, name);
  text.color = "white";
  text.fontSize = 14;

  rect.addControl(text);
  uiTexture.addControl(rect);

  rect.linkWithMesh(anchor);
  rect.linkOffsetY = 0;

  label = { rect, textBlock: text };
  remoteNameLabels.set(id, label);
  return label;
}

function removeRemoteNameLabel(id) {
  const label = remoteNameLabels.get(id);
  if (label) {
    label.rect.dispose();
    remoteNameLabels.delete(id);
  }
}

function removeRemoteMesh(id) {
  pendingRemoteMeshes.delete(id);
  removeRemoteNameLabel(id);

  const root = remoteMeshes.get(id);
  if (root) {
    removeAvatarFromMirror(sceneRef, root);
    root.dispose(false, true);
    remoteMeshes.delete(id);
  }
}

function removePeerConnection(id) {
  const pc = peerConnections.get(id);
  if (pc) {
    pc.close();
    peerConnections.delete(id);
  }

  cleanupRemoteAudio(id);
}
function extractYaw(camera) {
  if (camera.rotationQuaternion) {
    const q = camera.rotationQuaternion;
    return Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.x * q.x)
    );
  }

  return camera.rotation?.y ?? 0;
}

function createPeerConnection(targetId) {
  if (targetId === selfId) {
    console.error("[VOICE] BLOCKED self peer connection attempt:", {
      selfId,
      targetId
    });
    return null;
  }

  const existing = peerConnections.get(targetId);
  if (existing) return existing;

  cleanupRemoteAudio(targetId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  if (localStream) {
    const tracks = localStream.getTracks();
    console.log(`[VOICE] Adding ${tracks.length} local tracks to PC for ${targetId}`);

    tracks.forEach((track) => {
      console.log("[VOICE] Adding track:", {
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        label: track.label
      });
      pc.addTrack(track, localStream);
    });
  } else {
    console.warn("[VOICE] No localStream when creating PC for", targetId);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", {
        targetId,
        candidate: event.candidate,
      });
    }
  };

  pc.ontrack = async (event) => {
    console.log("[VOICE] Receiving audio from:", targetId);
    console.log("[VOICE] ontrack stream count:", event.streams.length);
    console.log("[VOICE] ontrack kind:", event.track?.kind);

    const stream = event.streams[0];
    if (!stream) return;

    const audioEl = await createRemoteAudio(targetId, stream);
    if (!audioEl) {
      console.warn("[VOICE] Failed to create remote audio for", targetId);
      return;
    }

    event.track.onmute = () => console.warn("[VOICE] Remote track muted:", targetId);
    event.track.onunmute = () => console.log("[VOICE] Remote track unmuted:", targetId);
    event.track.onended = () => console.warn("[VOICE] Remote track ended:", targetId);

    updateRemoteAudioVolume(targetId);
    console.log("[VOICE] Proximity audio ready for:", targetId);
  };

  
  pc.onconnectionstatechange = () => {
    console.log(`[VOICE] ${targetId} state:`, pc.connectionState);

    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      removePeerConnection(targetId);
    }
  };

  peerConnections.set(targetId, pc);
  return pc;
}

socket.on("init", async ({ selfId: id, players }) => {
  selfId = id;
  console.log("[NET] init selfId:", selfId);
  logConnectedPlayers("init", players);

  if (!sceneRef) return;

  const otherPlayers = Object.values(players || {}).filter(
    (p) => p?.id && p.id !== selfId
  );

  await Promise.all(otherPlayers.map((p) => ensureRemoteMesh(sceneRef, p.id)));
  logConnectedPlayers("after init");
});

socket.on("playerJoined", async (p) => {
  if (!sceneRef || !p?.id || p.id === selfId) return;
  console.log("[NET] playerJoined:", p.id);

  await ensureRemoteMesh(sceneRef, p.id);
  updateRemoteAudioVolume(p.id);

  try {
    const pc = createPeerConnection(p.id);
    if (!pc) return;

    if (pc.signalingState !== "stable") return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("webrtc-offer", {
      targetId: p.id,
      offer: pc.localDescription,
    });

    console.log("[VOICE] Sent offer to:", p.id);
    logConnectedPlayers("after join");
  } catch (err) {
    console.error("[VOICE] Error creating offer:", err);
  }
});

socket.on("playerLeft", (id) => {
  console.log("[NET] playerLeft:", id);
  removeRemoteMesh(id);
  cleanupRemoteAudio(id);
  removePeerConnection(id);
  logConnectedPlayers("after leave");
});

socket.on("playersUpdate", async (players) => {
  if (!sceneRef || !players) return;

  for (const [id, p] of Object.entries(players)) {
    if (id === selfId) continue;

    let mesh = remoteMeshes.get(id);

    if (!mesh) {
      mesh = await ensureRemoteMesh(sceneRef, id);
      if (!mesh) continue;
    }

    ensureRemoteNameLabel(id, mesh, p.name || "Player");

    applyAvatarTransform(
      mesh,
      new BABYLON.Vector3(
        p.root?.pos?.x ?? 0,
        p.root?.pos?.y ?? 0,
        p.root?.pos?.z ?? 0
      ),
      p.root?.scale ?? 1,
      p.avatarMode || "desktop"
    );

    mesh.rotation.y = p.root?.rotY ?? 0;

    applyAvatarPose(mesh.metadata, mesh, {
      avatarMode: p.avatarMode || "desktop",
      rootRotY: p.root?.rotY ?? 0,
      head: p.head,
      leftHand: p.leftHand,
      rightHand: p.rightHand,
    });

    updateRemoteAudioVolume(id);
  }
});

socket.on("webrtc-offer", async ({ fromId, offer }) => {
  try {
    console.log("[VOICE] Received offer from:", fromId);

    const pc = createPeerConnection(fromId);
    if (!pc) return;

    if (pc.signalingState !== "stable") {
      console.warn("[VOICE] Ignoring offer; signaling state is", pc.signalingState);
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("webrtc-answer", {
      targetId: fromId,
      answer: pc.localDescription,
    });
  } catch (err) {
    console.error("[VOICE] Error handling offer:", err);
  }
});

socket.on("webrtc-answer", async ({ fromId, answer }) => {
  try {
    console.log("[VOICE] Received answer from:", fromId);

    const pc = peerConnections.get(fromId);
    if (!pc) return;

    if (pc.signalingState !== "have-local-offer") {
      console.warn("[VOICE] Unexpected answer in state:", pc.signalingState);
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (err) {
    console.error("[VOICE] Error handling answer:", err);
  }
});

socket.on("webrtc-ice-candidate", async ({ fromId, candidate }) => {
  try {
    const pc = peerConnections.get(fromId);
    if (!pc || !candidate) return;

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("[VOICE] Error adding ICE candidate:", err);
  }
});

let audioUnlocked = false;

async function unlockAudio() {
  if (audioUnlocked) return;

  try {
    const audioEngine = BABYLON.Engine.audioEngine;
    const ctx = audioEngine?.audioContext;
    if (ctx?.state === "suspended") {
      await ctx.resume();
    }
    audioUnlocked = true;
    console.log("[VOICE] Audio unlocked");
  } catch (err) {
    console.warn("[VOICE] Audio unlock failed:", err);
  }
}

window.addEventListener("click", unlockAudio, { once: true });
window.addEventListener("touchstart", unlockAudio, { once: true });

export async function launchApp(options = {}) {
  if (appStarted) return;
  appStarted = true;

  if (options.playerName) {
    playerName = options.playerName;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    console.log("[VOICE] Microphone ready");

    const audioTracks = localStream.getAudioTracks();
    console.log("[VOICE] Audio track count:", audioTracks.length);

    if (audioTracks.length === 0) {
      console.warn("[VOICE] No audio tracks were returned by getUserMedia");
    }

    audioTracks.forEach((track, i) => {
      console.log(`[VOICE] Local audio track ${i}:`, {
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });

      track.onmute = () => console.warn(`[VOICE] Track ${i} muted`);
      track.onunmute = () => console.log(`[VOICE] Track ${i} unmuted`);
      track.onended = () => console.warn(`[VOICE] Track ${i} ended`);
    });

    applyMicMode();
  } catch (err) {
    console.error("[VOICE] Microphone error:", err);
  }

  let scene;

    if (externalSceneLoader) {
      scene = await externalSceneLoader(engine);
    } else {
      scene = await startScene(engine);
  }

  sceneRef = scene;
  scene.voiceControls = createVoiceControls();
  scene.audioControls = createAudioControls();
  uiTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("nameUI", true, scene);
  applySceneVolume();
  applyPlayerVolume();

  await ensureLocalAvatar(scene);

  socket.connect();

  if (shouldShowDebugLayer()) {
    scene.debugLayer.show();
  }

  const SEND_HZ = 15;
  let lastSend = 0;

  engine.runRenderLoop(() => {
    scene.render();

    if (!scene.activeCamera) return;

    updateAllRemoteAudioVolumes();

    if (!socket.connected) return;

    const now = performance.now();
    if (now - lastSend < 1000 / SEND_HZ) return;
    lastSend = now;

    const cam = scene.activeCamera;
    const xrActive =
      scene.xrHelper?.baseExperience?.state === BABYLON.WebXRState.IN_XR;

    const pos = xrActive
      ? cam.globalPosition
      : (scene.playerMesh ? scene.playerMesh.position : cam.position);

    const headWorld = cam.globalPosition;
    let headPos = { x: headWorld.x, y: headWorld.y, z: headWorld.z };
    let headRot = { x: 0, y: 0, z: 0, w: 1 };

    if (cam.rotationQuaternion) {
      headRot = {
        x: cam.rotationQuaternion.x,
        y: cam.rotationQuaternion.y,
        z: cam.rotationQuaternion.z,
        w: cam.rotationQuaternion.w,
      };
    } else if (cam.rotation) {
      const camQuat = BABYLON.Quaternion.FromEulerAngles(
        cam.rotation.x,
        cam.rotation.y,
        cam.rotation.z
      );
      headRot = {
        x: camQuat.x,
        y: camQuat.y,
        z: camQuat.z,
        w: camQuat.w,
      };
    }

    let leftHand = {
      pos: { x: pos.x - 0.25, y: pos.y - 0.3, z: pos.z + 0.2 },
      rot: { x: 0, y: 0, z: 0, w: 1 },
    };

    let rightHand = {
      pos: { x: pos.x + 0.25, y: pos.y - 0.3, z: pos.z + 0.2 },
      rot: { x: 0, y: 0, z: 0, w: 1 },
    };

    const xrHelper = scene.xrHelper || null;
    const controllers = xrHelper?.input?.controllers || [];

    for (const controller of controllers) {
      const handedness = controller.inputSource?.handedness;
      const grip = controller.grip || controller.pointer;

      if (!grip) continue;

      const cpos = grip.getAbsolutePosition();
      const crot =
        grip.absoluteRotationQuaternion ||
        grip.rotationQuaternion ||
        BABYLON.Quaternion.Identity();

      const tracked = {
        pos: { x: cpos.x, y: cpos.y, z: cpos.z },
        rot: { x: crot.x, y: crot.y, z: crot.z, w: crot.w },
      };

      if (AVATAR_RIG.swapXRHands) {
        if (handedness === "left") rightHand = tracked;
        if (handedness === "right") leftHand = tracked;
      } else {
        if (handedness === "left") leftHand = tracked;
        if (handedness === "right") rightHand = tracked;
      }
    }

    if (localAvatarParts) {
      const avatarRootPos = pos.clone();
      const avatarScaleFactor = xrActive
        ? getAvatarScaleFactorForHeight(Math.max(headWorld.y, 1.0))
        : AVATAR_RIG.desktopAvatarScaleMultiplier;

      const avatarMode = xrActive ? "vr" : "desktop";

      applyAvatarTransform(
        localAvatarParts.root,
        avatarRootPos,
        avatarScaleFactor,
        avatarMode
      );
      localAvatarParts.avatarScaleFactor = avatarScaleFactor;
      localAvatarParts.avatarMode = avatarMode;

      const headYaw = extractYaw(cam);

      if (localAvatarParts.bodyYaw == null) {
        localAvatarParts.bodyYaw = headYaw;
      }

      const DEADZONE = BABYLON.Angle.FromDegrees(xrActive ? 30 : 8).radians();
      const FOLLOW_SPEED = xrActive ? 4.0 : 10.0;
      const dt = engine.getDeltaTime() / 1000;

      const yawDelta = normalizeAngle(headYaw - localAvatarParts.bodyYaw);

      if (Math.abs(yawDelta) > DEADZONE) {
        const targetYaw = headYaw - Math.sign(yawDelta) * DEADZONE;
        localAvatarParts.bodyYaw = moveAngleToward(
          localAvatarParts.bodyYaw,
          targetYaw,
          FOLLOW_SPEED * dt
        );
      }

      localAvatarParts.root.rotation.set(0, 0, 0);

      if (localAvatarParts.bodyAnchor) {
        localAvatarParts.bodyAnchor.position.set(0, 0, 0);
        localAvatarParts.bodyAnchor.rotation.set(0, localAvatarParts.bodyYaw, 0);
      }

      applyAvatarPose(localAvatarParts, localAvatarParts.root, {
        avatarMode,
        rootRotY: localAvatarParts.bodyYaw,
        head: {
          pos: headPos,
          rot: headRot,
        },
        leftHand,
        rightHand,
      });
    }

    socket.emit("pose", {
      name: playerName,
      avatarMode: xrActive ? "vr" : "desktop",
      root: {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        rotY: localAvatarParts?.bodyYaw ?? extractYaw(cam),
        scale: localAvatarParts?.avatarScaleFactor ?? 1,
      },
      head: {
        pos: headPos,
        rot: headRot,
      },
      leftHand,
      rightHand,
    });
  });

  window.addEventListener("resize", () => engine.resize());
}

const joinOverlay = document.getElementById("joinOverlay");
const nameInput = document.getElementById("nameInput");
const joinButton = document.getElementById("joinButton");

async function handleJoin() {
  const enteredName = nameInput.value.trim();
  playerName = enteredName || `Player-${Math.floor(Math.random() * 1000)}`;

  joinOverlay.style.display = "none";

  await unlockAudio();
  await launchApp();
}

if (joinButton && nameInput) {
  joinButton.addEventListener("click", handleJoin);

  nameInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      await handleJoin();
    }
  });
}

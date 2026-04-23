import * as BABYLON from "babylonjs";
import * as GUI from "babylonjs-gui";
import { io } from "socket.io-client";

import { startScene } from "./scenes/start.js";

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

let avatarContainer = null;
let localAvatarRoot = null;
let localAvatarParts = null;

let playerName = "Player";
let uiTexture = null;
const remoteNameLabels = new Map();

// Voice chat variables
let localStream = null;
const peerConnections = new Map();
const remoteAudioEls = new Map();
const remoteSounds = new Map();
const readySpatialSounds = new Set();

function cleanupRemoteAudio(playerId) {
  const audioEl = remoteAudioEls.get(playerId);
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
    } catch (err) {
      console.warn("[VOICE] audio cleanup issue:", playerId, err);
    }
    remoteAudioEls.delete(playerId);
  }

  const sound = remoteSounds.get(playerId);
  if (sound) {
    try {
      if (typeof sound.stop === "function") {
        sound.stop();
      }
    } catch (err) {
      console.warn("[VOICE] sound.stop issue:", playerId, err);
    }

    try {
      if (typeof sound.dispose === "function") {
        sound.dispose();
      }
    } catch (err) {
      console.warn("[VOICE] sound.dispose issue:", playerId, err);
    }

    remoteSounds.delete(playerId);
  }

  readySpatialSounds.delete(playerId);
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

async function loadAvatarTemplate(scene) {
  if (avatarContainer) return;

  avatarContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
    "/object-models/",
    "default-avatar.glb",
    scene
  );
}

function vec3From(obj) {
  return new BABYLON.Vector3(obj.x, obj.y, obj.z);
}

function quatFrom(obj) {
  return new BABYLON.Quaternion(obj.x, obj.y, obj.z, obj.w);
}

function worldToLocalPosition(node, worldPos) {
  const inv = node.getWorldMatrix().clone();
  inv.invert();
  return BABYLON.Vector3.TransformCoordinates(worldPos, inv);
}

async function ensureRemoteMesh(scene, id) {
  const existing = remoteMeshes.get(id);
  if (existing) return existing;

  const pending = pendingRemoteMeshes.get(id);
  if (pending) return await pending;

  const creationPromise = (async () => {
    await loadAvatarTemplate(scene);

    const root = new BABYLON.TransformNode(`remote_${id}`, scene);
    root.position = new BABYLON.Vector3(0, -0.9, 0);

    const instantiated = avatarContainer.instantiateModelsToScene(
      (name) => `${name}_${id}`,
      false
    );

    instantiated.rootNodes.forEach((node) => {
      node.parent = root;
      node.setEnabled(true);
    });

    const allChildren = root.getChildMeshes(false);

    const bodyMesh = allChildren.find((m) => m.name.includes("Body")) || null;
    const headMesh = allChildren.find((m) => m.name.includes("Head")) || null;
    const leftHandMesh = allChildren.find((m) => m.name.includes("Left Hand")) || null;
    const rightHandMesh = allChildren.find((m) => m.name.includes("Right Hand")) || null;

    const bodyAnchor = new BABYLON.TransformNode(`bodyAnchor_${id}`, scene);
    const headAnchor = new BABYLON.TransformNode(`headAnchor_${id}`, scene);
    const leftHandAnchor = new BABYLON.TransformNode(`leftHandAnchor_${id}`, scene);
    const rightHandAnchor = new BABYLON.TransformNode(`rightHandAnchor_${id}`, scene);
    const leftHandOffset = new BABYLON.TransformNode(`leftHandOffset_${id}`, scene);
    const rightHandOffset = new BABYLON.TransformNode(`rightHandOffset_${id}`, scene);
    const nameAnchor = new BABYLON.TransformNode(`nameAnchor_${id}`, scene);

    bodyAnchor.parent = root;
    headAnchor.parent = root;
    leftHandAnchor.parent = root;
    rightHandAnchor.parent = root;
    leftHandOffset.parent = leftHandAnchor;
    rightHandOffset.parent = rightHandAnchor;
    nameAnchor.parent = root;

    nameAnchor.position.set(0, 3.2, 0);

    // starting tweak values
    leftHandOffset.position.set(0, 0, 0);
    rightHandOffset.position.set(0, 0, 0);

    leftHandOffset.rotation.set(0, 0, 0);
    rightHandOffset.rotation.set(0, 0, 0);

    if (bodyMesh) bodyMesh.parent = bodyAnchor;
    if (headMesh) headMesh.parent = headAnchor;
    if (leftHandMesh) leftHandMesh.parent = leftHandOffset;
    if (rightHandMesh) rightHandMesh.parent = rightHandOffset;

    root.scaling.set(0.8, 0.8, 0.8);

    root.metadata = {
      bodyAnchor,
      headAnchor,
      leftHandAnchor,
      rightHandAnchor,
      leftHandOffset,
      rightHandOffset,
      nameAnchor,
      bodyMesh,
      headMesh,
      leftHandMesh,
      rightHandMesh,
    };

    const mirrorTex = scene?.mirrorTex;
    if (mirrorTex) {
      const avatarParts = [bodyMesh, headMesh, leftHandMesh, rightHandMesh].filter(Boolean);

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

  await loadAvatarTemplate(scene);

  const root = new BABYLON.TransformNode("localAvatar", scene);

  if (scene.playerMesh) {
    root.parent = scene.playerMesh;
    root.position = new BABYLON.Vector3(0, -1.6, 0);
  }

  const instantiated = avatarContainer.instantiateModelsToScene(
    (name) => `${name}_local`,
    false
  );

  instantiated.rootNodes.forEach((node) => {
    node.parent = root;
    node.setEnabled(true);
  });

  const allChildren = root.getChildMeshes(false);

  const bodyMesh = allChildren.find((m) => m.name.includes("Body")) || null;
  const headMesh = allChildren.find((m) => m.name.includes("Head")) || null;
  const leftHandMesh = allChildren.find((m) => m.name.includes("Left Hand")) || null;
  const rightHandMesh = allChildren.find((m) => m.name.includes("Right Hand")) || null;

  const bodyAnchor = new BABYLON.TransformNode("localBodyAnchor", scene);
  const headAnchor = new BABYLON.TransformNode("localHeadAnchor", scene);
  const leftHandAnchor = new BABYLON.TransformNode("localLeftHandAnchor", scene);
  const rightHandAnchor = new BABYLON.TransformNode("localRightHandAnchor", scene);
  const leftHandOffset = new BABYLON.TransformNode("localLeftHandOffset", scene);
  const rightHandOffset = new BABYLON.TransformNode("localRightHandOffset", scene);

  bodyAnchor.parent = root;
  headAnchor.parent = root;
  leftHandAnchor.parent = root;
  rightHandAnchor.parent = root;
  leftHandOffset.parent = leftHandAnchor;
  rightHandOffset.parent = rightHandAnchor;

  // starting tweak values
  leftHandOffset.position.set(0, 0, 0);
  rightHandOffset.position.set(0, 0, 0);

  leftHandOffset.rotation.set(0, 0, 0);
  rightHandOffset.rotation.set(0, 0, 0);

  if (bodyMesh) bodyMesh.parent = bodyAnchor;
  if (headMesh) headMesh.parent = headAnchor;
  if (leftHandMesh) leftHandMesh.parent = leftHandOffset;
  if (rightHandMesh) rightHandMesh.parent = rightHandOffset;

  root.scaling.set(0.8, 0.8, 0.8);
  root.position = new BABYLON.Vector3(0, -0.9, 0);

  // Hide local head in first person so it doesn't block the camera
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
    leftHandOffset,
    rightHandOffset,
  };

  const mirrorTex = scene?.mirrorTex;
  if (mirrorTex) {
    [bodyMesh, headMesh, leftHandMesh, rightHandMesh]
      .filter(Boolean)
      .forEach((part) => {
        if (!mirrorTex.renderList.includes(part)) {
          mirrorTex.renderList.push(part);
        }
      });
  }

  console.log(
    "[LOCAL AVATAR] created:",
    [bodyMesh, headMesh, leftHandMesh, rightHandMesh]
      .filter(Boolean)
      .map((m) => m.name)
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

  cleanupRemoteAudio(targetId);

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.controls = false;
  audio.style.display = "none";
  audio.srcObject = stream;
  document.body.appendChild(audio);
  remoteAudioEls.set(targetId, audio);

const sound = new BABYLON.Sound(
  `voice_${targetId}`,
  audio,
  sceneRef,
  null,
  {
    loop: true,
    autoplay: true,
    spatialSound: true,
    streaming: true,
    distanceModel: "linear",
    maxDistance: 8,
    refDistance: 1,
    rolloffFactor: 4
  }
);

remoteSounds.set(targetId, sound);
readySpatialSounds.add(targetId);

console.log("[VOICE] sound created for:", targetId);
console.log("[VOICE] spatialSound:", sound.spatialSound);

const remoteRoot = remoteMeshes.get(targetId);
const voiceMesh =
  remoteRoot?.metadata?.headMesh ||
  remoteRoot?.metadata?.bodyMesh ||
  remoteRoot;

if (voiceMesh) {
  try {
    sound.attachToMesh(voiceMesh);
    console.log("[VOICE] attached to voice mesh immediately:", targetId, voiceMesh.name);
  } catch (err) {
    console.warn("[VOICE] immediate attach failed:", targetId, err);
  }
} else {
  console.warn("[VOICE] no voice mesh yet for:", targetId);
}

sound.setVolume(1);

try {
  await audio.play();
  audio.volume = 0;
  console.log("[VOICE] Playback started for:", targetId);
} catch (err) {
  console.error("[VOICE] audio.play() failed for:", targetId, err);
}
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

  if (!sceneRef) return;

  const otherPlayers = Object.values(players || {}).filter(
    (p) => p?.id && p.id !== selfId
  );

  await Promise.all(otherPlayers.map((p) => ensureRemoteMesh(sceneRef, p.id)));
});

socket.on("playerJoined", async (p) => {
  if (!sceneRef || !p?.id || p.id === selfId) return;
  console.log("[NET] playerJoined:", p.id);

  await ensureRemoteMesh(sceneRef, p.id);

const existingSound = remoteSounds.get(p.id);
const existingMesh = remoteMeshes.get(p.id);
const voiceMesh =
  existingMesh?.metadata?.headMesh ||
  existingMesh?.metadata?.bodyMesh ||
  existingMesh;

if (existingSound && voiceMesh) {
  try {
    existingSound.attachToMesh(voiceMesh);
    console.log("[VOICE] late attach after playerJoined:", p.id, voiceMesh.name);
  } catch (err) {
    console.warn("[VOICE] late attach after playerJoined failed:", p.id, err);
  }
}

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
  } catch (err) {
    console.error("[VOICE] Error creating offer:", err);
  }
});

socket.on("playerLeft", (id) => {
  console.log("[NET] playerLeft:", id);
  removeRemoteMesh(id);
  cleanupRemoteAudio(id);
  removePeerConnection(id);
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

const existingSound = remoteSounds.get(id);
const voiceMesh =
  mesh?.metadata?.headMesh ||
  mesh?.metadata?.bodyMesh ||
  mesh;

if (existingSound && voiceMesh) {
  try {
    existingSound.attachToMesh(voiceMesh);

    const absPos = voiceMesh.getAbsolutePosition();
    console.log(
      "[VOICE] voice mesh world pos:",
      id,
      absPos.x,
      absPos.y,
      absPos.z
    );
  } catch (err) {
    console.warn("[VOICE] late attach failed:", id, err);
  }
}

    ensureRemoteNameLabel(id, mesh, p.name || "Player");

    mesh.position.set(
      p.root?.pos?.x ?? 0,
      p.root?.pos?.y ?? 0,
      p.root?.pos?.z ?? 0
    );

    console.log(
  "[VOICE] mesh moving:",
  id,
  "pos:",
  mesh.position.x,
  mesh.position.y,
  mesh.position.z
);

    mesh.rotation.y = p.root?.rotY ?? 0;

    const bodyAnchor = mesh.metadata?.bodyAnchor;
    const headAnchor = mesh.metadata?.headAnchor;
    const leftHandAnchor = mesh.metadata?.leftHandAnchor;
    const rightHandAnchor = mesh.metadata?.rightHandAnchor;

    if (bodyAnchor) {
      bodyAnchor.position.set(0, 0, 0);
      bodyAnchor.rotation.set(0, p.root?.rotY ?? 0, 0);
    }

    if (headAnchor && p.head?.pos && p.head?.rot) {
      const localHeadPos = worldToLocalPosition(
        mesh,
        new BABYLON.Vector3(p.head.pos.x, p.head.pos.y, p.head.pos.z)
      );

      headAnchor.position.copyFrom(localHeadPos);
      headAnchor.position.y += -1.0;
      headAnchor.rotationQuaternion = quatFrom(p.head.rot);
    }

    if (leftHandAnchor && p.leftHand?.pos && p.leftHand?.rot) {
      const localLeftPos = worldToLocalPosition(
        mesh,
        new BABYLON.Vector3(p.leftHand.pos.x, p.leftHand.pos.y, p.leftHand.pos.z)
      );

      leftHandAnchor.position.copyFrom(localLeftPos);
      leftHandAnchor.position.y += 0.2;
      leftHandAnchor.rotationQuaternion = quatFrom(p.leftHand.rot);
    }

    if (rightHandAnchor && p.rightHand?.pos && p.rightHand?.rot) {
      const localRightPos = worldToLocalPosition(
        mesh,
        new BABYLON.Vector3(p.rightHand.pos.x, p.rightHand.pos.y, p.rightHand.pos.z)
      );

      rightHandAnchor.position.copyFrom(localRightPos);
      rightHandAnchor.position.y += 0.2;
      rightHandAnchor.rotationQuaternion = quatFrom(p.rightHand.rot);
    }
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
  audioUnlocked = true;

  try {
    const testAudio = document.createElement("audio");
    testAudio.autoplay = true;
    testAudio.playsInline = true;
    document.body.appendChild(testAudio);
    await testAudio.play().catch(() => {});
    testAudio.remove();
    console.log("[VOICE] Audio unlocked");
  } catch (err) {
    console.warn("[VOICE] Audio unlock failed:", err);
  }
}

window.addEventListener("click", unlockAudio, { once: true });
window.addEventListener("touchstart", unlockAudio, { once: true });

async function main() {
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
  } catch (err) {
    console.error("[VOICE] Microphone error:", err);
  }

  const scene = await startScene(engine);
  sceneRef = scene;
  uiTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("nameUI", true, scene);

  await ensureLocalAvatar(scene);

  socket.connect();

  scene.debugLayer.show();

  const SEND_HZ = 15;
  let lastSend = 0;

  engine.runRenderLoop(() => {
    scene.render();

    if (!socket.connected || !scene.activeCamera) return;

    const now = performance.now();
    if (now - lastSend < 1000 / SEND_HZ) return;
    lastSend = now;

    const cam = scene.activeCamera;
    const pos = scene.playerMesh
      ? scene.playerMesh.position
      : cam.position;

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

      const cpos = grip.position;
      const crot = grip.rotationQuaternion || BABYLON.Quaternion.Identity();

      const tracked = {
        pos: { x: cpos.x, y: cpos.y, z: cpos.z },
        rot: { x: crot.x, y: crot.y, z: crot.z, w: crot.w },
      };

      if (handedness === "left") rightHand = tracked;
      if (handedness === "right") leftHand = tracked;
    }

    if (localAvatarParts) {
      localAvatarParts.root.rotation.set(0, 0, 0);

      if (localAvatarParts.bodyAnchor) {
        localAvatarParts.bodyAnchor.position.set(0, 0, 0);
        localAvatarParts.bodyAnchor.rotation.set(0, extractYaw(cam), 0);
      }

      const rootWorld = localAvatarParts.root;

      if (localAvatarParts.headAnchor) {
        const localHeadPos = worldToLocalPosition(
          rootWorld,
          new BABYLON.Vector3(headPos.x, headPos.y, headPos.z)
        );

        localAvatarParts.headAnchor.position.copyFrom(localHeadPos);
        localAvatarParts.headAnchor.position.y += -1.0;
        localAvatarParts.headAnchor.rotationQuaternion = quatFrom(headRot);
      }

      if (localAvatarParts.leftHandAnchor) {
        const localLeftPos = worldToLocalPosition(
          rootWorld,
          new BABYLON.Vector3(leftHand.pos.x, leftHand.pos.y, leftHand.pos.z)
        );

        localAvatarParts.leftHandAnchor.position.copyFrom(localLeftPos);
        localAvatarParts.leftHandAnchor.position.y += 0.2;
        localAvatarParts.leftHandAnchor.rotationQuaternion = quatFrom(leftHand.rot);
      }

      if (localAvatarParts.rightHandAnchor) {
        const localRightPos = worldToLocalPosition(
          rootWorld,
          new BABYLON.Vector3(rightHand.pos.x, rightHand.pos.y, rightHand.pos.z)
        );

        localAvatarParts.rightHandAnchor.position.copyFrom(localRightPos);
        localAvatarParts.rightHandAnchor.position.y += 0.2;
        localAvatarParts.rightHandAnchor.rotationQuaternion = quatFrom(rightHand.rot);
      }
    }

    socket.emit("pose", {
      name: playerName,
      root: {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        rotY: extractYaw(cam),
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
  await main();
}

joinButton.addEventListener("click", handleJoin);

nameInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await handleJoin();
  }
});
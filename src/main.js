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

async function ensureRemoteMesh(scene, id) {
  const existing = remoteMeshes.get(id);
  if (existing) return existing;

  const pending = pendingRemoteMeshes.get(id);
  if (pending) return await pending;

  const creationPromise = (async () => {
    await loadAvatarTemplate(scene);

    const root = new BABYLON.TransformNode(`remote_${id}`, scene);

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
    const nameAnchor = new BABYLON.TransformNode(`nameAnchor_${id}`, scene);

    bodyAnchor.parent = root;
    headAnchor.parent = root;
    leftHandAnchor.parent = root;
    rightHandAnchor.parent = root;
    nameAnchor.parent = root;

    nameAnchor.position.set(0, 3.2, 0);

    if (bodyMesh) bodyMesh.parent = bodyAnchor;
    if (headMesh) headMesh.parent = headAnchor;
    if (leftHandMesh) leftHandMesh.parent = leftHandAnchor;
    if (rightHandMesh) rightHandMesh.parent = rightHandAnchor;

    root.scaling.set(0.8, 0.8, 0.8);

    root.metadata = {
    bodyAnchor,
    headAnchor,
    leftHandAnchor,
    rightHandAnchor,
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

  bodyAnchor.parent = root;
  headAnchor.parent = root;
  leftHandAnchor.parent = root;
  rightHandAnchor.parent = root;

  if (bodyMesh) bodyMesh.parent = bodyAnchor;
  if (headMesh) headMesh.parent = headAnchor;
  if (leftHandMesh) leftHandMesh.parent = leftHandAnchor;
  if (rightHandMesh) rightHandMesh.parent = rightHandAnchor;

  root.scaling.set(0.8, 0.8, 0.8);

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

  const audio = remoteAudioEls.get(id);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioEls.delete(id);
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

    let audio = remoteAudioEls.get(targetId);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.controls = false;
      audio.style.display = "none";
      document.body.appendChild(audio);
      remoteAudioEls.set(targetId, audio);
    }

    audio.srcObject = event.streams[0];

    try {
      await audio.play();
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

    ensureRemoteNameLabel(id, mesh, p.name || "Player");

    mesh.position.set(
      p.root?.pos?.x ?? 0,
      (p.root?.pos?.y ?? 0) - 1.6,
      p.root?.pos?.z ?? 0
    );
    mesh.rotation.y = p.root?.rotY ?? 0;

    const bodyAnchor = mesh.metadata?.bodyAnchor;
    const headAnchor = mesh.metadata?.headAnchor;
    const leftHandAnchor = mesh.metadata?.leftHandAnchor;
    const rightHandAnchor = mesh.metadata?.rightHandAnchor;

    if (bodyAnchor) {
      bodyAnchor.position.set(0, 0, 0);
      bodyAnchor.rotation.set(0, 0, 0);
    }

    if (headAnchor && p.head?.pos && p.head?.rot && p.root?.pos) {
      headAnchor.position = vec3From({
        x: p.head.pos.x - p.root.pos.x,
        y: p.head.pos.y - p.root.pos.y + .15,
        z: p.head.pos.z - p.root.pos.z,
      });
      headAnchor.rotationQuaternion = quatFrom(p.head.rot);
    }

    if (leftHandAnchor && p.leftHand?.pos && p.leftHand?.rot && p.root?.pos) {
      leftHandAnchor.position = vec3From({
        x: p.leftHand.pos.x - p.root.pos.x,
        y: p.leftHand.pos.y - p.root.pos.y + .2,
        z: p.leftHand.pos.z - p.root.pos.z,
      });
      leftHandAnchor.rotationQuaternion = quatFrom(p.leftHand.rot);
    }

    if (rightHandAnchor && p.rightHand?.pos && p.rightHand?.rot && p.root?.pos) {
      rightHandAnchor.position = vec3From({
        x: p.rightHand.pos.x - p.root.pos.x,
        y: p.rightHand.pos.y - p.root.pos.y + .2,
        z: p.rightHand.pos.z - p.root.pos.z,
      });
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
    const pos = cam.position;

    let headPos = { x: pos.x, y: pos.y, z: pos.z };
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

      if (handedness === "left") leftHand = tracked;
      if (handedness === "right") rightHand = tracked;
    }

    if (localAvatarParts) {
  localAvatarParts.root.position.set(pos.x, pos.y - 1.6, pos.z);
  localAvatarParts.root.rotation.y = extractYaw(cam);

  if (localAvatarParts.bodyAnchor) {
    localAvatarParts.bodyAnchor.position.set(0, 0, 0);
    localAvatarParts.bodyAnchor.rotation.set(0, 0, 0);
  }

  if (localAvatarParts.headAnchor) {
    localAvatarParts.headAnchor.position = vec3From({
      x: headPos.x - pos.x,
      y: headPos.y - pos.y + 0.1,
      z: headPos.z - pos.z,
    });
    localAvatarParts.headAnchor.rotationQuaternion = quatFrom(headRot);
  }

  if (localAvatarParts.leftHandAnchor) {
    localAvatarParts.leftHandAnchor.position = vec3From({
      x: leftHand.pos.x - pos.x,
      y: leftHand.pos.y - pos.y + 0.2,
      z: leftHand.pos.z - pos.z,
    });
    localAvatarParts.leftHandAnchor.rotationQuaternion = quatFrom(leftHand.rot);
  }

  if (localAvatarParts.rightHandAnchor) {
    localAvatarParts.rightHandAnchor.position = vec3From({
      x: rightHand.pos.x - pos.x,
      y: rightHand.pos.y - pos.y + 0.2,
      z: rightHand.pos.z - pos.z,
    });
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
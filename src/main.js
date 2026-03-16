import * as BABYLON from "babylonjs";
import "babylonjs-inspector";
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

let avatarTemplateRoot = null;
let avatarTemplateMeshes = [];

// Voice chat variables
let localStream = null;
const peerConnections = new Map();

async function loadAvatarTemplate(scene) {
  if (avatarTemplateRoot) return;

  const result = await BABYLON.SceneLoader.ImportMeshAsync(
    null,
    "/object-models/",
    "default-avatar.glb",
    scene
  );

  avatarTemplateRoot = new BABYLON.TransformNode("avatarTemplateRoot", scene);

  result.meshes.forEach((mesh) => {
    if (mesh === avatarTemplateRoot) return;

    if (mesh.parent == null) {
      mesh.parent = avatarTemplateRoot;
    }

    mesh.setEnabled(false);
  });

  avatarTemplateRoot.setEnabled(false);
  avatarTemplateMeshes = result.meshes;
}

async function ensureRemoteMesh(scene, id) {
  const existing = remoteMeshes.get(id);
  if (existing) return existing;

  const pending = pendingRemoteMeshes.get(id);
  if (pending) return await pending;

  const creationPromise = (async () => {
    await loadAvatarTemplate(scene);

    const root = new BABYLON.TransformNode(`remote_${id}`, scene);

    avatarTemplateMeshes.forEach((mesh) => {
      if (!(mesh instanceof BABYLON.Mesh)) return;
      if (mesh === avatarTemplateRoot) return;

      const clone = mesh.clone(`${mesh.name}_${id}`);
      if (!clone) return;

      clone.setEnabled(true);
      clone.parent = root;
    });

    root.scaling.set(.8, .8, .8);
    root.position.y = 0;

    remoteMeshes.set(id, root);
    pendingRemoteMeshes.delete(id);
    return root;
  })();

  pendingRemoteMeshes.set(id, creationPromise);
  return await creationPromise;
}

function removeRemoteMesh(id) {
  pendingRemoteMeshes.delete(id);

  const root = remoteMeshes.get(id);
  if (root) {
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

const remoteAudioEls = new Map();

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

  await Promise.all(
  otherPlayers.map((p) => ensureRemoteMesh(sceneRef, p.id))
);
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

socket.on("playersUpdate", (players) => {
  if (!sceneRef || !players) return;

  for (const [id, p] of Object.entries(players)) {
    if (id === selfId) continue;

    let mesh = remoteMeshes.get(id);

    if (!mesh) {
      ensureRemoteMesh(sceneRef, id);
      continue;
    }

    if (p?.pos) {
      mesh.position.set(p.pos.x, p.pos.y - 2.2, p.pos.z);
    }
    if (typeof p?.rotY === "number") {
      mesh.rotation.y = p.rotY;
    }
  }
});

socket.on("webrtc-offer", async ({ fromId, offer }) => {
  try {
    console.log("[VOICE] Received offer from:", fromId);

    const pc = createPeerConnection(fromId);
    if(!pc) return;

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

  // Request microphone access
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


  scene.debugLayer.show();

  socket.connect();

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

    socket.emit("pose", {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      rotY: extractYaw(cam),
    });
  });

  window.addEventListener("resize", () => engine.resize());
}

main();
import * as BABYLON from "babylonjs";
import "babylonjs-inspector";
import { io } from "socket.io-client";

import { startScene } from "./scenes/start.js";


const socket = io({
  transports: ["websocket", "polling"],
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

// Voice chat variables
let localStream = null;
const peerConnections = new Map();

function ensureRemoteMesh(scene, id) {
  let mesh = remoteMeshes.get(id);
  if (mesh) return mesh;

  mesh = BABYLON.MeshBuilder.CreateBox(`remote_${id}`, { size: 0.35 }, scene);
  mesh.position.y = 1.6;

  remoteMeshes.set(id, mesh);
  return mesh;
}

function removeRemoteMesh(id) {
  const mesh = remoteMeshes.get(id);
  if (mesh) {
    mesh.dispose();
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

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", {
        targetId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    console.log("[VOICE] Receiving audio from:", targetId);

    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
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

  otherPlayers.forEach((p) => {
    ensureRemoteMesh(sceneRef, p.id);
  });

  for (const p of otherPlayers) {
    try {
      const pc = createPeerConnection(p.id);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        targetId: p.id,
        offer,
      });

      console.log("[VOICE] Sent offer to existing player:", p.id);
    } catch (err) {
      console.error("[VOICE] Error calling existing player:", err);
    }
  }
});

socket.on("playerJoined", async (p) => {
  if (!sceneRef || !p?.id || p.id === selfId) return;
  console.log("[NET] playerJoined:", p.id);
  ensureRemoteMesh(sceneRef, p.id);

  try {
    const pc = createPeerConnection(p.id);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("webrtc-offer", {
      targetId: p.id,
      offer,
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

    const mesh = ensureRemoteMesh(sceneRef, id);

    if (p?.pos) {
      mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
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

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("webrtc-answer", {
      targetId: fromId,
      answer,
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

async function main() {

  // Request microphone access
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[VOICE] Microphone ready");
  } catch (err) {
    console.error("[VOICE] Microphone error:", err);
  }

  const scene = await startScene(engine);
  sceneRef = scene;


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

    socket.emit("pose", {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      rotY: extractYaw(cam),
    });
  });

  window.addEventListener("resize", () => engine.resize());
}

main();
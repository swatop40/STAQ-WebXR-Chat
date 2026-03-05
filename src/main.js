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


socket.on("init", ({ selfId: id, players }) => {
  selfId = id;
  console.log("[NET] init selfId:", selfId);

  if (!sceneRef) return;


  Object.values(players || {}).forEach((p) => {
    if (p?.id && p.id !== selfId) ensureRemoteMesh(sceneRef, p.id);
  });
});

socket.on("playerJoined", (p) => {
  if (!sceneRef || !p?.id || p.id === selfId) return;
  console.log("[NET] playerJoined:", p.id);
  ensureRemoteMesh(sceneRef, p.id);
});

socket.on("playerLeft", (id) => {
  console.log("[NET] playerLeft:", id);
  removeRemoteMesh(id);
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


async function main() {
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
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
app.use(cors());

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const players = new Map();
const karaokeSongsDir = path.resolve(process.cwd(), "public", "karaoke-songs");
const supportedKaraokeExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function makeTrackTitle(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.get("/api/karaoke-songs", async (_req, res) => {
  try {
    const entries = await fs.readdir(karaokeSongsDir, { withFileTypes: true });
    const tracks = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => supportedKaraokeExtensions.has(path.extname(name).toLowerCase()))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        title: makeTrackTitle(name),
        url: `/karaoke-songs/${encodeURIComponent(name)}`,
        artist: "",
        fileName: name,
      }));

    res.json({ tracks });
  } catch (error) {
    console.error("[KARAOKE] Failed to read karaoke songs directory", error);
    res.status(500).json({ tracks: [], error: "Failed to read karaoke songs directory" });
  }
});

function makeSpawn() {
  return { x: (Math.random() - 0.5) * 2, y: 1.6, z: (Math.random() - 0.5) * 2 };
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  players.set(socket.id, {
  id: socket.id,
  name: "Player",
  room: "lobby",
  avatarMode: "desktop",
  root: {
    pos: makeSpawn(),
    rotY: 0,
    scale: 1,
  },
  head: {
    pos: { x: 0, y: 1.6, z: 0 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
  },
  leftHand: {
    pos: { x: -0.25, y: 1.3, z: 0.2 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
  },
  rightHand: {
    pos: { x: 0.25, y: 1.3, z: 0.2 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
  },
});

  socket.emit("init", {
    selfId: socket.id,
    players: Object.fromEntries(players),
  });

  socket.broadcast.emit("playerJoined", players.get(socket.id));

  socket.on("pose", (data) => {
  const p = players.get(socket.id);
  if (!p || !data) return;

  if (typeof data.name === "string" && data.name.trim()) {
    p.name = data.name.trim().slice(0, 20);
  }

  if (data.avatarMode === "vr" || data.avatarMode === "desktop") {
    p.avatarMode = data.avatarMode;
  }

  if (data.root?.pos && typeof data.root.pos.x === "number") {
    p.root.pos = {
      x: data.root.pos.x,
      y: data.root.pos.y,
      z: data.root.pos.z,
    };
  }

  if (typeof data.root?.rotY === "number") {
    p.root.rotY = data.root.rotY;
  }

  if (typeof data.root?.scale === "number") {
    p.root.scale = data.root.scale;
  }

  if (data.head?.pos && typeof data.head.pos.x === "number") {
    p.head.pos = {
      x: data.head.pos.x,
      y: data.head.pos.y,
      z: data.head.pos.z,
    };
  }

  if (data.head?.rot && typeof data.head.rot.w === "number") {
    p.head.rot = {
      x: data.head.rot.x,
      y: data.head.rot.y,
      z: data.head.rot.z,
      w: data.head.rot.w,
    };
  }

  if (data.leftHand?.pos && typeof data.leftHand.pos.x === "number") {
    p.leftHand.pos = {
      x: data.leftHand.pos.x,
      y: data.leftHand.pos.y,
      z: data.leftHand.pos.z,
    };
  }

  if (data.leftHand?.rot && typeof data.leftHand.rot.w === "number") {
    p.leftHand.rot = {
      x: data.leftHand.rot.x,
      y: data.leftHand.rot.y,
      z: data.leftHand.rot.z,
      w: data.leftHand.rot.w,
    };
  }

  if (data.rightHand?.pos && typeof data.rightHand.pos.x === "number") {
    p.rightHand.pos = {
      x: data.rightHand.pos.x,
      y: data.rightHand.pos.y,
      z: data.rightHand.pos.z,
    };
  }

  if (data.rightHand?.rot && typeof data.rightHand.rot.w === "number") {
    p.rightHand.rot = {
      x: data.rightHand.rot.x,
      y: data.rightHand.rot.y,
      z: data.rightHand.rot.z,
      w: data.rightHand.rot.w,
    };
  }
});

//WEBRTC SIGNALING

// When a player sends a WebRTC offer
  socket.on("webrtc-offer", ({ targetId, offer }) => {
    io.to(targetId).emit("webrtc-offer", {
    fromId: socket.id,
    offer,
  });
});

// When a player sends an answer
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    io.to(targetId).emit("webrtc-answer", {
    fromId: socket.id,
    answer,
  });
});

// ICE candidate exchange
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("webrtc-ice-candidate", {
    fromId: socket.id,
    candidate,
  });
});

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    players.delete(socket.id);
    io.emit("playerLeft", socket.id);
  });
});

const TICK_HZ = 15;
setInterval(() => {
  io.emit("playersUpdate", Object.fromEntries(players));
}, 1000 / TICK_HZ);

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

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
const chatMessages = [];
const MAX_CHAT_MESSAGES = 40;
const SCENE_STATE_SCOPES = new Set(["object", "dart", "dartGame", "tv", "picture"]);
const sceneState = {
  object: {},
  dart: {},
  dartGame: {},
  tv: {},
  picture: {},
};

const SCENE_CAPACITY = {
  start: 3,
  bar: 3,
  parking: 3,
};


const tvDebugPlaybackByKey = new Map();
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

function sanitizeChatText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function sanitizeSceneStateValue(value, depth = 0) {
  if (depth > 6) return null;

  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 64)
      .map((entry) => sanitizeSceneStateValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
      next[key] = sanitizeSceneStateValue(entry, depth + 1);
    }
    return next;
  }

  return null;
}

function sanitizeSceneStateUpdate(payload) {
  if (!payload || typeof payload !== "object") return null;

  const scope = typeof payload.scope === "string" ? payload.scope : "";
  const key = typeof payload.key === "string" ? payload.key.slice(0, 120) : "";
  if (!SCENE_STATE_SCOPES.has(scope) || !key) return null;

  const state = sanitizeSceneStateValue(payload.state);
  if (!state || typeof state !== "object") return null;

  return { scope, key, state };
}

function applySceneStateUpdate({ scope, key, state }, actorId = null) {
  const current = sceneState[scope][key] || {};
  const next = {
    ...current,
    ...state,
    updatedAt: Date.now(),
  };

  if (actorId) {
    next.lastActorId = actorId;
  }

  sceneState[scope][key] = next;
  return next;
}

function clearDisconnectedOwnership(disconnectedId) {
  for (const scope of ["object", "dart"]) {
    for (const [key, state] of Object.entries(sceneState[scope])) {
      if (state?.ownerId !== disconnectedId) continue;

      sceneState[scope][key] = {
        ...state,
        ownerId: null,
        isHeld: false,
        updatedAt: Date.now(),
      };

      io.emit("scene-state-update", {
        scope,
        key,
        state: sceneState[scope][key],
      });
    }
  }
}

function resetSharedRoomState() {
  chatMessages.length = 0;
  sceneState.object = {};
  sceneState.dart = {};
  sceneState.dartGame = {};
  sceneState.tv = {};
  sceneState.picture = {};
  tvDebugPlaybackByKey.clear();
}

function getSceneCounts() {
  const counts = {
    start: 0,
    bar: 0,
    parking: 0,
  };

  for (const player of players.values()) {
    const room = player.room;
    if (counts[room] !== undefined) {
      counts[room]++;
    }
  }

  return counts;
}

function broadcastSceneCounts() {
  io.emit("sceneCounts", getSceneCounts());
}

function maybeBroadcastTVDebugMessage(socketId, update, nextState) {
  if (update?.scope !== "tv" || !update.key || !nextState) return;

  const isPlaying = !!nextState.currentTrack?.url && nextState.paused === false;
  const previousSignature = tvDebugPlaybackByKey.get(update.key) || null;
  const nextSignature = isPlaying
    ? `${nextState.currentTrack.url}|${nextState.paused === false ? "playing" : "paused"}`
    : null;

  if (previousSignature === nextSignature) return;

  if (nextSignature) {
    tvDebugPlaybackByKey.set(update.key, nextSignature);
  } else {
    tvDebugPlaybackByKey.delete(update.key);
  }

  if (!isPlaying) return;

  const player = players.get(socketId);
  io.emit("tv-debug-message", {
    tvKey: update.key,
    senderId: socketId,
    senderName: player?.name || "Player",
    title: nextState.currentTrack.title || "Unknown Song",
    url: nextState.currentTrack.url || null,
    action: "play",
    createdAt: Date.now(),
  });
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  
  socket.join("lobby");
  socket.currentRoom = "lobby";

  players.set(socket.id, {
  id: socket.id,
  name: "Player",
  room: "lobby",
  avatarMode: "desktop",
  avatarCustomization: null,
  speaking: false,
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

  socket.on("joinScene", (sceneId) => {
      const player = players.get(socket.id);
      if (!player) return;

      const counts = getSceneCounts();
      const max = SCENE_CAPACITY[sceneId] || 9999;

      

      if ((counts[sceneId] || 0) >= max) {
        socket.emit("sceneFull", { sceneId, max });
        return;
      }

      const prevRoom = socket.currentRoom || "lobby";
      socket.leave(prevRoom);

      socket.join(sceneId);
      socket.currentRoom = sceneId;
      player.room = sceneId;

      const roomPlayers = Object.fromEntries(
        [...players.entries()].filter(([_, p]) => p.room === sceneId)
      );

      socket.emit("init", {
        selfId: socket.id,
        players: roomPlayers,
        chatMessages,
        sceneState,
      });

      socket.to(sceneId).emit("playerJoined", player);
      broadcastSceneCounts();
    });

  socket.to(socket.currentRoom).emit("playerJoined", players.get(socket.id));

  socket.on("pose", (data) => {
  const p = players.get(socket.id);
  if (!p || !data) return;

  if (typeof data.name === "string" && data.name.trim()) {
    p.name = data.name.trim().slice(0, 20);
  }

  if (data.avatarMode === "vr" || data.avatarMode === "desktop") {
    p.avatarMode = data.avatarMode;
  }

  if (typeof data.speaking === "boolean") {
    p.speaking = data.speaking;
  }

  if (data.avatarCustomization && typeof data.avatarCustomization === "object") {
    p.avatarCustomization = {
      body: typeof data.avatarCustomization.body === "string" ? data.avatarCustomization.body : null,
      head: typeof data.avatarCustomization.head === "string" ? data.avatarCustomization.head : null,
      arms: typeof data.avatarCustomization.arms === "string" ? data.avatarCustomization.arms : null,
      legs: typeof data.avatarCustomization.legs === "string" ? data.avatarCustomization.legs : null,
      hands: typeof data.avatarCustomization.hands === "string" ? data.avatarCustomization.hands : null,
      badge: typeof data.avatarCustomization.badge === "string" ? data.avatarCustomization.badge : null,
      badgeText: typeof data.avatarCustomization.badgeText === "string" ? data.avatarCustomization.badgeText : null,
      faceExpression: typeof data.avatarCustomization.faceExpression === "string"
        ? data.avatarCustomization.faceExpression.slice(0, 4)
        : null,
    };
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

  socket.on("chat-message", ({ text }) => {
    const player = players.get(socket.id);
    const cleanText = sanitizeChatText(text);
    if (!player || !cleanText) return;

    const message = {
      id: `${Date.now()}-${socket.id}`,
      senderId: socket.id,
      senderName: player.name || "Player",
      text: cleanText,
      createdAt: Date.now(),
    };

    chatMessages.push(message);
    while (chatMessages.length > MAX_CHAT_MESSAGES) {
      chatMessages.shift();
    }

    io.to(player.room).emit("chat-message", message);
  });

  socket.on("scene-state-update", (payload, ack) => {
    const update = sanitizeSceneStateUpdate(payload);
    if (!update) {
      ack?.({ ok: false, reason: "invalid-update" });
      return;
    }

    const nextState = applySceneStateUpdate(update, socket.id);
    maybeBroadcastTVDebugMessage(socket.id, update, nextState);
    const player = players.get(socket.id);
    io.to(player.room).emit("scene-state-update", {
      scope: update.scope,
      key: update.key,
      state: nextState,
    });
    ack?.({
      ok: true,
      scope: update.scope,
      key: update.key,
      lastActorId: nextState.lastActorId || null,
      updatedAt: nextState.updatedAt || null,
    });
  });

  socket.on("tv-debug-message", (payload) => {
    const player = players.get(socket.id);
    io.emit("tv-debug-message", {
      tvKey: typeof payload?.tvKey === "string" ? payload.tvKey.slice(0, 120) : "",
      senderId: socket.id,
      senderName: player?.name || "Player",
      title: typeof payload?.title === "string" ? payload.title.slice(0, 240) : "Unknown Song",
      url: typeof payload?.url === "string" ? payload.url : null,
      action: typeof payload?.action === "string" ? payload.action : "play",
      createdAt: Date.now(),
    });
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
    clearDisconnectedOwnership(socket.id);
    if (players.size === 0) {
      resetSharedRoomState();
    }
    const room = socket.currentRoom;
    if (room) {
     io.to(room).emit("playerLeft", socket.id);

     broadcastSceneCounts();
    }
  });
});

const TICK_HZ = 15;
setInterval(() => {
  const rooms = new Set([...players.values()].map(p => p.room));

  for (const room of rooms) {
    const roomPlayers = Object.fromEntries(
      [...players.entries()].filter(([_, p]) => p.room === room)
    );

    io.to(room).emit("playersUpdate", roomPlayers);
  }
}, 1000 / TICK_HZ);

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

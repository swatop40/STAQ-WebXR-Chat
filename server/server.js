import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import { sanitizeChatText, sanitizeDisplayName } from "../src/utils/textModeration.js";
import { fileURLToPath } from "node:url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const karaokeSongsDir = path.join(repoRoot, "public", "karaoke-songs");
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (() => {
  const rawValue = process.env.CORS_ORIGIN?.trim();
  if (!rawValue || rawValue === "*") {
    return "*";
  }

  const origins = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : "*";
})();

function validateCorsOrigin(origin, callback) {
  if (!origin || allowedOrigins === "*") {
    callback(null, true);
    return;
  }

  callback(null, allowedOrigins.includes(origin));
}

app.use(cors({ origin: validateCorsOrigin }));

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: validateCorsOrigin },
});

const DEFAULT_WEBRTC_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);

function parseIceServerUrls(value) {
  if (typeof value !== "string") return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeIceServer(entry) {
  if (!entry || typeof entry !== "object") return null;

  const urls = Array.isArray(entry.urls)
    ? entry.urls.map((value) => String(value).trim()).filter(Boolean)
    : typeof entry.urls === "string"
      ? entry.urls.trim()
      : "";

  if ((Array.isArray(urls) && urls.length === 0) || (!Array.isArray(urls) && !urls)) {
    return null;
  }

  const next = { urls };

  if (typeof entry.username === "string" && entry.username.trim()) {
    next.username = entry.username.trim();
  }

  if (typeof entry.credential === "string" && entry.credential.trim()) {
    next.credential = entry.credential.trim();
  }

  if (typeof entry.credentialType === "string" && entry.credentialType.trim()) {
    next.credentialType = entry.credentialType.trim();
  }

  return next;
}

function parseIceServersFromJson(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const servers = parsed
      .map((entry) => sanitizeIceServer(entry))
      .filter(Boolean);

    return servers.length > 0 ? servers : null;
  } catch (error) {
    console.warn("[VOICE] Failed to parse WEBRTC_ICE_SERVERS JSON", error);
    return null;
  }
}

function buildWebRTCIceServers() {
  const fromJson = parseIceServersFromJson(process.env.WEBRTC_ICE_SERVERS);
  if (fromJson) {
    return fromJson;
  }

  const servers = [];
  const stunUrls = parseIceServerUrls(process.env.STUN_URLS);
  if (stunUrls.length > 0) {
    servers.push({
      urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls,
    });
  }

  const turnUrls = parseIceServerUrls(process.env.TURN_URLS);
  if (turnUrls.length > 0) {
    const turnServer = {
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
    };

    if (process.env.TURN_USERNAME?.trim()) {
      turnServer.username = process.env.TURN_USERNAME.trim();
    }

    if (process.env.TURN_CREDENTIAL?.trim()) {
      turnServer.credential = process.env.TURN_CREDENTIAL.trim();
    }

    if (process.env.TURN_CREDENTIAL_TYPE?.trim()) {
      turnServer.credentialType = process.env.TURN_CREDENTIAL_TYPE.trim();
    }

    servers.push(turnServer);
  }

  return servers.length > 0 ? servers : [...DEFAULT_WEBRTC_ICE_SERVERS];
}

const webRtcConfig = Object.freeze({
  iceServers: buildWebRTCIceServers(),
});

const SCENE_CAPACITY = {
  start: 10,
  bar: 10,
  parking: 10,
};

const players = new Map();
const MAX_CHAT_MESSAGES = 40;
const EMPTY_ROOM_RESET_MS = 30_000;
const SCENE_STATE_SCOPES = new Set(["object", "dart", "dartGame", "tv", "picture"]);
const supportedKaraokeExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const roomStateById = new Map();
const roomResetTimers = new Map();

function createEmptyRoomState() {
  return {
    chatMessages: [],
    sceneState: {
      object: {},
      dart: {},
      dartGame: {},
      tv: {},
      picture: {},
    },
    tvDebugPlaybackByKey: new Map(),
  };
}

function getRoomState(roomId) {
  if (!roomId || !SCENE_CAPACITY[roomId]) {
    return createEmptyRoomState();
  }

  let roomState = roomStateById.get(roomId);
  if (!roomState) {
    roomState = createEmptyRoomState();
    roomStateById.set(roomId, roomState);
  }

  return roomState;
}

function getRoomPlayerCount(roomId) {
  let count = 0;
  for (const player of players.values()) {
    if (player.room === roomId) {
      count += 1;
    }
  }
  return count;
}

function cancelRoomReset(roomId) {
  const timer = roomResetTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    roomResetTimers.delete(roomId);
  }
}

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    players: players.size,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get("/api/webrtc-config", (_req, res) => {
  res.json(webRtcConfig);
});

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

if (syncFs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

function makeSpawn() {
  return { x: (Math.random() - 0.5) * 2, y: 1.6, z: (Math.random() - 0.5) * 2 };
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
  const player = actorId ? players.get(actorId) : null;
  const roomState = getRoomState(player?.room);
  const current = roomState.sceneState[scope][key] || {};
  const next = {
    ...current,
    ...state,
    updatedAt: Date.now(),
  };

  if (actorId) {
    next.lastActorId = actorId;
  }

  roomState.sceneState[scope][key] = next;
  return next;
}

function clearDisconnectedOwnership(disconnectedId, roomId) {
  if (!roomId || !SCENE_CAPACITY[roomId]) return;

  const roomState = getRoomState(roomId);
  for (const scope of ["object", "dart"]) {
    for (const [key, state] of Object.entries(roomState.sceneState[scope])) {
      if (state?.ownerId !== disconnectedId) continue;

      roomState.sceneState[scope][key] = {
        ...state,
        ownerId: null,
        isHeld: false,
        updatedAt: Date.now(),
      };

      io.to(roomId).emit("scene-state-update", {
        scope,
        key,
        state: roomState.sceneState[scope][key],
      });
    }
  }
}

function resetRoomState(roomId) {
  if (!roomId || !SCENE_CAPACITY[roomId]) return;

  roomStateById.set(roomId, createEmptyRoomState());
  console.log(`[ROOM] Reset state for ${roomId} after ${EMPTY_ROOM_RESET_MS}ms empty`);
}

function scheduleRoomResetIfEmpty(roomId) {
  if (!roomId || !SCENE_CAPACITY[roomId]) return;
  if (getRoomPlayerCount(roomId) > 0) return;
  if (roomResetTimers.has(roomId)) return;

  const timeoutId = setTimeout(() => {
    roomResetTimers.delete(roomId);
    if (getRoomPlayerCount(roomId) > 0) {
      return;
    }

    resetRoomState(roomId);
  }, EMPTY_ROOM_RESET_MS);

  roomResetTimers.set(roomId, timeoutId);
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

function RelayToSelectedRoom(fromId, targetId) {
  const fromPlayer = players.get(fromId);
  const targetPlayer = players.get(targetId);

  if (!fromPlayer || !targetPlayer) return false;
  if (!fromPlayer.room || fromPlayer.room !== targetPlayer.room) return false;
  if (!SCENE_CAPACITY[fromPlayer.room]) return false;

  return true;
}

function maybeBroadcastTVDebugMessage(socketId, update, nextState) {
  if (update?.scope !== "tv" || !update.key || !nextState) return;

  const isPlaying = !!nextState.currentTrack?.url && nextState.paused === false;
  const player = players.get(socketId);
  const roomId = player?.room;
  if (!roomId || !SCENE_CAPACITY[roomId]) return;

  const roomState = getRoomState(roomId);
  const previousSignature = roomState.tvDebugPlaybackByKey.get(update.key) || null;
  const nextSignature = isPlaying
    ? `${nextState.currentTrack.url}|${nextState.paused === false ? "playing" : "paused"}`
    : null;

  if (previousSignature === nextSignature) return;

  if (nextSignature) {
    roomState.tvDebugPlaybackByKey.set(update.key, nextSignature);
  } else {
    roomState.tvDebugPlaybackByKey.delete(update.key);
  }

  if (!isPlaying) return;

  io.to(roomId).emit("tv-debug-message", {
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
  
  socket.emit("sceneCounts", getSceneCounts());

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

      const max = SCENE_CAPACITY[sceneId] || 9999;

      const currentCount = getRoomPlayerCount(sceneId);

      if (currentCount >= max) {
        socket.emit("sceneFull", { sceneId, max });
        return;
      }

      const prevRoom = socket.currentRoom || "lobby";
      socket.leave(prevRoom);

      socket.join(sceneId);
      socket.currentRoom = sceneId;
      player.room = sceneId;
      cancelRoomReset(sceneId);
      scheduleRoomResetIfEmpty(prevRoom);

      const roomState = getRoomState(sceneId);

      const roomPlayers = Object.fromEntries(
        [...players.entries()].filter(([_, p]) => p.room === sceneId)
      );

      socket.emit("init", {
        selfId: socket.id,
        players: roomPlayers,
        chatMessages: roomState.chatMessages,
        sceneState: roomState.sceneState,
      });

      socket.to(sceneId).emit("playerJoined", player);
      broadcastSceneCounts();
    });

  socket.on("pose", (data) => {
  const p = players.get(socket.id);
  if (!p || !data) return;

  if (typeof data.name === "string" && data.name.trim()) {
    p.name = sanitizeDisplayName(data.name, p.name || "Player");
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
    if (!SCENE_CAPACITY[player.room]) return;

    const roomState = getRoomState(player.room);

    const message = {
      id: `${Date.now()}-${socket.id}`,
      senderId: socket.id,
      senderName: player.name || "Player",
      text: cleanText,
      createdAt: Date.now(),
    };

    roomState.chatMessages.push(message);
    while (roomState.chatMessages.length > MAX_CHAT_MESSAGES) {
      roomState.chatMessages.shift();
    }

    io.to(player.room).emit("chat-message", message);
  });

  socket.on("scene-state-update", (payload, ack) => {
    const player = players.get(socket.id);
    const update = sanitizeSceneStateUpdate(payload);
    if (!player || !update || !SCENE_CAPACITY[player.room]) {
      ack?.({ ok: false, reason: "invalid-update" });
      return;
    }

    const nextState = applySceneStateUpdate(update, socket.id);
    maybeBroadcastTVDebugMessage(socket.id, update, nextState);
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
    io.to(player.room).emit("tv-debug-message", {
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
    if (!RelayToSelectedRoom(socket.id, targetId)) return;

    io.to(targetId).emit("webrtc-offer", {
    fromId: socket.id,
    offer,
  });
});

// When a player sends an answer
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    if (!RelayToSelectedRoom(socket.id, targetId)) return;

    io.to(targetId).emit("webrtc-answer", {
    fromId: socket.id,
    answer,
  });
});

// ICE candidate exchange
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    if (!RelayToSelectedRoom(socket.id, targetId)) return;

    io.to(targetId).emit("webrtc-ice-candidate", {
    fromId: socket.id,
    candidate,
  });
});

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    const player = players.get(socket.id);
    const room = player?.room || socket.currentRoom;
    clearDisconnectedOwnership(socket.id, room);
    players.delete(socket.id);
    scheduleRoomResetIfEmpty(room);
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

app.get("/", (_req, res) => {
  if (syncFs.existsSync(path.join(distDir, "index.html"))) {
    res.sendFile(path.join(distDir, "index.html"));
    return;
  }

  res.status(503).json({
    error: "Frontend build not found. Run `npm run build` before starting production server.",
  });
});

app.get("/choose-scene.html", (_req, res) => {
  if (syncFs.existsSync(path.join(distDir, "choose-scene.html"))) {
    res.sendFile(path.join(distDir, "choose-scene.html"));
    return;
  }

  res.status(404).json({ error: "choose-scene.html not found in dist output" });
});

const PORT = Number(process.env.PORT || 3000);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

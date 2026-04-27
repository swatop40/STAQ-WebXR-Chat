import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const TRUST_PROXY = process.env.TRUST_PROXY;
const karaokeSongsDir = path.resolve(process.cwd(), "public", "karaoke-songs");
const supportedKaraokeExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const players = new Map();
const eventRateState = new Map();
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
const tvDebugPlaybackByKey = new Map();

if (TRUST_PROXY) {
  app.set("trust proxy", TRUST_PROXY === "true" ? 1 : TRUST_PROXY);
}

app.disable("x-powered-by");

const defaultDevOrigins = [
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
  "http://localhost:3000",
  "https://localhost:3000",
];

function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

const allowedOrigins = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS || (!isProduction ? defaultDevOrigins.join(",") : "")
);

function isOriginAllowed(origin) {
  if (!isProduction) return true;
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function corsOrigin(origin, callback) {
  if (isOriginAllowed(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Origin not allowed by CORS"));
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "microphone=(self), xr-spatial-tracking=(self), camera=(), geolocation=()"
  );

  const forwardedProto = req.get("x-forwarded-proto");
  const isSecureRequest = req.secure || forwardedProto === "https";
  if (isProduction && isSecureRequest) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
});

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

const PLAYER_NAME_MAX_LENGTH = 20;
const POSITION_LIMIT = 100;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2;
const FACE_EXPRESSION_MAX_LENGTH = 4;
const VALID_AVATAR_MODES = new Set(["desktop", "vr"]);
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;
const socketRateLimits = {
  pose: { max: 30, windowMs: 1000 },
  "webrtc-offer": { max: 6, windowMs: 10000 },
  "webrtc-answer": { max: 6, windowMs: 10000 },
  "webrtc-ice-candidate": { max: 120, windowMs: 10000 },
  "chat-message": { max: 10, windowMs: 5000 },
  "scene-state-update": { max: 40, windowMs: 5000 },
  "tv-debug-message": { max: 8, windowMs: 5000 },
};

function makeTrackTitle(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sendSafeError(res, status, clientMessage, error) {
  if (error) {
    console.error(clientMessage, error);
  } else {
    console.error(clientMessage);
  }

  res.status(status).json({ error: clientMessage });
}

function sanitizeText(value, maxLength = PLAYER_NAME_MAX_LENGTH) {
  if (typeof value !== "string") return null;

  const sanitized = value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return sanitized || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeVector3(value, fallback, limits = { min: -POSITION_LIMIT, max: POSITION_LIMIT }) {
  if (!value || typeof value !== "object") return fallback;

  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const z = finiteNumber(value.z);
  if (x == null || y == null || z == null) return fallback;

  return {
    x: clamp(x, limits.min, limits.max),
    y: clamp(y, limits.min, limits.max),
    z: clamp(z, limits.min, limits.max),
  };
}

function sanitizeQuaternion(value, fallback) {
  if (!value || typeof value !== "object") return fallback;

  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const z = finiteNumber(value.z);
  const w = finiteNumber(value.w);
  if (x == null || y == null || z == null || w == null) return fallback;

  return { x, y, z, w };
}

function sanitizeAvatarCustomization(value, previousValue = null) {
  if (!value || typeof value !== "object") return previousValue;

  return {
    body: HEX_COLOR_PATTERN.test(value.body) ? value.body : null,
    head: HEX_COLOR_PATTERN.test(value.head) ? value.head : null,
    arms: HEX_COLOR_PATTERN.test(value.arms) ? value.arms : null,
    legs: HEX_COLOR_PATTERN.test(value.legs) ? value.legs : null,
    hands: HEX_COLOR_PATTERN.test(value.hands) ? value.hands : null,
    badge: HEX_COLOR_PATTERN.test(value.badge) ? value.badge : null,
    badgeText: HEX_COLOR_PATTERN.test(value.badgeText) ? value.badgeText : null,
    faceExpression: sanitizeText(value.faceExpression, FACE_EXPRESSION_MAX_LENGTH),
  };
}

function sanitizeSdpDescription(value, type) {
  if (!value || typeof value !== "object") return null;
  if (value.type !== type || typeof value.sdp !== "string") return null;
  if (!value.sdp || value.sdp.length > 20000) return null;

  return { type, sdp: value.sdp };
}

function sanitizeIceCandidate(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.candidate !== "string") return null;
  if (!value.candidate || value.candidate.length > 4000) return null;

  const nextCandidate = { candidate: value.candidate };

  if (value.sdpMid == null || typeof value.sdpMid === "string") {
    nextCandidate.sdpMid = value.sdpMid ?? null;
  } else {
    return null;
  }

  if (value.sdpMLineIndex == null || Number.isInteger(value.sdpMLineIndex)) {
    nextCandidate.sdpMLineIndex = value.sdpMLineIndex ?? null;
  } else {
    return null;
  }

  if (value.usernameFragment == null || typeof value.usernameFragment === "string") {
    nextCandidate.usernameFragment = value.usernameFragment ?? null;
  } else {
    return null;
  }

  return nextCandidate;
}

function sanitizeChatText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
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

function makeSpawn() {
  return { x: (Math.random() - 0.5) * 2, y: 1.6, z: (Math.random() - 0.5) * 2 };
}

function createPlayerState(socketId) {
  return {
    id: socketId,
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
  };
}

function getPlayersSnapshot() {
  return Object.fromEntries(players);
}

function isSocketAllowedEvent(socketId, eventName) {
  const config = socketRateLimits[eventName];
  if (!config) return true;

  let socketState = eventRateState.get(socketId);
  if (!socketState) {
    socketState = new Map();
    eventRateState.set(socketId, socketState);
  }

  const now = Date.now();
  const previous = socketState.get(eventName);
  if (!previous || now - previous.startedAt >= config.windowMs) {
    socketState.set(eventName, { startedAt: now, count: 1 });
    return true;
  }

  if (previous.count >= config.max) {
    return false;
  }

  previous.count += 1;
  return true;
}

function emitRateLimited(socket, eventName) {
  socket.emit("rate-limit", { event: eventName });
}

function getTargetPlayer(targetId) {
  if (typeof targetId !== "string" || !targetId.trim()) return null;
  return players.get(targetId) || null;
}

function sameRoom(sourcePlayer, targetPlayer) {
  return sourcePlayer?.room && sourcePlayer.room === targetPlayer?.room;
}

function relaySignaling(socket, eventName, payloadSanitizer) {
  socket.on(eventName, (payload) => {
    if (!isSocketAllowedEvent(socket.id, eventName)) {
      emitRateLimited(socket, eventName);
      return;
    }

    const sourcePlayer = players.get(socket.id);
    if (!sourcePlayer || !payload || typeof payload !== "object") return;

    const targetPlayer = getTargetPlayer(payload.targetId);
    if (!targetPlayer || targetPlayer.id === socket.id || !sameRoom(sourcePlayer, targetPlayer)) {
      return;
    }

    const sanitizedPayload = payloadSanitizer(payload);
    if (!sanitizedPayload) return;

    io.to(targetPlayer.id).emit(eventName, {
      fromId: socket.id,
      ...sanitizedPayload,
    });
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

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
    sendSafeError(res, 500, "Failed to load karaoke songs", error);
  }
});

app.use((err, _req, res, _next) => {
  if (err?.message === "Origin not allowed by CORS") {
    sendSafeError(res, 403, "Origin not allowed");
    return;
  }

  sendSafeError(res, 500, "Internal server error", err);
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  const player = createPlayerState(socket.id);
  players.set(socket.id, player);

  socket.emit("init", {
    selfId: socket.id,
    players: getPlayersSnapshot(),
    chatMessages,
    sceneState,
  });

  socket.broadcast.emit("playerJoined", player);

  socket.on("pose", (data) => {
    if (!isSocketAllowedEvent(socket.id, "pose")) {
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer || !data || typeof data !== "object") return;

    const nextName = sanitizeText(data.name);
    if (nextName) {
      currentPlayer.name = nextName;
    }

    if (VALID_AVATAR_MODES.has(data.avatarMode)) {
      currentPlayer.avatarMode = data.avatarMode;
    }

    if (typeof data.speaking === "boolean") {
      currentPlayer.speaking = data.speaking;
    }

    currentPlayer.avatarCustomization = sanitizeAvatarCustomization(
      data.avatarCustomization,
      currentPlayer.avatarCustomization
    );

    currentPlayer.root.pos = sanitizeVector3(data.root?.pos, currentPlayer.root.pos);

    const rootRotY = finiteNumber(data.root?.rotY);
    if (rootRotY != null) {
      currentPlayer.root.rotY = clamp(rootRotY, -Math.PI * 2, Math.PI * 2);
    }

    const rootScale = finiteNumber(data.root?.scale);
    if (rootScale != null) {
      currentPlayer.root.scale = clamp(rootScale, SCALE_MIN, SCALE_MAX);
    }

    currentPlayer.head.pos = sanitizeVector3(data.head?.pos, currentPlayer.head.pos);
    currentPlayer.head.rot = sanitizeQuaternion(data.head?.rot, currentPlayer.head.rot);
    currentPlayer.leftHand.pos = sanitizeVector3(data.leftHand?.pos, currentPlayer.leftHand.pos);
    currentPlayer.leftHand.rot = sanitizeQuaternion(data.leftHand?.rot, currentPlayer.leftHand.rot);
    currentPlayer.rightHand.pos = sanitizeVector3(data.rightHand?.pos, currentPlayer.rightHand.pos);
    currentPlayer.rightHand.rot = sanitizeQuaternion(data.rightHand?.rot, currentPlayer.rightHand.rot);
  });

  socket.on("chat-message", ({ text }) => {
    if (!isSocketAllowedEvent(socket.id, "chat-message")) {
      emitRateLimited(socket, "chat-message");
      return;
    }

    const playerState = players.get(socket.id);
    const cleanText = sanitizeChatText(text);
    if (!playerState || !cleanText) return;

    const message = {
      id: `${Date.now()}-${socket.id}`,
      senderId: socket.id,
      senderName: playerState.name || "Player",
      text: cleanText,
      createdAt: Date.now(),
    };

    chatMessages.push(message);
    while (chatMessages.length > MAX_CHAT_MESSAGES) {
      chatMessages.shift();
    }

    io.emit("chat-message", message);
  });

  socket.on("scene-state-update", (payload, ack) => {
    if (!isSocketAllowedEvent(socket.id, "scene-state-update")) {
      emitRateLimited(socket, "scene-state-update");
      ack?.({ ok: false, reason: "rate-limited" });
      return;
    }

    const update = sanitizeSceneStateUpdate(payload);
    if (!update) {
      ack?.({ ok: false, reason: "invalid-update" });
      return;
    }

    const nextState = applySceneStateUpdate(update, socket.id);
    maybeBroadcastTVDebugMessage(socket.id, update, nextState);
    io.emit("scene-state-update", {
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
    if (!isSocketAllowedEvent(socket.id, "tv-debug-message")) {
      emitRateLimited(socket, "tv-debug-message");
      return;
    }

    const playerState = players.get(socket.id);
    io.emit("tv-debug-message", {
      tvKey: typeof payload?.tvKey === "string" ? payload.tvKey.slice(0, 120) : "",
      senderId: socket.id,
      senderName: playerState?.name || "Player",
      title: typeof payload?.title === "string" ? payload.title.slice(0, 240) : "Unknown Song",
      url: typeof payload?.url === "string" ? payload.url : null,
      action: typeof payload?.action === "string" ? payload.action : "play",
      createdAt: Date.now(),
    });
  });

  relaySignaling(socket, "webrtc-offer", (payload) => {
    const offer = sanitizeSdpDescription(payload.offer, "offer");
    return offer ? { offer } : null;
  });

  relaySignaling(socket, "webrtc-answer", (payload) => {
    const answer = sanitizeSdpDescription(payload.answer, "answer");
    return answer ? { answer } : null;
  });

  relaySignaling(socket, "webrtc-ice-candidate", (payload) => {
    const candidate = sanitizeIceCandidate(payload.candidate);
    return candidate ? { candidate } : null;
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    players.delete(socket.id);
    eventRateState.delete(socket.id);
    clearDisconnectedOwnership(socket.id);
    if (players.size === 0) {
      resetSharedRoomState();
    }
    io.emit("playerLeft", socket.id);
  });
});

const TICK_HZ = 15;
setInterval(() => {
  io.emit("playersUpdate", getPlayersSnapshot());
}, 1000 / TICK_HZ);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (allowedOrigins.size > 0) {
    console.log("[CORS] Allowed origins:", [...allowedOrigins].join(", "));
  } else {
    console.log("[CORS] No cross-origin browser origins configured");
  }
});

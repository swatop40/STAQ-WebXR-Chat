import * as BABYLON from "babylonjs";
import * as GUI from "babylonjs-gui";
import { io } from "socket.io-client";

import { startScene } from "./scenes/start.js";
import {
  isDisplayNameAllowed,
  sanitizeChatText,
  sanitizeDisplayName,
} from "./utils/textModeration.js";

let externalSceneLoader = null;

export function setSceneLoader(fn) {
  externalSceneLoader = fn;
}

const socket = io({
  transports: ["websocket", "polling"],
  autoConnect: false,
});

const DEFAULT_WEBRTC_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);

let rtcIceServers = [...DEFAULT_WEBRTC_ICE_SERVERS];

socket.on("connect", () => {
  selfId = socket.id;
  console.log("[NET] Connected:", socket.id);
});
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
let localAvatarCustomization = null;

let playerName = "Player";
let uiTexture = null;
let appStarted = false;
const remoteNameLabels = new Map();
const SCENE_JOIN_TIMEOUT_MS = 10000;
const AVATAR_CUSTOMIZATION_STORAGE_KEY = "avatarCustomization";

function readStoredAvatarCustomization(name = "Player") {
  if (typeof window === "undefined" || !window.sessionStorage) return null;

  try {
    const raw = window.sessionStorage.getItem(AVATAR_CUSTOMIZATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return deserializeAvatarCustomization(parsed, name);
  } catch (error) {
    console.warn("[AVATAR] Failed to read stored customization", error);
    return null;
  }
}

function storeAvatarCustomization(customization) {
  if (typeof window === "undefined" || !window.sessionStorage || !customization) return;

  try {
    const serialized = serializeAvatarCustomization(customization);
    if (!serialized) return;
    window.sessionStorage.setItem(
      AVATAR_CUSTOMIZATION_STORAGE_KEY,
      JSON.stringify(serialized)
    );
  } catch (error) {
    console.warn("[AVATAR] Failed to store customization", error);
  }
}

function ensureLocalAvatarCustomization() {
  if (!localAvatarCustomization) {
    localAvatarCustomization =
      readStoredAvatarCustomization(playerName) ||
      createDefaultAvatarCustomization(playerName);
  }

  return localAvatarCustomization;
}

function waitForSocketConnect() {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
    };

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onConnectError = (error) => {
      cleanup();
      reject(error);
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.connect();
  });
}

async function loadWebRTCConfig() {
  try {
    const response = await fetch("/api/webrtc-config", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const nextIceServers = Array.isArray(payload?.iceServers)
      ? payload.iceServers.filter((entry) => entry && entry.urls)
      : [];

    rtcIceServers = nextIceServers.length > 0
      ? nextIceServers
      : [...DEFAULT_WEBRTC_ICE_SERVERS];

    console.log("[VOICE] Loaded ICE server config", rtcIceServers);
  } catch (error) {
    rtcIceServers = [...DEFAULT_WEBRTC_ICE_SERVERS];
    console.warn("[VOICE] Falling back to default ICE server config", error);
  }
}

function requestSceneJoin(sceneId) {
  const cleanSceneId = typeof sceneId === "string" ? sceneId.trim() : "";
  if (!cleanSceneId) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off("init", onInit);
      socket.off("sceneFull", onSceneFull);
    };

    const onInit = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onSceneFull = ({ sceneId: fullSceneId, max }) => {
      if (settled) return;
      settled = true;
      cleanup();

      const error = new Error(`Scene ${fullSceneId || cleanSceneId} is full`);
      error.code = "SCENE_FULL";
      error.sceneId = fullSceneId || cleanSceneId;
      error.max = max;
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timed out joining scene '${cleanSceneId}'`));
    }, SCENE_JOIN_TIMEOUT_MS);

    socket.on("init", onInit);
    socket.on("sceneFull", onSceneFull);
    socket.emit("joinScene", cleanSceneId);
  });
}

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
  xrBodyAnchorYOffset: -1,
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

const AVATAR_STYLE = {
  chestBadgeOffset: new BABYLON.Vector3(0, 1.84, 0.33),
  chestBadgeSize: 0.52,
  chestBadgeDepthOffset: 0.08,
};

const AVATAR_FACE = {
  defaultExpression: "=D",
  talkMouth: "0",
  panelSize: 0.64,
  panelOffset: new BABYLON.Vector3(0, 0, 0.57),
  rotation: new BABYLON.Vector3(0, Math.PI, Math.PI / -2),
  talkFrameMs: 180,
  speechOpenThreshold: 0.055,
  speechCloseThreshold: 0.035,
  speechOpenHoldMs: 120,
  speechCloseHoldMs: 220,
};

const AVATAR_COLOR_PALETTES = [
  {
    body: BABYLON.Color3.FromHexString("#4F46E5"),
    head: BABYLON.Color3.FromHexString("#F4D7C6"),
    arms: BABYLON.Color3.FromHexString("#312E81"),
    legs: BABYLON.Color3.FromHexString("#3730A3"),
    hands: BABYLON.Color3.FromHexString("#F1CBB5"),
    badge: BABYLON.Color3.FromHexString("#F59E0B"),
    badgeText: BABYLON.Color3.FromHexString("#111827"),
  },
  {
    body: BABYLON.Color3.FromHexString("#0F766E"),
    head: BABYLON.Color3.FromHexString("#F1D2BA"),
    arms: BABYLON.Color3.FromHexString("#115E59"),
    legs: BABYLON.Color3.FromHexString("#134E4A"),
    hands: BABYLON.Color3.FromHexString("#EBC4AB"),
    badge: BABYLON.Color3.FromHexString("#FDE68A"),
    badgeText: BABYLON.Color3.FromHexString("#0F172A"),
  },
  {
    body: BABYLON.Color3.FromHexString("#B91C1C"),
    head: BABYLON.Color3.FromHexString("#F3D5C0"),
    arms: BABYLON.Color3.FromHexString("#7F1D1D"),
    legs: BABYLON.Color3.FromHexString("#991B1B"),
    hands: BABYLON.Color3.FromHexString("#E8C0A6"),
    badge: BABYLON.Color3.FromHexString("#FCA5A5"),
    badgeText: BABYLON.Color3.FromHexString("#1F2937"),
  },
  {
    body: BABYLON.Color3.FromHexString("#2563EB"),
    head: BABYLON.Color3.FromHexString("#EFD0BC"),
    arms: BABYLON.Color3.FromHexString("#1D4ED8"),
    legs: BABYLON.Color3.FromHexString("#1E40AF"),
    hands: BABYLON.Color3.FromHexString("#E5BEAA"),
    badge: BABYLON.Color3.FromHexString("#BFDBFE"),
    badgeText: BABYLON.Color3.FromHexString("#0F172A"),
  },
  {
    body: BABYLON.Color3.FromHexString("#7C3AED"),
    head: BABYLON.Color3.FromHexString("#F2D4C0"),
    arms: BABYLON.Color3.FromHexString("#6D28D9"),
    legs: BABYLON.Color3.FromHexString("#5B21B6"),
    hands: BABYLON.Color3.FromHexString("#E7C1AB"),
    badge: BABYLON.Color3.FromHexString("#DDD6FE"),
    badgeText: BABYLON.Color3.FromHexString("#111827"),
  },
  {
    body: BABYLON.Color3.FromHexString("#EA580C"),
    head: BABYLON.Color3.FromHexString("#F3D4BE"),
    arms: BABYLON.Color3.FromHexString("#C2410C"),
    legs: BABYLON.Color3.FromHexString("#9A3412"),
    hands: BABYLON.Color3.FromHexString("#E6BDA6"),
    badge: BABYLON.Color3.FromHexString("#FED7AA"),
    badgeText: BABYLON.Color3.FromHexString("#1F2937"),
  },
];

const AVATAR_CUSTOMIZATION_COLOR_OPTIONS = [
  "#4F46E5",
  "#0F766E",
  "#B91C1C",
  "#2563EB",
  "#7C3AED",
  "#EA580C",
  "#111827",
  "#475569",
  "#84CC16",
  "#E11D48",
  "#F59E0B",
  "#F8FAFC",
];

const AVATAR_FACE_OPTIONS = [
  "=D",
  "=)",
  ":)",
  ":D",
  "=P",
  ":P",
  "=|",
  ":/",
  ":O",
  ";)",
  "=]",
  ":]",
];

// Voice chat variables
let localStream = null;
let micMode = "open";
let pushToTalkPressed = false;
let sceneVolume = 1;
let playerVolume = 1;
const MAX_CHAT_MESSAGES = 40;
const VOICE_RADIUS = 12;
let vrAvatarHeightOverride = null;
const peerConnections = new Map();
const remoteAudioEls = new Map();
const remoteVoiceAnalysers = new Map();
const remotePlayerNames = new Map();
const mutedRemoteIds = new Set();
let localVoiceAnalyser = null;
const serverChatMessages = [];
const sharedSceneState = new Map();
const sharedSceneStateListeners = new Map();

function getScopeStateMap(scope) {
  let scopeMap = sharedSceneState.get(scope);
  if (!scopeMap) {
    scopeMap = new Map();
    sharedSceneState.set(scope, scopeMap);
  }
  return scopeMap;
}

function getScopeListenerMap(scope) {
  let scopeMap = sharedSceneStateListeners.get(scope);
  if (!scopeMap) {
    scopeMap = new Map();
    sharedSceneStateListeners.set(scope, scopeMap);
  }
  return scopeMap;
}

function notifySharedSceneState(scope, key, state) {
  const scopeListeners = sharedSceneStateListeners.get(scope);
  const listeners = scopeListeners?.get(key);
  if (!listeners?.size) return;

  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.warn(`[SCENE] Failed handling shared state ${scope}:${key}`, error);
    }
  }
}

function applySharedSceneStateUpdate(scope, key, state) {
  if (!scope || !key || !state || typeof state !== "object") return;

  const scopeState = getScopeStateMap(scope);
  const nextState = {
    ...(scopeState.get(key) || {}),
    ...state,
  };
  scopeState.set(key, nextState);
  notifySharedSceneState(scope, key, nextState);
}

function replaceSharedSceneState(nextSceneState) {
  sharedSceneState.clear();

  if (!nextSceneState || typeof nextSceneState !== "object") return;

  for (const [scope, entries] of Object.entries(nextSceneState)) {
    if (!entries || typeof entries !== "object") continue;
    const scopeState = getScopeStateMap(scope);
    for (const [key, state] of Object.entries(entries)) {
      scopeState.set(key, { ...(state || {}) });
    }
  }

  for (const [scope, scopeListeners] of sharedSceneStateListeners.entries()) {
    const scopeState = sharedSceneState.get(scope) || new Map();
    for (const [key] of scopeListeners.entries()) {
      const currentState = scopeState.get(key);
      if (currentState) {
        notifySharedSceneState(scope, key, currentState);
      }
    }
  }
}

function logConnectedPlayers(context, playersLike = null) {
  const ids = playersLike
    ? Object.values(playersLike)
        .map((p) => p?.id)
        .filter(Boolean)
    : Array.from(remoteMeshes.keys());

  console.log(`[NET] ${context} connected players:`, ids);
}

function cleanupRemoteAudio(playerId) {
  const voiceAnalyser = remoteVoiceAnalysers.get(playerId);
  if (voiceAnalyser) {
    try {
      voiceAnalyser.source?.disconnect?.();
      voiceAnalyser.analyser?.disconnect?.();
    } catch (err) {
      console.warn("[VOICE] remote analyser cleanup issue:", playerId, err);
    }

    remoteVoiceAnalysers.delete(playerId);
  }

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

function getVoiceAnalysisContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!getVoiceAnalysisContext.context) {
    getVoiceAnalysisContext.context = new AudioContextCtor();
  }

  return getVoiceAnalysisContext.context;
}

function createVoiceAnalyser(stream) {
  if (!stream) return null;

  try {
    const context = getVoiceAnalysisContext();
    if (!context) return null;
    context.resume?.().catch(() => {});

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);

    return {
      context,
      source,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      speaking: false,
      level: 0,
    };
  } catch (error) {
    console.warn("[VOICE] Failed to create analyser", error);
    return null;
  }
}

function readVoiceLevel(voiceState) {
  if (!voiceState?.analyser || !voiceState?.data) return 0;

  voiceState.analyser.getByteTimeDomainData(voiceState.data);
  let total = 0;

  for (let i = 0; i < voiceState.data.length; i += 1) {
    const normalized = (voiceState.data[i] - 128) / 128;
    total += normalized * normalized;
  }

  const rms = Math.sqrt(total / voiceState.data.length);
  voiceState.level = rms;
  return rms;
}

function applyMicMode() {
  const tracks = localStream?.getAudioTracks?.() || [];
  const enabled = micMode === "open" || (micMode === "pushToTalk" && pushToTalkPressed);

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
  audioEl.volume = clamp01(playerVolume * falloff);
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
  remoteVoiceAnalysers.set(playerId, createVoiceAnalyser(stream));
  updateRemoteAudioVolume(playerId);

  try {
    await audioEl.play();
  } catch (err) {
    console.warn("[VOICE] remote audio play failed:", playerId, err);
  }

  return audioEl;
}

function updateLocalVoiceActivity() {
  if (!localAvatarParts) return;

  const tracks = localStream?.getAudioTracks?.() || [];
  const micActive = tracks.some((track) => track.enabled && track.readyState === "live");
  let isSpeaking = false;
  const now = performance.now();

  if (micActive && localVoiceAnalyser) {
    const level = readVoiceLevel(localVoiceAnalyser);
    if (localVoiceAnalyser.speaking) {
      if (level >= AVATAR_FACE.speechCloseThreshold) {
        localVoiceAnalyser.lastAboveCloseAt = now;
        isSpeaking = true;
      } else {
        const lastAboveCloseAt = localVoiceAnalyser.lastAboveCloseAt ?? now;
        isSpeaking = (now - lastAboveCloseAt) <= AVATAR_FACE.speechCloseHoldMs;
      }
    } else {
      if (level >= AVATAR_FACE.speechOpenThreshold) {
        localVoiceAnalyser.firstAboveOpenAt ??= now;
        isSpeaking = (now - localVoiceAnalyser.firstAboveOpenAt) >= AVATAR_FACE.speechOpenHoldMs;
      } else {
        localVoiceAnalyser.firstAboveOpenAt = null;
        isSpeaking = false;
      }
    }
    localVoiceAnalyser.speaking = isSpeaking;
  } else if (localVoiceAnalyser) {
    localVoiceAnalyser.speaking = false;
    localVoiceAnalyser.firstAboveOpenAt = null;
    localVoiceAnalyser.lastAboveCloseAt = null;
  }

  localAvatarParts.isSpeaking = isSpeaking;
  updateAvatarFaceState(localAvatarParts, now);
}

function updateRemoteVoiceActivity() {
  const now = performance.now();

  for (const [playerId, root] of remoteMeshes.entries()) {
    const parts = root?.metadata;
    if (!parts) continue;

    const voiceState = remoteVoiceAnalysers.get(playerId);
    let isSpeaking = false;

    if (voiceState) {
      const level = readVoiceLevel(voiceState);
      if (voiceState.speaking) {
        if (level >= AVATAR_FACE.speechCloseThreshold) {
          voiceState.lastAboveCloseAt = now;
          isSpeaking = true;
        } else {
          const lastAboveCloseAt = voiceState.lastAboveCloseAt ?? now;
          isSpeaking = (now - lastAboveCloseAt) <= AVATAR_FACE.speechCloseHoldMs;
        }
      } else {
        if (level >= AVATAR_FACE.speechOpenThreshold) {
          voiceState.firstAboveOpenAt ??= now;
          isSpeaking = (now - voiceState.firstAboveOpenAt) >= AVATAR_FACE.speechOpenHoldMs;
        } else {
          voiceState.firstAboveOpenAt = null;
          isSpeaking = false;
        }
      }

      voiceState.speaking = isSpeaking;
    }

    parts.isSpeaking = isSpeaking;
    updateAvatarFaceState(parts, now);
  }
}

function getPercentLabel(value) {
  return `${Math.round(value * 100)}%`;
}

function addServerChatMessage(message) {
  if (!message?.id || !message?.text) return;
  if (serverChatMessages.some((entry) => entry.id === message.id)) return;

  const safeSenderName = sanitizeDisplayName(message.senderName || "Player");
  const safeText = sanitizeChatText(message.text);
  if (!safeText) return;

  serverChatMessages.push({
    id: message.id,
    senderId: message.senderId || "",
    senderName: safeSenderName,
    text: safeText,
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
  });

  while (serverChatMessages.length > MAX_CHAT_MESSAGES) {
    serverChatMessages.shift();
  }
}

function replaceServerChatMessages(messages) {
  serverChatMessages.length = 0;
  for (const message of messages || []) {
    addServerChatMessage(message);
  }
}

function createVoiceControls() {
  return {
    getMicMode() {
      return micMode;
    },
    isPushToTalkPressed() {
      return pushToTalkPressed;
    },
    setPushToTalkPressed(pressed) {
      const nextPressed = !!pressed;
      if (pushToTalkPressed === nextPressed) return pushToTalkPressed;

      pushToTalkPressed = nextPressed;
      if (micMode === "pushToTalk") {
        applyMicMode();
      }

      return pushToTalkPressed;
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
    getSceneVolume() {
      return sceneVolume;
    },
    getPlayerVolume() {
      return playerVolume;
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
    listRemotePlayers() {
      return [...remotePlayerNames.entries()].map(([id, name]) => ({
        id,
        name,
        muted: mutedRemoteIds.has(id) || !!remoteAudioEls.get(id)?.muted,
      }));
    },
    toggleRemoteMute(id) {
      if (!id) return false;

      const audio = remoteAudioEls.get(id);
      const nextMuted = !(mutedRemoteIds.has(id) || !!audio?.muted);

      if (nextMuted) {
        mutedRemoteIds.add(id);
      } else {
        mutedRemoteIds.delete(id);
      }

      if (audio) {
        audio.muted = nextMuted;
      }

      console.log(`[AUDIO] ${nextMuted ? "Muted" : "Unmuted"} ${remotePlayerNames.get(id) || id}`);
      return nextMuted;
    },
  };
}

function createChatControls() {
  return {
    getMessages() {
      return serverChatMessages.map((message) => ({ ...message }));
    },
    sendMessage(text) {
      const cleanText = sanitizeChatText(text);
      if (!cleanText || !socket.connected) return false;

      socket.emit("chat-message", { text: cleanText });
      return true;
    },
  };
}

function createSharedStateControls() {
  return {
    getSelfId() {
      return selfId;
    },
    getState(scope, key) {
      return sharedSceneState.get(scope)?.get(key) || null;
    },
    emit(scope, key, state) {
      if (!scope || !key || !state || typeof state !== "object") return false;

      const nextState = {
        ...(sharedSceneState.get(scope)?.get(key) || {}),
        ...state,
        lastActorId: selfId,
      };
      getScopeStateMap(scope).set(key, nextState);

      if (socket.connected) {
        socket.emit("scene-state-update", { scope, key, state }, () => {});
      }
      return true;
    },
    debugTVPlayback(key, payload = {}) {
      if (!socket.connected || !key) return false;

      socket.emit("tv-debug-message", {
        tvKey: key,
        title: payload.title || "Unknown Song",
        url: payload.url || null,
        action: payload.action || "play",
      });
      return true;
    },
    subscribe(scope, key, listener, options = {}) {
      if (!scope || !key || typeof listener !== "function") {
        return () => {};
      }

      const scopeListeners = getScopeListenerMap(scope);
      let listeners = scopeListeners.get(key);
      if (!listeners) {
        listeners = new Set();
        scopeListeners.set(key, listeners);
      }
      listeners.add(listener);

      if (options.applyCurrent !== false) {
        const currentState = sharedSceneState.get(scope)?.get(key);
        if (currentState) {
          listener(currentState);
        }
      }

      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          scopeListeners.delete(key);
        }
      };
    },
  };
}

function createAvatarControls() {
  return {
    getColorOptions() {
      return [...AVATAR_CUSTOMIZATION_COLOR_OPTIONS];
    },
    getFaceOptions() {
      return [...AVATAR_FACE_OPTIONS];
    },
    getCurrentCustomization() {
      ensureLocalAvatarCustomization();

      return {
        body: localAvatarCustomization.body?.toHexString?.() || null,
        head: localAvatarCustomization.head?.toHexString?.() || null,
        arms: localAvatarCustomization.arms?.toHexString?.() || null,
        legs: localAvatarCustomization.legs?.toHexString?.() || null,
        hands: localAvatarCustomization.hands?.toHexString?.() || null,
        badge: localAvatarCustomization.badge?.toHexString?.() || null,
        badgeText: localAvatarCustomization.badgeText?.toHexString?.() || null,
        faceExpression: localAvatarCustomization.faceExpression || AVATAR_FACE.defaultExpression,
      };
    },
    setPartColor(part, hexColor) {
      ensureLocalAvatarCustomization();

      if (!["body", "head", "arms", "legs", "hands", "badge", "badgeText"].includes(part)) {
        return null;
      }

      try {
        localAvatarCustomization[part] = BABYLON.Color3.FromHexString(hexColor);
      } catch {
        return null;
      }

      if (localAvatarParts) {
        applyAvatarAppearance(localAvatarParts, playerName, "local", localAvatarCustomization);
      }
      storeAvatarCustomization(localAvatarCustomization);

      return localAvatarCustomization[part].toHexString();
    },
    setFaceExpression(expression) {
      if (!AVATAR_FACE_OPTIONS.includes(expression)) {
        return null;
      }

      ensureLocalAvatarCustomization();

      localAvatarCustomization.faceExpression = expression;
      if (localAvatarParts) {
        applyAvatarAppearance(localAvatarParts, playerName, "local", localAvatarCustomization);
      }
      storeAvatarCustomization(localAvatarCustomization);
      return localAvatarCustomization.faceExpression;
    },
    resetCustomization() {
      localAvatarCustomization = createDefaultAvatarCustomization(playerName);
      if (localAvatarParts) {
        applyAvatarAppearance(localAvatarParts, playerName, "local", localAvatarCustomization);
      }
      storeAvatarCustomization(localAvatarCustomization);
      return this.getCurrentCustomization();
    },
    autoHeightFromXR() {
      const camera = sceneRef?.xrHelper?.baseExperience?.camera || sceneRef?.activeCamera;
      const height = Math.max(camera?.globalPosition?.y ?? camera?.position?.y ?? 1, 1);
      vrAvatarHeightOverride = height;
      console.log(`[AVATAR] Auto height calibrated to ${height.toFixed(2)}m`);
      return height;
    },
    clearAutoHeight() {
      vrAvatarHeightOverride = null;
      console.log("[AVATAR] Auto height calibration cleared");
    },
    getAutoHeightLabel() {
      return vrAvatarHeightOverride == null
        ? "Auto Height"
        : `Height: ${vrAvatarHeightOverride.toFixed(2)}m`;
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

function hashString(value) {
  let hash = 0;

  for (const char of value) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getAvatarAppearanceSeed(name = "Player") {
  const normalized = String(name || "Player").trim() || "Player";
  const palette = AVATAR_COLOR_PALETTES[hashString(normalized) % AVATAR_COLOR_PALETTES.length];
  const chestGlyphMatch = normalized.match(/[A-Za-z0-9]/);

  return {
    palette,
    chestGlyph: (chestGlyphMatch?.[0] || "?").toUpperCase(),
  };
}

function cloneColor(color) {
  return color?.clone?.() || null;
}

function createDefaultAvatarCustomization(name = "Player") {
  const seed = getAvatarAppearanceSeed(name);
  return {
    body: cloneColor(seed.palette.body),
    head: cloneColor(seed.palette.head),
    arms: cloneColor(seed.palette.arms),
    legs: cloneColor(seed.palette.legs),
    hands: cloneColor(seed.palette.hands),
    badge: cloneColor(seed.palette.badge),
    badgeText: cloneColor(seed.palette.badgeText),
    faceExpression: AVATAR_FACE.defaultExpression,
  };
}

function serializeAvatarCustomization(customization) {
  if (!customization) return null;

  return {
    body: customization.body?.toHexString?.() || null,
    head: customization.head?.toHexString?.() || null,
    arms: customization.arms?.toHexString?.() || null,
    legs: customization.legs?.toHexString?.() || null,
    hands: customization.hands?.toHexString?.() || null,
    badge: customization.badge?.toHexString?.() || null,
    badgeText: customization.badgeText?.toHexString?.() || null,
    faceExpression: customization.faceExpression || AVATAR_FACE.defaultExpression,
  };
}

function deserializeAvatarCustomization(serialized, name = "Player") {
  const base = createDefaultAvatarCustomization(name);
  if (!serialized || typeof serialized !== "object") {
    return base;
  }

  const parseColor = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    try {
      return BABYLON.Color3.FromHexString(value);
    } catch {
      return fallback;
    }
  };

  return {
    body: parseColor(serialized.body, base.body),
    head: parseColor(serialized.head, base.head),
    arms: parseColor(serialized.arms, base.arms),
    legs: parseColor(serialized.legs, base.legs),
    hands: parseColor(serialized.hands, base.hands),
    badge: parseColor(serialized.badge, base.badge),
    badgeText: parseColor(serialized.badgeText, base.badgeText),
    faceExpression: AVATAR_FACE_OPTIONS.includes(serialized.faceExpression)
      ? serialized.faceExpression
      : base.faceExpression,
  };
}

function applyColorToMaterial(material, color) {
  if (!material || !color) return;

  if ("albedoColor" in material && material.albedoColor) {
    material.albedoColor.copyFrom(color);
  }

  if ("diffuseColor" in material && material.diffuseColor) {
    material.diffuseColor.copyFrom(color);
  }

  if ("specularColor" in material && material.specularColor) {
    material.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
  }
}

function ensureAvatarMeshTint(mesh, color) {
  if (!mesh || !color) return;

  let material = mesh.metadata?.avatarTintMaterial || mesh.material || null;
  if (!material) return;

  if (!mesh.metadata?.avatarTintMaterial) {
    material = material.clone(`${mesh.name}_avatarTint`);
    mesh.material = material;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      avatarTintMaterial: material,
    };
  }

  applyColorToMaterial(material, color);
}

function ensureAvatarMeshTintList(meshes, color) {
  if (!Array.isArray(meshes) || !color) return;
  for (const mesh of meshes) {
    ensureAvatarMeshTint(mesh, color);
  }
}

function ensureChestBadge(parts, rootId) {
  if (parts?.chestBadgePlane && parts?.chestBadgeTexture) {
    return {
      plane: parts.chestBadgePlane,
      material: parts.chestBadgeMaterial,
      texture: parts.chestBadgeTexture,
    };
  }

  if (!parts?.bodyAnchor) return null;

  const badgePlane = BABYLON.MeshBuilder.CreatePlane(
    `${rootId}_chestBadge`,
    { size: AVATAR_STYLE.chestBadgeSize, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    parts.bodyAnchor.getScene()
  );
  badgePlane.parent = parts.bodyAnchor;
  badgePlane.position.copyFrom(AVATAR_STYLE.chestBadgeOffset);
  badgePlane.isPickable = false;

  const badgeTexture = new BABYLON.DynamicTexture(
    `${rootId}_chestBadgeTexture`,
    { width: 256, height: 256 },
    parts.bodyAnchor.getScene(),
    true
  );

  const badgeMaterial = new BABYLON.StandardMaterial(
    `${rootId}_chestBadgeMaterial`,
    parts.bodyAnchor.getScene()
  );
  badgeMaterial.diffuseTexture = badgeTexture;
  badgeMaterial.emissiveTexture = badgeTexture;
  badgeMaterial.opacityTexture = badgeTexture;
  badgeMaterial.specularColor = BABYLON.Color3.Black();
  badgeMaterial.backFaceCulling = false;
  badgeMaterial.useAlphaFromDiffuseTexture = true;
  badgeMaterial.emissiveColor = BABYLON.Color3.White();
  badgePlane.material = badgeMaterial;

  parts.chestBadgePlane = badgePlane;
  parts.chestBadgeMaterial = badgeMaterial;
  parts.chestBadgeTexture = badgeTexture;

  return {
    plane: badgePlane,
    material: badgeMaterial,
    texture: badgeTexture,
  };
}

function updateChestBadgePlacement(parts) {
  const badgePlane = parts?.chestBadgePlane;
  const bodyAnchor = parts?.bodyAnchor;
  if (!badgePlane || !bodyAnchor) return;

  const leftShoulder = parts.leftShoulderAnchor?.position || AVATAR_RIG.leftShoulderOffset;
  const rightShoulder = parts.rightShoulderAnchor?.position || AVATAR_RIG.rightShoulderOffset;
  const leftHip = parts.leftHipAnchor?.position || AVATAR_RIG.leftHipOffset;
  const rightHip = parts.rightHipAnchor?.position || AVATAR_RIG.rightHipOffset;

  const shoulderCenter = leftShoulder.add(rightShoulder).scale(0.5);
  const hipCenter = leftHip.add(rightHip).scale(0.5);
  const chestCenter = BABYLON.Vector3.Lerp(hipCenter, shoulderCenter, 0.7);

  badgePlane.position.set(
    chestCenter.x + AVATAR_STYLE.chestBadgeOffset.x,
    chestCenter.y + AVATAR_STYLE.chestBadgeOffset.y - shoulderCenter.y,
    AVATAR_STYLE.chestBadgeOffset.z - AVATAR_STYLE.chestBadgeDepthOffset
  );
  badgePlane.rotation.y = Math.PI;
}

function splitFaceExpression(expression = AVATAR_FACE.defaultExpression) {
  const cleaned = String(expression || AVATAR_FACE.defaultExpression);

  if (cleaned.length >= 2) {
    return {
      eyes: cleaned[0],
      mouth: cleaned.slice(1),
    };
  }

  return {
    eyes: cleaned || "=",
    mouth: AVATAR_FACE.talkMouth,
  };
}

function ensureAvatarFace(parts, rootId) {
  if (parts?.facePlane && parts?.faceTexture) {
    return {
      plane: parts.facePlane,
      texture: parts.faceTexture,
      material: parts.faceMaterial,
    };
  }

  const faceParent = parts?.headMesh || parts?.headAnchor || null;
  if (!faceParent) return null;

  const facePlane = BABYLON.MeshBuilder.CreatePlane(
    `${rootId}_facePlane`,
    { size: AVATAR_FACE.panelSize, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    faceParent.getScene()
  );
  facePlane.parent = faceParent;
  facePlane.position.copyFrom(AVATAR_FACE.panelOffset);
  facePlane.rotation.copyFrom(AVATAR_FACE.rotation);
  facePlane.isPickable = false;

  const faceTexture = new BABYLON.DynamicTexture(
    `${rootId}_faceTexture`,
    { width: 256, height: 256 },
    faceParent.getScene(),
    true
  );

  const faceMaterial = new BABYLON.StandardMaterial(
    `${rootId}_faceMaterial`,
    faceParent.getScene()
  );
  faceMaterial.diffuseTexture = faceTexture;
  faceMaterial.emissiveTexture = faceTexture;
  faceMaterial.opacityTexture = faceTexture;
  faceMaterial.useAlphaFromDiffuseTexture = true;
  faceMaterial.specularColor = BABYLON.Color3.Black();
  faceMaterial.emissiveColor = BABYLON.Color3.White();
  faceMaterial.backFaceCulling = false;
  facePlane.material = faceMaterial;

  parts.facePlane = facePlane;
  parts.faceTexture = faceTexture;
  parts.faceMaterial = faceMaterial;

  return {
    plane: facePlane,
    texture: faceTexture,
    material: faceMaterial,
  };
}

function updateAvatarFacePlacement(parts) {
  const facePlane = parts?.facePlane;
  if (!facePlane) return;

  const desiredParent = parts?.headMesh || parts?.headAnchor || null;
  if (!desiredParent) return;

  if (facePlane.parent !== desiredParent) {
    facePlane.parent = desiredParent;
  }

  facePlane.position.copyFrom(AVATAR_FACE.panelOffset);
  facePlane.rotation.copyFrom(AVATAR_FACE.rotation);
}

function getFaceTextColor(backgroundColor) {
  const luminance = (backgroundColor.r * 0.299) + (backgroundColor.g * 0.587) + (backgroundColor.b * 0.114);
  return luminance > 0.62
    ? BABYLON.Color3.FromHexString("#111827")
    : BABYLON.Color3.FromHexString("#F9FAFB");
}

function drawAvatarFace(texture, expression, mouthOverride = null, backgroundColor = null, textColor = null) {
  if (!texture) return;

  const visibleExpression = mouthOverride
    ? `${String(expression || AVATAR_FACE.defaultExpression).slice(0, -1)}${mouthOverride}`
    : String(expression || AVATAR_FACE.defaultExpression);
  const ctx = texture.getContext();
  const width = texture.getSize().width;
  const height = texture.getSize().height;
  const fillColor = backgroundColor || BABYLON.Color3.FromHexString("#111827");
  const glyphColor = textColor || getFaceTextColor(fillColor);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = fillColor.toHexString();
  ctx.beginPath();
  ctx.roundRect(18, 18, width - 36, height - 36, 30);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.fillStyle = glyphColor.toHexString();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 148px monospace";
  ctx.fillText(visibleExpression, width * 0.5, height * 0.54);
  texture.update();
}

function updateAvatarFaceState(parts, nowMs = performance.now()) {
  if (!parts) return;

  const face = ensureAvatarFace(parts, parts.root?.name || "avatar");
  if (!face) return;
  updateAvatarFacePlacement(parts);

  const expression = parts.faceExpression || AVATAR_FACE.defaultExpression;
  const mouth = splitFaceExpression(expression).mouth;
  const mouthOverride = parts.isSpeaking
    ? (Math.floor(nowMs / AVATAR_FACE.talkFrameMs) % 2 === 0 ? AVATAR_FACE.talkMouth : mouth)
    : null;
  const backgroundHex = parts.faceBackgroundColor?.toHexString?.() || "";
  const textHex = parts.faceTextColor?.toHexString?.() || "";
  const signature = `${expression}|${mouthOverride || ""}|${parts.isSpeaking ? "talk" : "idle"}|${backgroundHex}|${textHex}`;

  if (parts.faceRenderSignature === signature) return;

  drawAvatarFace(
    face.texture,
    expression,
    mouthOverride,
    parts.faceBackgroundColor,
    parts.faceTextColor
  );
  parts.faceRenderSignature = signature;
}

function drawChestBadge(texture, glyph, fillColor, textColor) {
  if (!texture) return;

  const ctx = texture.getContext();
  const width = texture.getSize().width;
  const height = texture.getSize().height;
  const radius = 34;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.moveTo(radius, 20);
  ctx.lineTo(width - radius, 20);
  ctx.quadraticCurveTo(width - 20, 20, width - 20, radius);
  ctx.lineTo(width - 20, height - radius);
  ctx.quadraticCurveTo(width - 20, height - 20, width - radius, height - 20);
  ctx.lineTo(radius, height - 20);
  ctx.quadraticCurveTo(20, height - 20, 20, height - radius);
  ctx.lineTo(20, radius);
  ctx.quadraticCurveTo(20, 20, radius, 20);
  ctx.closePath();
  ctx.fillStyle = fillColor.toHexString();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.fillStyle = textColor.toHexString();
  ctx.font = "bold 148px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, width * 0.5, height * 0.55);
  texture.update();
}

function applyAvatarAppearance(parts, displayName = "Player", rootId = "avatar", customization = null) {
  if (!parts) return;

  const seed = getAvatarAppearanceSeed(displayName);
  const resolvedCustomization = customization || createDefaultAvatarCustomization(displayName);
  const appearance = {
    chestGlyph: seed.chestGlyph,
    body: resolvedCustomization.body || seed.palette.body,
    head: resolvedCustomization.head || seed.palette.head,
    arms: resolvedCustomization.arms || seed.palette.arms,
    legs: resolvedCustomization.legs || seed.palette.legs,
    hands: resolvedCustomization.hands || seed.palette.hands,
    badge: resolvedCustomization.badge || seed.palette.badge,
    badgeText: resolvedCustomization.badgeText || seed.palette.badgeText,
    faceExpression: resolvedCustomization.faceExpression || AVATAR_FACE.defaultExpression,
  };
  const signature = `${displayName}|${appearance.chestGlyph}|${appearance.body.toHexString()}|${appearance.head.toHexString()}|${appearance.arms.toHexString()}|${appearance.legs.toHexString()}|${appearance.hands.toHexString()}|${appearance.badge.toHexString()}|${appearance.badgeText.toHexString()}|${appearance.faceExpression}`;
  if (parts.appearanceSignature === signature) {
    return;
  }

  ensureAvatarMeshTintList(parts.bodyMeshes, appearance.body);
  ensureAvatarMeshTint(parts.bodyMesh, appearance.body);
  ensureAvatarMeshTint(parts.headMesh, appearance.head);
  ensureAvatarMeshTint(parts.leftUpperArm, appearance.arms);
  ensureAvatarMeshTint(parts.rightUpperArm, appearance.arms);
  ensureAvatarMeshTint(parts.leftLowerArm, appearance.arms);
  ensureAvatarMeshTint(parts.rightLowerArm, appearance.arms);
  ensureAvatarMeshTint(parts.leftLeg, appearance.legs);
  ensureAvatarMeshTint(parts.rightLeg, appearance.legs);
  ensureAvatarMeshTint(parts.leftHandMesh, appearance.hands);
  ensureAvatarMeshTint(parts.rightHandMesh, appearance.hands);

  const chestBadge = ensureChestBadge(parts, rootId);
  if (chestBadge) {
    updateChestBadgePlacement(parts);
    drawChestBadge(
      chestBadge.texture,
      appearance.chestGlyph,
      appearance.badge,
      appearance.badgeText
    );
  }

  parts.faceBackgroundColor = appearance.head.clone();
  parts.faceTextColor = getFaceTextColor(parts.faceBackgroundColor);
  parts.faceExpression = appearance.faceExpression;
  ensureAvatarFace(parts, rootId);
  updateAvatarFaceState(parts);

  parts.appearanceSignature = signature;
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
  rootNode.rotationQuaternion = null;
  rootNode.rotation.set(0, 0, 0);
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

  if (typeof pose.speaking === "boolean") {
    parts.isSpeaking = pose.speaking;
  }

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
  updateChestBadgePlacement(parts);
  updateAvatarFaceState(parts);
  updateNameAnchor(parts, rootNode);
}

async function ensureRemoteMesh(scene, id) {
  const existing = remoteMeshes.get(id);
  if (existing) return existing;

  const pending = pendingRemoteMeshes.get(id);
  if (pending) return await pending;

  if (remoteMeshes.has(id)) {
  return remoteMeshes.get(id);
}

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

    const bodyMeshes = bodyChildren.filter((m) => m && m !== headMesh);
    const bodyMesh = bodyMeshes[0] || bodyChildren[0] || null;

    root.metadata = {
      root,
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
      bodyMeshes,
      bodyMesh,
      headMesh,
      leftHandMesh,
      rightHandMesh,
    };

    applyAvatarAppearance(root.metadata, remotePlayerNames.get(id) || "Player", `remote_${id}`, null);

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

  const bodyMeshes = bodyChildren.filter((m) => m && m !== headMesh);
  const bodyMesh = bodyMeshes[0] || bodyChildren[0] || null;

  if (headMesh) {
    headMesh.isVisible = true;
  }

  localAvatarRoot = root;
  localAvatarParts = {
    root,
    bodyMeshes,
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

  ensureLocalAvatarCustomization();
  applyAvatarAppearance(localAvatarParts, playerName, "local", localAvatarCustomization);

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
  remotePlayerNames.set(id, name);

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
  remotePlayerNames.delete(id);
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
    iceServers: rtcIceServers
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

socket.on("init", async ({ selfId: id, players, chatMessages, sceneState }) => {
  selfId = id;
  console.log("[NET] init selfId:", selfId);
  logConnectedPlayers("init", players);
  replaceServerChatMessages(chatMessages);
  replaceSharedSceneState(sceneState);

  if (!sceneRef) return;

  for (const [id, mesh] of remoteMeshes.entries()) {
  mesh.dispose?.();
}
remoteMeshes.clear();

const otherPlayers = Object.values(players || {}).filter(
      (p) => p && p.id && p.id !== selfId
    );

    await Promise.all(
      otherPlayers.map((p) => ensureRemoteMesh(sceneRef, p.id))
    );
  logConnectedPlayers("after init");
});

socket.on("chat-message", (message) => {
  addServerChatMessage(message);
});

socket.on("scene-state-update", ({ scope, key, state }) => {
  applySharedSceneStateUpdate(scope, key, state);
});

socket.on("tv-debug-message", (message) => {
  if (!message) return;
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

  const activeIds = new Set(Object.keys(players));

  for (const [id, p] of Object.entries(players)) {
    if (id === selfId) continue;

    let mesh = remoteMeshes.get(id);

    if (!mesh) {
      mesh = await ensureRemoteMesh(sceneRef, id);
      if (!mesh) continue;
    }

    ensureRemoteNameLabel(id, mesh, p.name || "Player");

    applyAvatarAppearance(
      mesh.metadata,
      p.name || "Player",
      `remote_${id}`,
      deserializeAvatarCustomization(p.avatarCustomization, p.name || "Player")
    );

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

    applyAvatarPose(mesh.metadata, mesh, {
      avatarMode: p.avatarMode || "desktop",
      rootRotY: p.root?.rotY ?? 0,
      speaking: !!p.speaking,
      head: p.head,
      leftHand: p.leftHand,
      rightHand: p.rightHand,
    });

    updateRemoteAudioVolume(id);
  }

  for (const [id, mesh] of remoteMeshes.entries()) {
    if (!activeIds.has(id)) {
      mesh.dispose?.();
      remoteMeshes.delete(id);
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
    const nameCheck = isDisplayNameAllowed(options.playerName);
    if (!nameCheck.allowed) {
      appStarted = false;
      const error = new Error(nameCheck.reason || "Invalid player name.");
      error.code = "INVALID_PLAYER_NAME";
      throw error;
    }
    playerName = sanitizeDisplayName(options.playerName, playerName);
  }
  ensureLocalAvatarCustomization();

  const sceneId = typeof options.sceneId === "string" ? options.sceneId.trim() : "";

  try {
    await loadWebRTCConfig();
    await waitForSocketConnect();
    if (sceneId) {
      await requestSceneJoin(sceneId);
    }
  } catch (error) {
    appStarted = false;
    throw error;
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
    localVoiceAnalyser = createVoiceAnalyser(localStream);
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
  scene.chatControls = createChatControls();
  scene.sharedStateControls = createSharedStateControls();
  scene.avatarControls = createAvatarControls();
  for (const callback of scene._sharedStateReadyCallbacks || []) {
    callback(scene.sharedStateControls);
  }
  uiTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("nameUI", true, scene);
  applySceneVolume();
  applyPlayerVolume();

  await ensureLocalAvatar(scene);

  if (shouldShowDebugLayer()) {
    scene.debugLayer.show();
  }

  const SEND_HZ = 15;
  let lastSend = 0;

  engine.runRenderLoop(() => {
    scene.render();

    if (!scene.activeCamera) return;

    updateLocalVoiceActivity();
    updateRemoteVoiceActivity();
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

    const desktopForward = cam.getDirection(BABYLON.Axis.Z).normalize();
    const desktopRight = cam.getDirection(BABYLON.Axis.X).normalize();
    const desktopUp = cam.getDirection(BABYLON.Axis.Y).normalize();
    const desktopHandBase = headWorld
      .add(desktopUp.scale(-0.92))
      .add(desktopForward.scale(-0.02));

    let leftHand = {
      pos: {
        x: desktopHandBase.x - desktopRight.x * 0.24,
        y: desktopHandBase.y - desktopRight.y * 0.18,
        z: desktopHandBase.z - desktopRight.z * 0.18,
      },
      rot: { ...headRot },
    };

    let rightHand = {
      pos: {
        x: desktopHandBase.x + desktopRight.x * 0.24,
        y: desktopHandBase.y + desktopRight.y * 0.18,
        z: desktopHandBase.z + desktopRight.z * 0.18,
      },
      rot: { ...headRot },
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

    if (!xrActive) {
      const desktopHeldAnchor = scene.dartInteractionState?.desktopHold?.root
        ? scene.dartInteractionState?.desktopHold?.anchor
        : (scene.objectInteractionState?.desktopHold?.root
          ? scene.objectInteractionState?.desktopHold?.anchor
          : null);

      if (desktopHeldAnchor) {
        const anchorMatrix = desktopHeldAnchor.computeWorldMatrix(true);
        const anchorScaling = new BABYLON.Vector3();
        const anchorRotation = new BABYLON.Quaternion();
        const anchorPosition = new BABYLON.Vector3();
        anchorMatrix.decompose(anchorScaling, anchorRotation, anchorPosition);
        const avatarHandPosition = anchorPosition
          .add(desktopForward.scale(0.12))
          .add(desktopUp.scale(-0.42))
          .add(desktopRight.scale(0.18));

        rightHand = {
          pos: {
            x: avatarHandPosition.x,
            y: avatarHandPosition.y,
            z: avatarHandPosition.z,
          },
          rot: {
            x: anchorRotation.x,
            y: anchorRotation.y,
            z: anchorRotation.z,
            w: anchorRotation.w,
          },
        };
      }
    }

    if (localAvatarParts) {
      const avatarRootPos = pos.clone();
      const avatarScaleFactor = xrActive
        ? getAvatarScaleFactorForHeight(vrAvatarHeightOverride ?? Math.max(headWorld.y, 1.0))
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
      avatarCustomization: serializeAvatarCustomization(localAvatarCustomization),
      speaking: !!localAvatarParts?.isSpeaking,
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
  const enteredName = String(nameInput.value || "");
  const nameCheck = isDisplayNameAllowed(enteredName);
  if (!nameCheck.allowed) {
    alert(nameCheck.reason || "Please choose a different name.");
    nameInput.focus();
    nameInput.select?.();
    return;
  }

  const fallbackName = `Player-${Math.floor(Math.random() * 1000)}`;
  playerName = sanitizeDisplayName(enteredName, fallbackName);
  nameInput.value = playerName;
  localAvatarCustomization =
    readStoredAvatarCustomization(playerName) ||
    createDefaultAvatarCustomization(playerName);
  storeAvatarCustomization(localAvatarCustomization);

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

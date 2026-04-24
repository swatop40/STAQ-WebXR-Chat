import { Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, VideoTexture } from "babylonjs";
import * as GUI from "babylonjs-gui";

const TV_TRACKS_PER_PAGE = 4;
const TV_AUDIO_RADIUS = 18;
const TV_AUDIO_BASE_VOLUME = 1;
const TV_KARAOKE_FALLBACK_TRACKS = [
  { title: "Add MP4 Files", url: null, artist: "Drop files into public/karaoke-songs" },
  { title: "Songs Auto-Load", url: null, artist: "TV reads filenames from /api/karaoke-songs" },
];

const DEFAULT_TV_OPTIONS = {
  fileName: "tv.glb",
  interactable: true,
  interaction: {
    activateOnSelect: true,
  },
  screenPosition: { x: 0.14, y: -0.34, z: -0.09 },
  screenRotation: { x: 0, y: 4.71238898038469, z: 0 },
  screenScaling: { x: 2.73, y: 1.5, z: 1 },
  panelPosition: { x: 0.15, y: -0.4, z: -0.12 },
  panelRotationY: -Math.PI / 2,
  panelScaling: { x: 1, y: 1, z: 1 },
  panelSize: { width: 2.05, height: 1.16 },
};

function cloneTracks(tracks) {
  return tracks.map((track) => ({ ...track }));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function getTVListenerPosition(scene) {
  const listener =
    scene?.xrHelper?.baseExperience?.camera ||
    scene?.activeCamera ||
    scene?.playerMesh ||
    null;

  return listener?.globalPosition || listener?.position || null;
}

function getTVAudioFalloff(distance) {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= 0) return 1;
  if (distance >= TV_AUDIO_RADIUS) return 0;
  return 1 - (distance / TV_AUDIO_RADIUS);
}

function updateTVAudioVolume(root) {
  const video = root?.metadata?.tvVideoElement;
  const scene = root?.getScene?.();
  if (!video || !scene) return;

  const listenerPosition = getTVListenerPosition(scene);
  const sourcePosition =
    root.metadata?.tvScreenMesh?.getAbsolutePosition?.() ||
    root.getAbsolutePosition?.() ||
    null;

  if (!listenerPosition || !sourcePosition) {
    video.volume = TV_AUDIO_BASE_VOLUME;
    return;
  }

  const distance = listenerPosition.subtract(sourcePosition).length();
  const falloff = getTVAudioFalloff(distance);
  video.volume = clamp01(TV_AUDIO_BASE_VOLUME * falloff);
}

function applyScreenState(root, playerHost) {
  const screenMaterial = root.metadata?.tvScreenMaterial;
  if (!screenMaterial) return;

  if (
    root.metadata?.tvVideoTexture &&
    root.metadata?.tvPlayerState?.currentTrack?.url &&
    !root.metadata?.tvVideoElement?.paused
  ) {
    screenMaterial.diffuseColor = Color3.White();
    screenMaterial.emissiveColor = Color3.White();
    return;
  }

  screenMaterial.diffuseColor = new Color3(0.03, 0.04, 0.05);
  screenMaterial.emissiveColor = playerHost?.isEnabled()
    ? new Color3(0.14, 0.18, 0.24)
    : new Color3(0.08, 0.1, 0.14);
}

function styleTVButton(button, background = "#4e6f8d") {
  button.width = "88%";
  button.height = "74%";
  button.cornerRadius = 18;
  button.thickness = 2;
  button.color = "white";
  button.background = background;
  button.fontFamily = "Arial";
  button.fontSize = 58;
  button.paddingLeft = "8px";
  button.paddingRight = "8px";
  button.textBlock.textWrapping = true;
  button.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  button.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  return button;
}

async function loadTVTracks(root) {
  if (!root) return;

  const state = root.metadata?.tvPlayerState;
  if (state?.statusText) {
    state.statusText.text = "Loading songs...";
  }

  try {
    const response = await fetch("/api/karaoke-songs");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    const nextTracks = tracks.length
      ? tracks
      : [{ title: "No Songs Found", url: null, artist: "Add MP4 files to public/karaoke-songs" }];

    root.metadata = {
      ...(root.metadata || {}),
      tvTracks: nextTracks,
    };

    if (state) {
      state.tracks = nextTracks;
      state.pageIndex = 0;
      state.currentTrack = null;
      state.refreshTrackList?.();
      if (!tracks.length) {
        state.statusText.text = "No songs found";
      }
    }
  } catch (error) {
    console.warn("[TV] Failed to load karaoke tracks", error);
    if (state) {
      state.tracks = cloneTracks(TV_KARAOKE_FALLBACK_TRACKS);
      state.pageIndex = 0;
      state.currentTrack = null;
      state.refreshTrackList?.();
      state.statusText.text = "Couldn't load songs";
    }
  }
}

function ensureTVVideoPlayer(root) {
  if (root.metadata?.tvVideoElement && root.metadata?.tvVideoTexture) {
    return {
      video: root.metadata.tvVideoElement,
      texture: root.metadata.tvVideoTexture,
    };
  }

  const scene = root.getScene();
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.controls = false;
  video.loop = false;
  video.volume = TV_AUDIO_BASE_VOLUME;

  const texture = new VideoTexture(
    `${root.name}_videoTexture`,
    video,
    scene,
    true,
    false
  );

  const screenMaterial = root.metadata?.tvScreenMaterial;
  if (screenMaterial) {
    screenMaterial.diffuseTexture = texture;
    screenMaterial.emissiveTexture = texture;
    screenMaterial.diffuseColor = Color3.White();
    screenMaterial.emissiveColor = Color3.White();
  }

  const handleEnded = () => {
    const state = root.metadata?.tvPlayerState;
    if (!state) return;
    state.playPauseButton.textBlock.text = "Play";
    state.statusText.text = state.currentTrack
      ? `${state.currentTrack.title}\nFinished`
      : "Playback finished";
    root.metadata?.applyTVScreenState?.();
  };

  const handleError = () => {
    const state = root.metadata?.tvPlayerState;
    if (!state) return;
    state.playPauseButton.textBlock.text = "Play";
    state.statusText.text = `Unable to load video\n${state.currentTrack?.title || "Check MP4 path"}`;
    root.metadata?.applyTVScreenState?.();
  };

  video.addEventListener("ended", handleEnded);
  video.addEventListener("error", handleError);

  root.metadata = {
    ...(root.metadata || {}),
    tvVideoElement: video,
    tvVideoTexture: texture,
  };

  updateTVAudioVolume(root);

  return { video, texture };
}

function playTVTrack(root, track, statusText) {
  const state = root.metadata?.tvPlayerState;
  if (!state) return;

  state.currentTrack = track;

  if (!track?.url) {
    state.playPauseButton.textBlock.text = "Play";
    statusText.text = `${track?.title || "No file"}\nAdd a real MP4 path`;
    root.metadata?.applyTVScreenState?.();
    return;
  }

  const { video } = ensureTVVideoPlayer(root);
  if (video.src !== track.url) {
    video.src = track.url;
  }

  statusText.text = `Loading\n${track.title}`;
  const playPromise = video.play();
  state.playPauseButton.textBlock.text = "Pause";
  root.metadata?.applyTVScreenState?.();

  if (playPromise?.catch) {
    playPromise
      .then(() => {
        statusText.text = `${track.title}\nNow Playing`;
      })
      .catch((error) => {
        console.warn("[TV] Failed to play track", error);
        state.playPauseButton.textBlock.text = "Play";
        statusText.text = `Couldn't play\n${track.title}`;
        root.metadata?.applyTVScreenState?.();
      });
  } else {
    statusText.text = `${track.title}\nNow Playing`;
  }
}

function toggleTVPlayback(root, state) {
  const { video } = ensureTVVideoPlayer(root);
  if (!state.currentTrack?.url) {
    state.statusText.text = "Pick a song first";
    return;
  }

  if (video.paused) {
    const playPromise = video.play();
    state.playPauseButton.textBlock.text = "Pause";
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        console.warn("[TV] Failed to resume track", error);
        state.playPauseButton.textBlock.text = "Play";
        state.statusText.text = `Couldn't resume\n${state.currentTrack.title}`;
        root.metadata?.applyTVScreenState?.();
      });
    }
    state.statusText.text = `${state.currentTrack.title}\nNow Playing`;
    root.metadata?.applyTVScreenState?.();
    return;
  }

  video.pause();
  state.playPauseButton.textBlock.text = "Play";
  state.statusText.text = `${state.currentTrack.title}\nPaused`;
  root.metadata?.applyTVScreenState?.();
}

function stopTVPlayback(root, state) {
  const { video } = ensureTVVideoPlayer(root);
  video.pause();
  video.currentTime = 0;
  state.playPauseButton.textBlock.text = "Play";
  state.statusText.text = state.currentTrack
    ? `${state.currentTrack.title}\nStopped`
    : "Stopped";
  root.metadata?.applyTVScreenState?.();
}

function createTVPlayerPanel(root, options) {
  const playerHost = MeshBuilder.CreatePlane(
    `${root.name}_player`,
    {
      width: options.panelSize.width,
      height: options.panelSize.height,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    root.getScene()
  );
  playerHost.parent = root;
  playerHost.position.set(options.panelPosition.x, options.panelPosition.y, options.panelPosition.z);
  playerHost.rotationQuaternion = Quaternion.FromEulerAngles(0, options.panelRotationY, 0);
  playerHost.scaling.set(options.panelScaling.x, options.panelScaling.y, options.panelScaling.z);
  playerHost.isPickable = true;
  playerHost.metadata = {
    ...(playerHost.metadata || {}),
    suppressSceneInteraction: true,
  };

  const playerTexture = GUI.AdvancedDynamicTexture.CreateForMesh(
    playerHost,
    1600,
    900,
    false
  );

  const card = new GUI.Rectangle(`${root.name}_playerCard`);
  card.width = "100%";
  card.height = "100%";
  card.cornerRadius = 22;
  card.thickness = 3;
  card.color = "#bfd0df";
  card.background = "#0d1a29EE";
  playerTexture.addControl(card);

  const title = new GUI.TextBlock(`${root.name}_playerTitle`);
  title.text = "Karaoke TV";
  title.width = "100%";
  title.height = "12%";
  title.top = "-36%";
  title.color = "white";
  title.fontFamily = "Arial";
  title.fontSize = 64;
  title.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  title.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  title.textWrapping = true;
  card.addControl(title);

  const statusText = new GUI.TextBlock(`${root.name}_playerStatus`);
  statusText.text = "Select a song";
  statusText.width = "100%";
  statusText.height = "12%";
  statusText.top = "-24%";
  statusText.color = "#d8e6f3";
  statusText.fontFamily = "Arial";
  statusText.fontSize = 32;
  statusText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  statusText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  statusText.textWrapping = true;
  card.addControl(statusText);

  const grid = new GUI.Grid(`${root.name}_playerGrid`);
  grid.width = "76%";
  grid.height = "54%";
  grid.top = "4%";
  grid.addRowDefinition(0.5);
  grid.addRowDefinition(0.5);
  grid.addColumnDefinition(0.42);
  grid.addColumnDefinition(0.42);
  grid.addColumnDefinition(0.16);
  card.addControl(grid);

  const trackButtons = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const index = row * 2 + column;
      const button = GUI.Button.CreateSimpleButton(`${root.name}_track_${index}`, "");
      styleTVButton(button, "#39556f");
      button.width = "94%";
      button.height = "84%";
      button.fontSize = 30;
      button.onPointerUpObservable.add(() => {
        const track = button.metadata?.track;
        if (track) {
          playTVTrack(root, track, statusText);
        }
      });
      grid.addControl(button, row, column);
      trackButtons.push(button);
    }
  }

  const previousButton = GUI.Button.CreateSimpleButton(`${root.name}_pagePrev`, "<");
  styleTVButton(previousButton, "#5b6b7c");
  previousButton.width = "82%";
  previousButton.height = "84%";
  previousButton.fontSize = 54;
  grid.addControl(previousButton, 0, 2);

  const nextButton = GUI.Button.CreateSimpleButton(`${root.name}_pageNext`, ">");
  styleTVButton(nextButton, "#5b6b7c");
  nextButton.width = "82%";
  nextButton.height = "84%";
  nextButton.fontSize = 54;
  grid.addControl(nextButton, 1, 2);

  const controlsGrid = new GUI.Grid(`${root.name}_controlsGrid`);
  controlsGrid.width = "58%";
  controlsGrid.height = "16%";
  controlsGrid.top = "35%";
  controlsGrid.addRowDefinition(1);
  controlsGrid.addColumnDefinition(1 / 3);
  controlsGrid.addColumnDefinition(1 / 3);
  controlsGrid.addColumnDefinition(1 / 3);
  card.addControl(controlsGrid);

  const playPauseButton = GUI.Button.CreateSimpleButton(`${root.name}_playPause`, "Play");
  styleTVButton(playPauseButton, "#4e6f8d");
  playPauseButton.width = "92%";
  playPauseButton.height = "84%";
  playPauseButton.fontSize = 34;
  controlsGrid.addControl(playPauseButton, 0, 0);

  const stopButton = GUI.Button.CreateSimpleButton(`${root.name}_stop`, "Stop");
  styleTVButton(stopButton, "#6f4e4e");
  stopButton.width = "92%";
  stopButton.height = "84%";
  stopButton.fontSize = 34;
  controlsGrid.addControl(stopButton, 0, 1);

  const closeButton = GUI.Button.CreateSimpleButton(`${root.name}_close`, "Close");
  styleTVButton(closeButton, "#5b6b7c");
  closeButton.width = "92%";
  closeButton.height = "84%";
  closeButton.fontSize = 34;
  controlsGrid.addControl(closeButton, 0, 2);

  const state = {
    pageIndex: 0,
    tracks: root.metadata?.tvTracks || [],
    currentTrack: null,
    trackButtons,
    statusText,
    playPauseButton,
    previousButton,
    nextButton,
  };

  const refreshTrackList = () => {
    const pageCount = Math.max(1, Math.ceil(state.tracks.length / TV_TRACKS_PER_PAGE));
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, pageCount - 1));
    const startIndex = state.pageIndex * TV_TRACKS_PER_PAGE;
    const visibleTracks = state.tracks.slice(startIndex, startIndex + TV_TRACKS_PER_PAGE);

    for (let index = 0; index < state.trackButtons.length; index += 1) {
      const button = state.trackButtons[index];
      const track = visibleTracks[index] || null;
      button.metadata = { track };
      button.isEnabled = !!track;
      button.isVisible = !!track;
      if (track) {
        const subtitle = track.artist ? `\n${track.artist}` : "";
        button.textBlock.text = `${track.title}${subtitle}`;
      } else {
        button.textBlock.text = "";
      }
    }

    state.previousButton.isEnabled = state.pageIndex > 0;
    state.nextButton.isEnabled = state.pageIndex < pageCount - 1;
    if (!state.currentTrack) {
      state.statusText.text = `Select a song\nPage ${state.pageIndex + 1}/${pageCount}`;
    }
  };
  state.refreshTrackList = refreshTrackList;

  previousButton.onPointerUpObservable.add(() => {
    state.pageIndex -= 1;
    refreshTrackList();
  });

  nextButton.onPointerUpObservable.add(() => {
    state.pageIndex += 1;
    refreshTrackList();
  });

  playPauseButton.onPointerUpObservable.add(() => {
    toggleTVPlayback(root, state);
  });

  stopButton.onPointerUpObservable.add(() => {
    stopTVPlayback(root, state);
  });

  closeButton.onPointerUpObservable.add(() => {
    playerHost.setEnabled(false);
    root.metadata?.applyTVScreenState?.();
  });

  refreshTrackList();

  return {
    host: playerHost,
    texture: playerTexture,
    state,
  };
}

export function configureSceneTV(result, customOptions = {}) {
  const root = result?.meshes?.[0];
  if (!root || root.metadata?.tvSetupConfigured) return;

  const options = {
    ...DEFAULT_TV_OPTIONS,
    ...customOptions,
    screenPosition: { ...DEFAULT_TV_OPTIONS.screenPosition, ...(customOptions.screenPosition || {}) },
    screenRotation: { ...DEFAULT_TV_OPTIONS.screenRotation, ...(customOptions.screenRotation || {}) },
    screenScaling: { ...DEFAULT_TV_OPTIONS.screenScaling, ...(customOptions.screenScaling || {}) },
    panelPosition: { ...DEFAULT_TV_OPTIONS.panelPosition, ...(customOptions.panelPosition || {}) },
    panelScaling: { ...DEFAULT_TV_OPTIONS.panelScaling, ...(customOptions.panelScaling || {}) },
    panelSize: { ...DEFAULT_TV_OPTIONS.panelSize, ...(customOptions.panelSize || {}) },
  };

  const screen = MeshBuilder.CreatePlane(
    `${root.name}_screen`,
    {
      width: 1,
      height: 1,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    root.getScene()
  );

  screen.parent = root;
  screen.position.set(options.screenPosition.x, options.screenPosition.y, options.screenPosition.z);
  screen.rotation.set(options.screenRotation.x, options.screenRotation.y, options.screenRotation.z);
  screen.scaling.set(options.screenScaling.x, options.screenScaling.y, options.screenScaling.z);
  screen.isPickable = false;

  const screenMaterial = new StandardMaterial(`${root.name}_screenMaterial`, root.getScene());
  screenMaterial.diffuseColor = new Color3(0.03, 0.04, 0.05);
  screenMaterial.emissiveColor = new Color3(0.08, 0.1, 0.14);
  screenMaterial.specularColor = Color3.Black();
  screenMaterial.backFaceCulling = false;
  screen.material = screenMaterial;

  root.metadata = {
    ...(root.metadata || {}),
    tvSetupConfigured: true,
    tvScreenConfigured: true,
    tvScreenMesh: screen,
    tvScreenMaterial: screenMaterial,
    tvTracks: cloneTracks(TV_KARAOKE_FALLBACK_TRACKS),
  };

  const resultMeshes = result.meshes || [];
  const player = createTVPlayerPanel(root, options);
  const setTVPickableState = (isPickable) => {
    for (const mesh of resultMeshes) {
      mesh.isPickable = isPickable;
    }
  };

  root.metadata = {
    ...(root.metadata || {}),
    tvInteractionConfigured: true,
    tvPlayerHost: player.host,
    tvPlayerState: player.state,
    applyTVScreenState: () => applyScreenState(root, player.host),
    onActivate: () => {
      const nextVisible = !player.host.isEnabled();
      player.host.setEnabled(nextVisible);
      setTVPickableState(!nextVisible);
      applyScreenState(root, player.host);
    },
  };

  root.getScene().onBeforeRenderObservable.add(() => {
    updateTVAudioVolume(root);
  });

  root.metadata.applyTVScreenState();
  loadTVTracks(root);

  for (const mesh of resultMeshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      activateOnSelect: true,
      onActivate: root.metadata.onActivate,
      interactableRoot: root,
    };
  }
}

export function createSceneTVObject(config = {}) {
  const {
    fileName = DEFAULT_TV_OPTIONS.fileName,
    interactable = DEFAULT_TV_OPTIONS.interactable,
    interaction = DEFAULT_TV_OPTIONS.interaction,
    afterPlace,
    ...tvOptions
  } = config;

  return {
    fileName,
    interactable,
    interaction: {
      ...interaction,
    },
    ...tvOptions,
    afterPlace: (result) => {
      configureSceneTV(result, tvOptions);
      afterPlace?.(result);
    },
  };
}

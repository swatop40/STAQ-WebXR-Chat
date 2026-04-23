import { Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, StandardMaterial, Vector3, VideoTexture } from "babylonjs";
import * as GUI from "babylonjs-gui";
import {
  createBaseScene,
  createMirror,
  createStaticWall,
  loadSceneModel,
  markSceneInteractable,
  placeObjectModel,
} from "./sceneSetup.js";
import { setupSharedWebXR } from "./sharedWebXR.js";

const TABLE_POSITION = new Vector3(1.23, 1.59, 8.87);
const TABLE_ROTATION = new Vector3(0, Math.PI / 2, 0);
const TABLE_TOP_Y = 1.76;
const TV_TRACKS_PER_PAGE = 4;
const TV_KARAOKE_FALLBACK_TRACKS = [
  { title: "Add MP4 Files", url: null, artist: "Drop files into public/karaoke-songs" },
  { title: "Songs Auto-Load", url: null, artist: "TV reads filenames from /api/karaoke-songs" },
];
const pictureSwapResults = new Map();
const TEST_ROOM_OBJECTS = [
  {
    fileName: "table.glb",
    position: TABLE_POSITION,
    rotation: TABLE_ROTATION,
    scaling: new Vector3(1, 1, 1),
  },
  {
    fileName: "chair.glb",
    position: new Vector3(3.2, 0.68, 8.75),
    rotation: Vector3.Zero(),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "chair.glb",
    position: new Vector3(-0.61, 0.68, 8.75),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.5, 0.5, 0.5),
  },
  {
    fileName: "dart-target.glb",
    position: new Vector3(-7.16, 2.11, 10.98),
    rotation: new Vector3(0, -Math.PI / 2, 0),
    scaling: new Vector3(0.7, 0.7, 0.7),
    afterPlace: (result) => {
      forceOpaqueDartBoardTexture(result);
      markDartBoardTarget(result);
    },
  },
  {
    fileName: "dart-blue.glb",
    position: new Vector3(0.8, 1.76, 9.24),
    rotation: new Vector3(0, Math.PI / 6, 0),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      markDartInteractable(result);
    },
  },
  {
    fileName: "dart-red.glb",
    position: new Vector3(1.84, 1.76, 9.24),
    rotation: new Vector3(0, 0, -Math.PI / 6),
    scaling: new Vector3(0.19, 0.19, 0.19),
    afterPlace: (result) => {
      markDartInteractable(result);
    },
  },
  {
    fileName: "mug.glb",
    position: new Vector3(0.48, TABLE_TOP_Y, 8.63),
    rotation: new Vector3(0, -Math.PI / 5, 0),
    scaling: new Vector3(0.26, 0.26, 0.26),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.02, 0.02),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(0, -0.02, 0.04),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "decanter.glb",
    position: new Vector3(1.25, TABLE_TOP_Y, 8.57),
    rotation: new Vector3(0, Math.PI / 9, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.03, 0.03),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(0, -0.02, 0.06),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "booze_bottle1.glb",
    position: new Vector3(0.86, TABLE_TOP_Y, 8.92),
    rotation: new Vector3(0, -Math.PI / 10, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, 3.84, 0.02),
      xrGrabRotation: new Vector3(0, 0, 0),
      desktopGrabOffset: new Vector3(0, 3.84, 0.04),
      desktopGrabRotation: new Vector3(0, 0, 0),
    },
  },
  {
    fileName: "vodka_bottle1.glb",
    position: new Vector3(1.58, TABLE_TOP_Y, 8.95),
    rotation: new Vector3(0, Math.PI / 8, 0),
    scaling: new Vector3(0.2, 0.2, 0.2),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0, -0.02, 0.02),
      xrGrabRotation: new Vector3(0, Math.PI / 2, 0),
      desktopGrabOffset: new Vector3(0, -0.02, 0.04),
      desktopGrabRotation: new Vector3(0, Math.PI / 2, 0),
    },
  },
  {
    fileName: "microphone.glb",
    position: new Vector3(2.05, TABLE_TOP_Y + 0.03, 9.18),
    rotation: new Vector3(0, Math.PI / 2.7, Math.PI / 2),
    scaling: new Vector3(0.11, 0.11, 0.11),
    interactable: true,
    interaction: {
      pickup: true,
      xrGrabOffset: new Vector3(0.04, 0, 0),
      xrGrabRotation: new Vector3(0, 0, -Math.PI / 2),
      desktopGrabOffset: new Vector3(0.06, -0.01, 0),
      desktopGrabRotation: new Vector3(0, 0, -Math.PI / 2),
    },
  },
  {
    fileName: "Bar_Stool.glb",
    position: new Vector3(1.24, 0, 7),
    rotation: new Vector3(0, Math.PI, 0),
    scaling: new Vector3(0.32, 0.32, 0.32),
    interactable: false,
  },
  {
    fileName: "mic-stand.glb",
    position: new Vector3(4.41, 0, 9.75),
    rotation: new Vector3(0, -Math.PI / 2.7, 0),
    scaling: new Vector3(0.13, 0.13, 0.13),
    interactable: false,
  },
  {
    fileName: "microphone-and-stand.glb",
    position: new Vector3(-1.97, 0, 8.88),
    rotation: new Vector3(0, Math.PI / 2.8, 0),
    scaling: new Vector3(0.12, 0.12, 0.12),
    interactable: false,
  },
  {
    fileName: "tv.glb",
    position: new Vector3(0.95, 4.66, 10.93),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.95, 0.95, 0.95),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      configureTVScreen(result);
      configureTVInteraction(result);
    },
  },
  {
    fileName: "andy-picture.glb",
    position: new Vector3(-1.25, 2.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("andy-picture.glb", result);
    },
  },
  {
    fileName: "sam-picture.glb",
    position: new Vector3(3.15, 2.17, 10.94),
    rotation: new Vector3(0, Math.PI / 2, 0),
    scaling: new Vector3(0.55, 0.55, 0.55),
    interactable: true,
    interaction: {
      activateOnSelect: true,
    },
    afterPlace: (result) => {
      registerPictureSwapResult("sam-picture.glb", result);
    },
  },
  {
    fileName: "avatar-body.glb",
    position: new Vector3(-9.47, 0, 9.47),
    rotation: new Vector3(0, Math.PI / 1.5, 0),
    scaling: new Vector3(0.8, 0.8, 0.8),
  },
];

async function addTestRoomProps(scene) {
  for (const object of TEST_ROOM_OBJECTS) {
    const result = await placeObjectModel(
      scene,
      object.fileName,
      object.position,
      object.rotation,
      object.scaling
    );

    if (object.interactable) {
      markSceneInteractable(result, object.fileName, object.interaction);
    }

    object.afterPlace?.(result);
  }
}

function markDartInteractable(result) {
  const root = result.meshes[0];
  if (!root) return;

  root.metadata = {
    ...(root.metadata || {}),
    isThrowableDart: true,
    dartRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isThrowableDart: true,
      dartRoot: root,
    };
  }
}

function configureTVScreen(result) {
  const root = result.meshes[0];
  if (!root || root.metadata?.tvScreenConfigured) return;

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
  screen.position.set(0.14, -0.34, -0.09);
  screen.rotation.set(0, 4.71238898038469, 0);
  screen.scaling.set(2.73, 1.5, 1);
  screen.isPickable = false;

  const screenMaterial = new StandardMaterial(`${root.name}_screenMaterial`, root.getScene());
  screenMaterial.diffuseColor = new Color3(0.03, 0.04, 0.05);
  screenMaterial.emissiveColor = new Color3(0.08, 0.1, 0.14);
  screenMaterial.specularColor = Color3.Black();
  screenMaterial.backFaceCulling = false;
  screen.material = screenMaterial;

  root.metadata = {
    ...(root.metadata || {}),
    tvScreenConfigured: true,
    tvScreenMesh: screen,
    tvScreenMaterial: screenMaterial,
    tvTracks: TV_KARAOKE_FALLBACK_TRACKS.map((track) => ({ ...track })),
  };
}

function configureTVInteraction(result) {
  const root = result.meshes[0];
  if (!root || root.metadata?.tvInteractionConfigured !== undefined) return;

  const player = createTVPlayerPanel(root);
  const applyTVScreenState = () => {
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
    screenMaterial.emissiveColor = player.host.isEnabled()
      ? new Color3(0.14, 0.18, 0.24)
      : new Color3(0.08, 0.1, 0.14);
  };

  const setPlayerVisible = (isVisible) => {
    player.host.setEnabled(isVisible);
    applyTVScreenState();
  };

  const togglePlayer = () => {
    const nextVisible = !player.host.isEnabled();
    setPlayerVisible(nextVisible);
  };

  setPlayerVisible(false);

  root.metadata = {
    ...(root.metadata || {}),
    activateOnSelect: true,
    tvInteractionConfigured: true,
    tvPlayerHost: player.host,
    tvPlayerState: player.state,
    applyTVScreenState,
    onActivate: () => {
      togglePlayer();
    },
  };

  loadTVTracks(root);

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      activateOnSelect: true,
      onActivate: root.metadata.onActivate,
      interactableRoot: root,
    };
  }
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
      state.tracks = TV_KARAOKE_FALLBACK_TRACKS.map((track) => ({ ...track }));
      state.pageIndex = 0;
      state.currentTrack = null;
      state.refreshTrackList?.();
      state.statusText.text = "Couldn't load songs";
    }
  }
}

function createTVPlayerPanel(root) {
  const playerHost = MeshBuilder.CreatePlane(
    `${root.name}_player`,
    { width: 2.05, height: 1.16, sideOrientation: Mesh.DOUBLESIDE },
    root.getScene()
  );
  playerHost.parent = root;
  playerHost.position.set(0.15, -0.4, -0.12);
  playerHost.rotationQuaternion = Quaternion.FromEulerAngles(0, -Math.PI / 2, 0);
  playerHost.scaling.set(1, 1, 1);
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

  const grid = new GUI.Grid(`${root.name}_playerGrid`);
  grid.width = "92%";
  grid.height = "88%";
  grid.addRowDefinition(0.16);
  grid.addRowDefinition(0.14);
  grid.addRowDefinition(0.22);
  grid.addRowDefinition(0.22);
  grid.addRowDefinition(0.26);
  grid.addColumnDefinition(0.18);
  grid.addColumnDefinition(0.64);
  grid.addColumnDefinition(0.18);
  card.addControl(grid);

  const title = new GUI.TextBlock(`${root.name}_playerTitle`);
  title.text = "Karaoke TV";
  title.color = "white";
  title.fontFamily = "Arial";
  title.fontSize = 72;
  title.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  title.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  title.textWrapping = true;
  title.columnSpan = 3;
  grid.addControl(title, 0, 0);

  const statusText = new GUI.TextBlock(`${root.name}_playerStatus`);
  statusText.text = "Select a song";
  statusText.color = "#d8e6f3";
  statusText.fontFamily = "Arial";
  statusText.fontSize = 36;
  statusText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  statusText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  statusText.textWrapping = true;
  statusText.columnSpan = 3;
  grid.addControl(statusText, 1, 0);

  const trackButtons = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const index = row * 2 + column;
      const button = GUI.Button.CreateSimpleButton(`${root.name}_track_${index}`, "");
      styleTVLauncherButton(button, "#39556f");
      button.width = "94%";
      button.height = "82%";
      button.fontSize = 44;
      button.onPointerUpObservable.add(() => {
        const track = button.metadata?.track;
        if (track) {
          playTVTrack(root, track, statusText);
        }
      });
      grid.addControl(button, 2 + row, column === 0 ? 0 : 1);
      trackButtons.push(button);
    }
  }

  const previousButton = GUI.Button.CreateSimpleButton(`${root.name}_pagePrev`, "<");
  styleTVLauncherButton(previousButton, "#5b6b7c");
  previousButton.width = "84%";
  previousButton.height = "82%";
  previousButton.fontSize = 72;
  grid.addControl(previousButton, 2, 2);

  const nextButton = GUI.Button.CreateSimpleButton(`${root.name}_pageNext`, ">");
  styleTVLauncherButton(nextButton, "#5b6b7c");
  nextButton.width = "84%";
  nextButton.height = "82%";
  nextButton.fontSize = 72;
  grid.addControl(nextButton, 3, 2);

  const controlsGrid = new GUI.Grid(`${root.name}_controlsGrid`);
  controlsGrid.width = "100%";
  controlsGrid.height = "92%";
  controlsGrid.addRowDefinition(1);
  controlsGrid.addColumnDefinition(1 / 3);
  controlsGrid.addColumnDefinition(1 / 3);
  controlsGrid.addColumnDefinition(1 / 3);
  grid.addControl(controlsGrid, 4, 0);
  controlsGrid.columnSpan = 3;

  const playPauseButton = GUI.Button.CreateSimpleButton(`${root.name}_playPause`, "Play");
  styleTVLauncherButton(playPauseButton, "#4e6f8d");
  playPauseButton.width = "92%";
  playPauseButton.height = "72%";
  playPauseButton.fontSize = 42;
  controlsGrid.addControl(playPauseButton, 0, 0);

  const stopButton = GUI.Button.CreateSimpleButton(`${root.name}_stop`, "Stop");
  styleTVLauncherButton(stopButton, "#6f4e4e");
  stopButton.width = "92%";
  stopButton.height = "72%";
  stopButton.fontSize = 42;
  controlsGrid.addControl(stopButton, 0, 1);

  const closeButton = GUI.Button.CreateSimpleButton(`${root.name}_close`, "Close");
  styleTVLauncherButton(closeButton, "#5b6b7c");
  closeButton.width = "92%";
  closeButton.height = "72%";
  closeButton.fontSize = 42;
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

function styleTVLauncherButton(button, background = "#4e6f8d") {
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
  video.volume = 1;

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

function registerPictureSwapResult(key, result) {
  pictureSwapResults.set(key, result);
  if (pictureSwapResults.size < 2) return;

  const andyResult = pictureSwapResults.get("andy-picture.glb");
  const samResult = pictureSwapResults.get("sam-picture.glb");
  if (!andyResult || !samResult) return;

  configurePictureSwap(andyResult, samResult);
  configurePictureSwap(samResult, andyResult);
}

function configurePictureSwap(primaryResult, alternateResult) {
  const primaryRoot = primaryResult.meshes[0];
  if (primaryRoot?.metadata?.pictureSwapConfigured) return;
  const primaryPictureMesh = findPictureSurfaceMesh(primaryResult);
  if (!primaryRoot || !primaryPictureMesh) return;

  primaryRoot.metadata = {
    ...(primaryRoot.metadata || {}),
    activateOnSelect: true,
    pictureSwapConfigured: true,
    onActivate: () => {
      primaryPictureMesh.setEnabled(!primaryPictureMesh.isEnabled());
    },
  };

  for (const mesh of primaryResult.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      activateOnSelect: true,
      onActivate: primaryRoot.metadata.onActivate,
      interactableRoot: primaryRoot,
    };
  }
}

function findPictureSurfaceMesh(result) {
  return result.meshes.find((mesh) => mesh.material?.name?.toLowerCase?.().includes("-prof")) || null;
}

function markDartBoardTarget(result) {
  const root = result.meshes[0];
  if (!root) return;

  root.metadata = {
    ...(root.metadata || {}),
    isDartBoardTarget: true,
    dartBoardRoot: root,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isDartBoardTarget: true,
      dartBoardRoot: root,
    };
  }
}

function forceOpaqueDartBoardTexture(result) {
  const materials = new Set(
    result.meshes
      .map((mesh) => mesh.material)
      .filter(Boolean)
  );

  for (const material of materials) {
    material.alpha = 1;
    material.backFaceCulling = false;

    if ("transparencyMode" in material) {
      material.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    }

    if ("useAlphaFromAlbedoTexture" in material) {
      material.useAlphaFromAlbedoTexture = false;
    }

    for (const texture of [material.albedoTexture, material.diffuseTexture]) {
      if (!texture) continue;
      texture.hasAlpha = false;
      texture.getAlphaFromRGB = false;
    }
  }
}

function addTestRoomCollision(scene) {
  const wallHeight = 2;
  const wallLength = 6;
  const wallThickness = 0.2;

  createStaticWall(
    scene,
    "backWall",
    { width: wallLength, height: wallHeight, depth: wallThickness },
    new Vector3(0, wallHeight / 2, wallLength / 2)
  );

  createStaticWall(
    scene,
    "leftWall",
    { width: wallThickness, height: wallHeight, depth: wallLength },
    new Vector3(-wallLength / 2, wallHeight / 2, 0)
  );

  createStaticWall(
    scene,
    "rightWall",
    { width: wallThickness, height: wallHeight, depth: wallLength },
    new Vector3(wallLength / 2, wallHeight / 2, 0)
  );
}

export async function startScene(engine) {
  const {
    scene,
    desktopKeys,
    ground,
    playerHeight,
    playerSpawn,
  } = createBaseScene(engine);

  const mirror = createMirror(scene);

  await loadSceneModel(scene, "test-room.glb");
  await addTestRoomProps(scene);
  addTestRoomCollision(scene);

  await setupSharedWebXR(scene, {
    ground,
    mirror,
    desktopKeys,
    playerHeight,
    playerSpawn,
    dartGamePanelTransform: {
      position: new Vector3(-5.49, 2.11, 10.99),
      rotation: Vector3.Zero(),
    },
  });

  await scene.whenReadyAsync();
  return scene;
}

export async function loadScene(engine) {
  return startScene(engine);
}

import { Color3, Mesh, MeshBuilder, Vector3 } from "babylonjs";
import * as GUI from "babylonjs-gui";

const DEFAULT_OPTIONS = {
  position: new Vector3(-3.35, 0.7, 0.03),
  rotation: Vector3.Zero(),
  scaling: new Vector3(1, 1, 1),
  size: { width: 1.96, height: 1.08 },
};

const MAIN_TARGETS = [
  { key: "body", label: "Body" },
  { key: "head", label: "Head" },
  { key: "arms", label: "Arms" },
  { key: "legs", label: "Legs" },
  { key: "hands", label: "Hands" },
  { key: "badge-menu", label: "Badge Menu" },
  { key: "face-menu", label: "Face Menu" },
];

const BADGE_TARGETS = [
  { key: "badge", label: "Badge Fill" },
  { key: "badgeText", label: "Badge Text" },
  { key: "main-menu", label: "Back" },
];

const FACE_TARGETS = [
  { key: "face", label: "Face Plates" },
  { key: "main-menu", label: "Back" },
];

const COLOR_LABELS = {
  "#4F46E5": "Indigo",
  "#0F766E": "Teal",
  "#B91C1C": "Red",
  "#2563EB": "Blue",
  "#7C3AED": "Purple",
  "#EA580C": "Orange",
  "#111827": "Black",
  "#475569": "Gray",
  "#84CC16": "Green",
  "#E11D48": "Pink",
  "#F59E0B": "Gold",
  "#F8FAFC": "White",
};

function makeButton(name, text, background = "#4e6f8d") {
  const button = GUI.Button.CreateSimpleButton(name, text);
  button.width = "88%";
  button.height = "78%";
  button.cornerRadius = 16;
  button.thickness = 2;
  button.color = "white";
  button.background = background;
  button.fontFamily = "Arial";
  button.fontSize = 62;
  button.paddingLeft = "8px";
  button.paddingRight = "8px";
  button.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  button.textBlock.textWrapping = true;
  button.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  button.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  return button;
}

function toColorLabel(hex) {
  return COLOR_LABELS[(hex || "").toUpperCase()] || (hex || "").replace("#", "");
}

function getContrastText(hex) {
  try {
    const color = Color3.FromHexString(hex);
    const luminance = (color.r * 0.299) + (color.g * 0.587) + (color.b * 0.114);
    return luminance > 0.62 ? "#111827" : "#F8FAFC";
  } catch {
    return "white";
  }
}

function getTargetList(page) {
  if (page === "badge") return BADGE_TARGETS;
  if (page === "face") return FACE_TARGETS;
  return MAIN_TARGETS;
}

export function createAvatarMirrorPanel(scene, mirror, customOptions = {}) {
  if (!scene || !mirror) return null;

  const options = {
    ...DEFAULT_OPTIONS,
    ...customOptions,
    position: customOptions.position || DEFAULT_OPTIONS.position.clone(),
    rotation: customOptions.rotation || DEFAULT_OPTIONS.rotation.clone(),
    scaling: customOptions.scaling || DEFAULT_OPTIONS.scaling.clone(),
    size: { ...DEFAULT_OPTIONS.size, ...(customOptions.size || {}) },
  };

  const board = MeshBuilder.CreatePlane(
    "avatarMirrorPanel",
    { width: options.size.width, height: options.size.height, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );
  board.parent = mirror;
  board.position.copyFrom(options.position);
  board.rotation.copyFrom(options.rotation);
  board.scaling.copyFrom(options.scaling);
  board.isPickable = true;
  board.metadata = {
    ...(board.metadata || {}),
    suppressSceneInteraction: true,
  };

  const texture = GUI.AdvancedDynamicTexture.CreateForMesh(board, 3120, 1760, false);

  const card = new GUI.Rectangle("avatarMirrorPanelCard");
  card.width = "99.2%";
  card.height = "96%";
  card.thickness = 3;
  card.cornerRadius = 28;
  card.color = "#bfd0df";
  card.background = "#0d1a29F2";
  texture.addControl(card);

  const rootGrid = new GUI.Grid("avatarMirrorPanelGrid");
  rootGrid.width = "88%";
  rootGrid.height = "92%";
  rootGrid.addColumnDefinition(0.08);
  rootGrid.addColumnDefinition(0.22);
  rootGrid.addColumnDefinition(0.04);
  rootGrid.addColumnDefinition(0.56);
  rootGrid.addColumnDefinition(0.10);
  rootGrid.addRowDefinition(0.14);
  rootGrid.addRowDefinition(0.74);
  rootGrid.addRowDefinition(0.12);
  card.addControl(rootGrid);

  const title = new GUI.TextBlock("avatarMirrorTitle", "Avatar Style");
  title.color = "white";
  title.fontFamily = "Arial";
  title.fontSize = 78;
  title.width = "100%";
  title.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  title.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  rootGrid.addControl(title, 0, 1);

  const leftColumn = new GUI.Grid("avatarMirrorLeftColumn");
  leftColumn.width = "100%";
  leftColumn.height = "100%";
  leftColumn.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  leftColumn.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  for (let i = 0; i < 8; i += 1) {
    leftColumn.addRowDefinition(1 / 8);
  }
  rootGrid.addControl(leftColumn, 1, 1);

  const rightColumn = new GUI.Grid("avatarMirrorRightColumn");
  rightColumn.width = "100%";
  rightColumn.height = "100%";
  rightColumn.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  rightColumn.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  rightColumn.addRowDefinition(0.14);
  rightColumn.addRowDefinition(0.86);
  rootGrid.addControl(rightColumn, 1, 3);

  const sectionLabel = new GUI.TextBlock("avatarMirrorSectionLabel", "Body");
  sectionLabel.color = "#d8e6f4";
  sectionLabel.fontFamily = "Arial";
  sectionLabel.fontSize = 74;
  sectionLabel.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  sectionLabel.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  rightColumn.addControl(sectionLabel, 0, 0);

  const optionGrid = new GUI.Grid("avatarMirrorOptionGrid");
  optionGrid.width = "100%";
  optionGrid.height = "100%";
  optionGrid.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  optionGrid.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  for (let i = 0; i < 4; i += 1) {
    optionGrid.addColumnDefinition(0.25);
  }
  for (let i = 0; i < 3; i += 1) {
    optionGrid.addRowDefinition(1 / 3);
  }
  rightColumn.addControl(optionGrid, 1, 0);

  const footerGrid = new GUI.Grid("avatarMirrorFooterGrid");
  footerGrid.width = "100%";
  footerGrid.height = "100%";
  footerGrid.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  footerGrid.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  footerGrid.addColumnDefinition(1);
  rootGrid.addControl(footerGrid, 2, 1);

  const status = new GUI.TextBlock("avatarMirrorStatus", "Waiting for avatar controls...");
  status.color = "#d8e6f4";
  status.fontFamily = "Arial";
  status.fontSize = 44;
  status.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
  status.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
  status.width = "100%";
  footerGrid.addControl(status, 0, 0);

  let currentPage = "main";
  let selectedTarget = "body";
  let navButtons = [];
  let optionButtons = [];
  let lastSnapshot = "";

  function getAvatarControls() {
    return scene.avatarControls || null;
  }

  function clearButtons(buttons, grid) {
    for (const button of buttons) {
      grid.removeControl(button);
    }
    buttons.length = 0;
  }

  function addNavButton(target, row, active = false) {
    const button = makeButton(
      `avatarNav_${target.key}`,
      target.label,
      active ? "#5da8dd" : "#4e6f8d"
    );
    button.fontSize = 52;
    button.onPointerUpObservable.add(() => {
      if (target.key === "badge-menu") {
        currentPage = "badge";
        selectedTarget = "badge";
      } else if (target.key === "face-menu") {
        currentPage = "face";
        selectedTarget = "face";
      } else if (target.key === "main-menu") {
        currentPage = "main";
        selectedTarget = "body";
      } else {
        selectedTarget = target.key;
      }
      refreshAll();
    });
    leftColumn.addControl(button, row, 0);
    navButtons.push(button);
  }

  function addResetNavButton() {
    const button = makeButton("avatarNav_reset", "Reset", "#6d7f92");
    button.fontSize = 52;
    button.onPointerUpObservable.add(() => {
      const controls = getAvatarControls();
      controls?.resetCustomization?.();
      currentPage = "main";
      selectedTarget = "body";
      refreshAll();
    });
    leftColumn.addControl(button, 7, 0);
    navButtons.push(button);
  }

  function addOptionButton(text, row, column, background, onClick, color = "white", fontSize = 36) {
    const button = makeButton(`avatarOption_${row}_${column}_${text}`, text, background);
    button.fontSize = fontSize;
    button.color = color;
    button.onPointerUpObservable.add(onClick);
    optionGrid.addControl(button, row, column);
    optionButtons.push(button);
  }

  function refreshNav() {
    clearButtons(navButtons, leftColumn);
    const targets = getTargetList(currentPage);
    targets.forEach((target, index) => {
      const isActive = target.key === selectedTarget
        || (target.key === "badge-menu" && currentPage === "badge")
        || (target.key === "face-menu" && currentPage === "face");
      addNavButton(target, index, isActive);
    });
    addResetNavButton();
  }

  function refreshOptions() {
    clearButtons(optionButtons, optionGrid);
    const controls = getAvatarControls();
    if (!controls) {
      status.text = "Waiting for avatar controls...";
      return;
    }

    const customization = controls.getCurrentCustomization();

    if (currentPage === "face") {
      sectionLabel.text = "Face Plates";
      const faces = controls.getFaceOptions();
      faces.forEach((face, index) => {
        addOptionButton(
          face,
          Math.floor(index / 4),
          index % 4,
          customization.faceExpression === face ? "#5da8dd" : "#4e6f8d",
          () => {
            controls.setFaceExpression(face);
            refreshAll();
          },
          "white",
          74
        );
      });
      status.text = `Face: ${customization.faceExpression}`;
      return;
    }

    const sectionLabelText = {
      body: "Body Color",
      head: "Head Color",
      arms: "Arm Color",
      legs: "Leg Color",
      hands: "Hand Color",
      badge: "Badge Fill",
      badgeText: "Badge Text",
    };
    sectionLabel.text = sectionLabelText[selectedTarget] || "Colors";

    const colors = controls.getColorOptions();
    colors.forEach((hex, index) => {
      addOptionButton(
        toColorLabel(hex),
        Math.floor(index / 4),
        index % 4,
        hex,
        () => {
          controls.setPartColor(selectedTarget, hex);
          refreshAll();
        },
        getContrastText(hex),
        54
      );
    });

    if (selectedTarget === "badge" || selectedTarget === "badgeText") {
      status.text = selectedTarget === "badge"
        ? "Badge background color"
        : "Badge letter color";
    } else {
      status.text = `${sectionLabel.text}`;
    }
  }

  function refreshAll() {
    refreshNav();
    refreshOptions();
  }

  scene.onBeforeRenderObservable.add(() => {
    const controls = getAvatarControls();
    if (!controls) return;

    const customization = controls.getCurrentCustomization();
    const snapshot = JSON.stringify(customization) + `|${currentPage}|${selectedTarget}`;
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    refreshAll();
  });

  refreshAll();

  scene.avatarMirrorPanel = {
    board,
    texture,
    options,
  };

  return scene.avatarMirrorPanel;
}

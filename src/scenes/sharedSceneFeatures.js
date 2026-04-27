import { PBRMaterial } from "babylonjs";

function registerSharedStateReady(scene, callback) {
  if (!scene || typeof callback !== "function") return;

  if (scene.sharedStateControls) {
    callback(scene.sharedStateControls);
    return;
  }

  if (!scene._sharedStateReadyCallbacks) {
    scene._sharedStateReadyCallbacks = [];
  }

  scene._sharedStateReadyCallbacks.push(callback);
}

export function configureThrowableDart(result) {
  const root = result?.meshes?.[0];
  if (!root) return;

  const baseLocalScaling = root.scaling.clone();
  root.metadata = {
    ...(root.metadata || {}),
    isThrowableDart: true,
    dartRoot: root,
    baseLocalScaling,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      isThrowableDart: true,
      dartRoot: root,
      baseLocalScaling: baseLocalScaling.clone(),
    };
  }
}

export function forceOpaqueResultMaterials(result) {
  const materials = new Set(
    (result?.meshes || []).map((mesh) => mesh.material).filter(Boolean)
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

export function configureDartBoardTarget(result, options = {}) {
  const {
    forceOpaqueTexture = false,
  } = options;

  if (forceOpaqueTexture) {
    forceOpaqueResultMaterials(result);
  }

  const root = result?.meshes?.[0];
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

function findPictureSurfaceMesh(result) {
  return (
    result?.meshes?.find(
      (mesh) => mesh.material?.name?.toLowerCase?.().includes("-prof")
    ) || null
  );
}

export function configurePictureReveal(result, options = {}) {
  const root = result?.meshes?.[0];
  if (!root || root.metadata?.pictureSwapConfigured) return;

  const pictureMesh = findPictureSurfaceMesh(result);
  if (!pictureMesh) return;

  const scene = root.getScene();
  const pictureStateKey = options.stateKey || root.name;
  let applyingRemoteState = false;

  const applyPictureVisibility = (visible, shouldBroadcast = true) => {
    pictureMesh.setEnabled(visible);
    if (shouldBroadcast && !applyingRemoteState) {
      scene.sharedStateControls?.emit("picture", pictureStateKey, { visible });
    }
  };

  const onActivate = () => {
    applyPictureVisibility(!pictureMesh.isEnabled(), true);
  };

  root.metadata = {
    ...(root.metadata || {}),
    activateOnSelect: true,
    pictureSwapConfigured: true,
    onActivate,
  };

  for (const mesh of result.meshes) {
    mesh.isPickable = true;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      activateOnSelect: true,
      onActivate,
      interactableRoot: root,
    };
  }

  registerSharedStateReady(scene, (controls) => {
    controls.subscribe("picture", pictureStateKey, (state) => {
      if (typeof state?.visible !== "boolean") return;
      applyingRemoteState = true;
      applyPictureVisibility(state.visible, false);
      applyingRemoteState = false;
    });
  });
}

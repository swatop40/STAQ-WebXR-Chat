import {
  Scene,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  FreeCamera,
  SceneLoader,
  WebXRFeatureName,
} from "babylonjs";
import "babylonjs-loaders";

export async function startScene(engine) {
  const scene = new Scene(engine);

  
  const cam = new FreeCamera("cam", new Vector3(0.25, 2, -8), scene);
  cam.rotation = new Vector3(0.19996493417004554, -6.291316540956004, 0);
  cam.attachControl(); 
  new HemisphericLight("light", new Vector3(0, 2, 0), scene);

  
  const box = MeshBuilder.CreateBox("box", { size: 0.5 }, scene);
  box.position = new Vector3(0, 1, 0);

  const ground = MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);
  ground.position.y = -0.25;

  
  const room = await SceneLoader.ImportMeshAsync(null, "/models/", "room.glb", scene);
  console.log("Imported meshes:", room.meshes.map((m) => m.name));

  
  const xr = await scene.createDefaultXRExperienceAsync({
    uiOptions: { sessionMode: "immersive-vr" },
  });

  const fm = xr.baseExperience.featuresManager;
  fm.disableFeature(WebXRFeatureName.TELEPORTATION);


  
  try {
    fm.enableFeature(WebXRFeatureName.MOVEMENT, "stable", {
        xrInput: xr.input,
        movementOrientationFollowsViewerPose: true,
        movementSpeed: 0.25,
        rotationSpeed: 0.25,
    });
    console.log("[XR] Smooth movement enabled");
  } catch (e) {
    console.error("[XR] Movement feature failed:", e);
  }

  
  try {
    fm.enableFeature(WebXRFeatureName.TURNING, "stable", {
      snapTurns: true,
      snapTurnAngle: Math.PI / 6,
    });
    console.log("[XR] Turning enabled");
  } catch (e) {
    console.warn("[XR] Turning feature not available; we’ll do manual snap turn if needed.", e);
  }

  await scene.whenReadyAsync();
  return scene;
}
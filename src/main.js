// main.js — Basic Babylon.js scene setup with inspector toggle
// Creates a minimal scene, camera, light and a box so the canvas shows
// something immediately. Also enables the Babylon inspector which can be
// toggled with the typed sequence "debug".
import * as BABYLON from 'babylonjs'
import "babylonjs-inspector";
import {startScene} from './scenes/start.js';






const canvas = document.getElementById("renderCanvas");
if (!canvas) throw new Error("Canvas #renderCanvas not found");

const engine = new BABYLON.Engine(canvas, true);

async function main() {
  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------
  // Create the scene object. All cameras, lights and meshes belong to a scene.
  const scene = await startScene(engine);
  scene.debugLayer.show();

  // ---------------------------------------------------------------------------
  // Render loop & resize handling
  // ---------------------------------------------------------------------------
  // The engine's render loop continuously calls scene.render() so the scene is
  // redrawn each frame. This is required for animations and user interaction.
  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

  main();

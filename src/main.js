// main.js — Basic Babylon.js scene setup with inspector toggle
// Creates a minimal scene, camera, light and a box so the canvas shows
// something immediately. Also enables the Babylon inspector which can be
// toggled with the typed sequence "debug".
import * as BABYLON from 'babylonjs'
import "babylonjs-inspector";
import {startScene} from './scenes/start.js';
import {io} from "socket.io-client";

const socket = io("http://localhost:3000"); //placeholder

socket.on("connect", () =>
{
  console.log("Connected to server with ID:", socket.id);
});

socket.on("disconnect", () =>
{
  console.log("Disonnected from server");
});

socket.on("playersUpdate", (players) =>
{
  console.log("Players Updated:", players);
});

const otherPlayers = {};

//Im not positive the code below this works, just through some research I think this should handle the basic positioning of players using camera position/broadcast
socket.on("playersUpdate", (players) => {
  for (const id in players) {
    if (id === socket.id) continue; 

    const pos = players[id];

    if (!otherPlayers[id]) {
      // Create a new mesh for this user
      otherPlayers[id] = BABYLON.MeshBuilder.CreateBox(`player-${id}`, { size: 0.5 }, scene);
      otherPlayers[id].material = new BABYLON.StandardMaterial(`mat-${id}`, scene);
      otherPlayers[id].material.diffuseColor = new BABYLON.Color3(Math.ran
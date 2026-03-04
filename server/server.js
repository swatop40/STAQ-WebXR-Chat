import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = http.createServer(app); 

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const players = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.emit("playersUpdate", players);
  socket.on("updatePosition", (pos) => {
    players[socket.id] = pos;
    io.emit("playersUpdate", players);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete players[socket.id];
    i
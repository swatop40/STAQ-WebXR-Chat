import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const players = new Map();

function makeSpawn() {
  return { x: (Math.random() - 0.5) * 2, y: 1.6, z: (Math.random() - 0.5) * 2 };
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  players.set(socket.id, {
    id: socket.id,
    name: "Player",
    pos: makeSpawn(),
    rotY: 0,
    room: "lobby",
  });

  socket.emit("init", {
    selfId: socket.id,
    players: Object.fromEntries(players),
  });

  socket.broadcast.emit("playerJoined", players.get(socket.id));

  socket.on("pose", (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;

    if (typeof data.name === "string" && data.name.trim()) {
      p.name = data.name.trim().slice(0, 20);
    }


    if (data.pos && typeof data.pos.x === "number") {
      p.pos = {
        x: data.pos.x,
        y: data.pos.y,
        z: data.pos.z,
      };
    }
    if (typeof data.rotY === "number") {
      p.rotY = data.rotY;
    }
  });

//WEBRTC SIGNALING

// When a player sends a WebRTC offer
  socket.on("webrtc-offer", ({ targetId, offer }) => {
    io.to(targetId).emit("webrtc-offer", {
    fromId: socket.id,
    offer,
  });
});

// When a player sends an answer
  socket.on("webrtc-answer", ({ targetId, answer }) => {
    io.to(targetId).emit("webrtc-answer", {
    fromId: socket.id,
    answer,
  });
});

// ICE candidate exchange
  socket.on("webrtc-ice-candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("webrtc-ice-candidate", {
    fromId: socket.id,
    candidate,
  });
});

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    players.delete(socket.id);
    io.emit("playerLeft", socket.id);
  });
});

const TICK_HZ = 15;
setInterval(() => {
  io.emit("playersUpdate", Object.fromEntries(players));
}, 1000 / TICK_HZ);

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
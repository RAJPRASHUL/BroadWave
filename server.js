// server.js
const WebSocket = require("ws");

function findClientByName(name, clients) {
  const target = (name || "").toLowerCase();
  for (const c of clients) {
    if ((c.userName || "").toLowerCase() === target) {
      return c;
    }
  }
  return null;
}

function isNameTaken(name, clients) {
  const target = (name || "").toLowerCase();
  for (const c of clients) {
    if ((c.userName || "").toLowerCase() === target) {
      return true;
    }
  }
  return false;
}

function startServer(port = 8080) {
  const wss = new WebSocket.Server({ port });

  const clients = new Set();

  // rooms: roomName -> Set<WebSocket>
  const rooms = new Map();
  // histories: roomName -> [messages...]
  const roomHistories = new Map();
  const MAX_HISTORY = 50;

  const COLOR_COUNT = 10;

  function ensureRoom(name) {
    const roomName = name || "lobby";
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Set());
    }
    return rooms.get(roomName);
  }

  function getRoomHistory(name) {
    const roomName = name || "lobby";
    if (!roomHistories.has(roomName)) {
      roomHistories.set(roomName, []);
    }
    return roomHistories.get(roomName);
  }

  function broadcastToRoom(roomName, packet, excludeWs = null) {
    const room = rooms.get(roomName);
    if (!room) return;
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
        try {
          client.send(packet);
        } catch (e) {
          console.error("Broadcast error:", e.message);
        }
      }
    }
  }

  function getUniqueColorIndex() {
    const used = new Set();
    for (const c of clients) {
      if (typeof c.colorIndex === "number") {
        used.add(c.colorIndex % COLOR_COUNT);
      }
    }
    for (let i = 0; i < COLOR_COUNT; i++) {
      if (!used.has(i)) return i;
    }
    return Math.floor(Math.random() * COLOR_COUNT);
  }

  function switchRoom(ws, newRoomRaw) {
    const oldRoom = ws.roomName || "lobby";
    const newRoom = (newRoomRaw || "lobby").trim() || "lobby";

    if (oldRoom === newRoom) {
      // already there
      try {
        ws.send(
          JSON.stringify({
            type: "system",
            text: `You are already in room "${newRoom}".`,
          })
        );
      } catch {}
      return;
    }

    // remove from old room
    const oldSet = rooms.get(oldRoom);
    if (oldSet) {
      oldSet.delete(ws);
    }

    // add to new room
    const newSet = ensureRoom(newRoom);
    newSet.add(ws);
    ws.roomName = newRoom;

    // notify self
    try {
      ws.send(
        JSON.stringify({
          type: "system",
          text: `You joined room "${newRoom}".`,
        })
      );
    } catch {}

    // send new room history
    const history = getRoomHistory(newRoom);
    try {
      ws.send(
        JSON.stringify({
          type: "history",
          messages: history,
        })
      );
    } catch {}

    // notify others
    const leftPacket = JSON.stringify({
      type: "system",
      text: `${ws.userName} left room "${oldRoom}".`,
    });
    const joinPacket = JSON.stringify({
      type: "system",
      text: `${ws.userName} joined room "${newRoom}".`,
    });

    broadcastToRoom(oldRoom, leftPacket, ws);
    broadcastToRoom(newRoom, joinPacket, ws);

    console.log(`${ws.userName} moved ${oldRoom} -> ${newRoom}`);
  }

  console.log(`Starting WebSocket server on ws://localhost:${port}`);
  wss.on("listening", () => console.log("Server is listening..."));

  wss.on("connection", (ws) => {
    ws.userName = "Anonymous";
    ws.colorIndex = 0;
    ws.roomName = "lobby"; // default room

    clients.add(ws);
    ensureRoom("lobby").add(ws);

    console.log("Client connected. Total:", clients.size);

    ws.on("message", (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }

      // -------- JOIN (initial handshake) --------
      if (payload.type === "join") {
        ws.userName = (payload.user || "Anonymous").toString().trim();
        ws.colorIndex = getUniqueColorIndex();

        console.log(
          `User joined: ${ws.userName} (colorIndex=${ws.colorIndex}, room=${ws.roomName})`
        );

        // send color info
        try {
          ws.send(
            JSON.stringify({
              type: "join_ack",
              user: ws.userName,
              colorIndex: ws.colorIndex,
            })
          );
        } catch {}

        // send history of current room (lobby at start)
        const history = getRoomHistory(ws.roomName);
        try {
          ws.send(
            JSON.stringify({
              type: "history",
              messages: history,
            })
          );
        } catch {}

        // welcome message (to this user only)
        try {
          ws.send(
            JSON.stringify({
              type: "system",
              text: `Welcome, ${ws.userName}! You are in room "${ws.roomName}".`,
            })
          );
        } catch {}

        // notify others in room
        const joinPacket = JSON.stringify({
          type: "system",
          text: `${ws.userName} joined room "${ws.roomName}".`,
        });
        broadcastToRoom(ws.roomName, joinPacket, ws);

        return;
      }

      // -------- JOIN ROOM (via /join room) --------
      if (payload.type === "join_room") {
        const room = (payload.room || "").toString().trim();
        if (!room) {
          try {
            ws.send(
              JSON.stringify({
                type: "system",
                text: "Usage: /join roomName",
              })
            );
          } catch {}
          return;
        }
        switchRoom(ws, room);
        return;
      }

      // -------- LIST USERS (in current room) --------
      if (payload.type === "users") {
        const userList = [];
        const roomSet = rooms.get(ws.roomName || "lobby");
        if (roomSet) {
          for (const client of roomSet) {
            if (client.userName) userList.push(client.userName);
          }
        }

        try {
          ws.send(
            JSON.stringify({
              type: "users",
              users: userList,
            })
          );
        } catch {}

        return;
      }

      // -------- PUBLIC MESSAGE (also handles /nick) --------
      if (payload.type === "message") {
        const text = (payload.text || "").toString().trim();

        // /nick command
        if (text.startsWith("/nick ")) {
          const newName = text.replace("/nick", "").trim();

          if (!newName) {
            try {
              ws.send(
                JSON.stringify({
                  type: "system",
                  text: "Usage: /nick NewName",
                })
              );
            } catch {}
            return;
          }

          if (isNameTaken(newName, clients)) {
            try {
              ws.send(
                JSON.stringify({
                  type: "system",
                  text: `Username "${newName}" is already taken.`,
                })
              );
            } catch {}
            return;
          }

          const oldName = ws.userName;
          ws.userName = newName;

          const systemMsg = {
            type: "system",
            text: `${oldName} changed name to ${newName}`,
          };
          const packet = JSON.stringify(systemMsg);

          // broadcast to the room
          broadcastToRoom(ws.roomName || "lobby", packet);

          console.log(`${oldName} -> ${newName}`);
          return;
        }

        // normal chat message (room-scoped)
        const roomName = ws.roomName || "lobby";
        const msg = {
          type: "message",
          user: ws.userName || "Anonymous",
          text,
          time: Date.now(),
          colorIndex: ws.colorIndex || 0,
          room: roomName,
        };

        const history = getRoomHistory(roomName);
        history.push(msg);
        if (history.length > MAX_HISTORY) history.shift();

        const packet = JSON.stringify(msg);

        broadcastToRoom(roomName, packet, ws);

        console.log(`[${roomName}] [${msg.user}] ${msg.text}`);
        return;
      }

      // -------- PRIVATE MESSAGE (cross-room) --------
      if (payload.type === "private") {
        const target = findClientByName(payload.to, clients);
        if (!target || target.readyState !== WebSocket.OPEN) {
          try {
            ws.send(
              JSON.stringify({
                type: "system",
                text: `User "${payload.to}" not online`,
              })
            );
          } catch {}
          return;
        }

        const pm = {
          type: "private",
          from: ws.userName || "Anonymous",
          to: target.userName,
          text: (payload.text || "").toString(),
          time: Date.now(),
          colorIndex: ws.colorIndex || 0,
        };

        try {
          target.send(JSON.stringify(pm));
        } catch (e) {
          console.error("PM send error", e.message);
        }

        console.log(
          `PM ${pm.from} -> ${pm.to} (rooms ${ws.roomName} -> ${target.roomName}): ${pm.text}`
        );
        return;
      }

      // -------- TYPING / STOP_TYPING (room-scoped) --------
      if (payload.type === "typing" || payload.type === "stop_typing") {
        const roomName = ws.roomName || "lobby";

        const packet = JSON.stringify({
          type: payload.type,
          user: ws.userName || "Anonymous",
          room: roomName,
        });

        broadcastToRoom(roomName, packet, ws);
        return;
      }
    });

    ws.on("close", () => {
      const roomName = ws.roomName || "lobby";
      const roomSet = rooms.get(roomName);
      if (roomSet) roomSet.delete(ws);

      clients.delete(ws);
      console.log("Client disconnected. Total:", clients.size);
    });

    ws.on("error", (err) => console.error("Client error:", err.message));
  });

  wss.on("error", (err) => console.error("Server error:", err.message));

  process.on("SIGINT", () => {
    console.log("\nShutting down server...");
    for (const client of clients) {
      try {
        client.close();
      } catch {}
    }
    wss.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
  });
}

module.exports = { startServer };

if (require.main === module) startServer(8080);

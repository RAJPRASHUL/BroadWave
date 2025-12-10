require("dotenv").config();

const WebSocket = require("ws");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/broadwave";
const PORT = Number(process.env.PORT) || 8080;
const MAX_HISTORY = Number(process.env.MAX_HISTORY) || 200;
const COLOR_COUNT = 10;


let mongoClient = null;
let messagesColl = null;

async function connectMongo(uri) {
  if (mongoClient) return mongoClient;

  mongoClient = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    connectTimeoutMS: 10000,
  });

  await mongoClient.connect();
  const db = mongoClient.db();
  messagesColl = db.collection("messages");
  await messagesColl.createIndex({ room: 1, time: -1 });
  return mongoClient;
}

async function getRoomHistory(room, limit = MAX_HISTORY) {
  if (!messagesColl) return [];
  const cursor = messagesColl.find({ room }).sort({ time: -1 }).limit(limit);
  const rows = await cursor.toArray();
  return rows.reverse().map((r) => ({
    type: "message",
    room: r.room,
    user: r.user,
    text: r.text,
    time: r.time,
    colorIndex: r.colorIndex,
  }));
}

async function saveMessageToDb(msg) {
  if (!messagesColl) return;
  try {
    await messagesColl.insertOne({
      room: msg.room,
      user: msg.user,
      text: msg.text,
      time: msg.time,
      colorIndex: msg.colorIndex,
    });
  } catch (e) {
    console.error("Mongo insert error:", e.message);
  }
}

function findClientByName(name, clients) {
  const n = (name || "").toLowerCase();
  for (const c of clients) {
    if ((c.userName || "").toLowerCase() === n) return c;
  }
  return null;
}

function isNameTaken(name, clients) {
  const n = (name || "").toLowerCase();
  for (const c of clients) {
    if ((c.userName || "").toLowerCase() === n) return true;
  }
  return false;
}


async function startServer(port = PORT) {

  try {
    await connectMongo(MONGO_URI);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err && err.message);
    process.exit(1);
  }

  const wss = new WebSocket.Server({ port });
  const clients = new Set();
  const rooms = new Map(); 

  function ensureRoom(room) {
    if (!rooms.has(room)) rooms.set(room, new Set());
    return rooms.get(room);
  }

  function broadcast(room, packet, exclude = null) {
    const r = rooms.get(room);
    if (!r) return;
    for (const client of r) {
      if (client.readyState === WebSocket.OPEN && client !== exclude) {
        try {
          client.send(packet);
        } catch {}
      }
    }
  }

  function assignColor() {
    const used = new Set([...clients].map((c) => c.colorIndex));
    for (let i = 0; i < COLOR_COUNT; i++) {
      if (!used.has(i)) return i;
    }
    return Math.floor(Math.random() * COLOR_COUNT);
  }

  function getActiveRoomCount() {
    let count = 0;
    for (const [, set] of rooms) if (set.size > 0) count++;
    return count;
  }
  function logStats() {
    console.log(`Stats: clients=${clients.size}, rooms=${getActiveRoomCount()}`);
  }

  console.log(` WebSocket server running at ws://localhost:${port}`);

  wss.on("connection", (ws) => {
    ws.userName = "Anonymous";
    ws.colorIndex = assignColor();
    ws.room = "lobby";

    clients.add(ws);
    ensureRoom("lobby").add(ws);
    logStats();

    ws.on("message", async (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }

     
      if (payload.type === "join") {
        ws.userName = (payload.user || "Anonymous").toString().trim();

        try { ws.send(JSON.stringify({ type: "join_ack", colorIndex: ws.colorIndex })); } catch {}
        try {
          const history = await getRoomHistory(ws.room);
          ws.send(JSON.stringify({ type: "history", messages: history }));
        } catch {}

        broadcast(ws.room, JSON.stringify({ type: "system", text: `${ws.userName} joined room "${ws.room}".` }), ws);
        return;
      }


      if (payload.type === "nick") {
        const newName = (payload.name || "").toString().trim();
        if (!newName) {
          try { ws.send(JSON.stringify({ type: "system", text: "Usage: /nick NewName" })); } catch {}
          return;
        }
        if (isNameTaken(newName, clients)) {
          try { ws.send(JSON.stringify({ type: "system", text: `Nickname "${newName}" is already taken.` })); } catch {}
          return;
        }
        const old = ws.userName;
        ws.userName = newName;
        broadcast(ws.room, JSON.stringify({ type: "system", text: `${old} changed name to ${newName}` }));
        return;
      }

      if (payload.type === "join_room") {
        const newRoomRaw = payload.room || "";
        const newRoom = newRoomRaw.toString().trim();
        if (!newRoom) {
          try { ws.send(JSON.stringify({ type: "system", text: "Usage: /join roomName" })); } catch {}
          return;
        }

        const oldRoom = ws.room;
        const oldSet = rooms.get(oldRoom);
        if (oldSet) oldSet.delete(ws);

        broadcast(oldRoom, JSON.stringify({ type: "system", text: `${ws.userName} left room "${oldRoom}".` }), ws);

        ws.room = newRoom;
        ensureRoom(newRoom).add(ws);

        try {
          const history = await getRoomHistory(newRoom);
          ws.send(JSON.stringify({ type: "history", messages: history }));
        } catch {}

        broadcast(newRoom, JSON.stringify({ type: "system", text: `${ws.userName} joined room "${newRoom}".` }), ws);
        logStats();
        return;
      }

  
      if (payload.type === "users") {
        const list = [];
        const set = rooms.get(ws.room);
        if (set) for (const c of set) if (c.userName) list.push(c.userName);
        try { ws.send(JSON.stringify({ type: "users", users: list })); } catch {}
        return;
      }

      
      if (payload.type === "message") {
        const text = (payload.text || "").toString().trim();
        if (!text) return;

      
        if (text.startsWith("/nick ")) {
          const newName = text.replace("/nick", "").trim();
          if (!newName) {
            try { ws.send(JSON.stringify({ type: "system", text: "Usage: /nick NewName" })); } catch {}
            return;
          }
          if (isNameTaken(newName, clients)) {
            try { ws.send(JSON.stringify({ type: "system", text: `Nickname "${newName}" is already taken.` })); } catch {}
            return;
          }
          const old = ws.userName;
          ws.userName = newName;
          broadcast(ws.room, JSON.stringify({ type: "system", text: `${old} changed name to ${newName}` }));
          return;
        }

        
        const msg = {
          type: "message",
          room: ws.room,
          user: ws.userName,
          text,
          time: Date.now(),
          colorIndex: ws.colorIndex,
        };

        
        saveMessageToDb(msg).catch((e) => console.error("save err:", e && e.message));
        broadcast(ws.room, JSON.stringify(msg), ws);
        return;
      }

      
      if (payload.type === "private") {
        const target = findClientByName(payload.to, clients);
        if (!target) {
          try { ws.send(JSON.stringify({ type: "system", text: `User "${payload.to}" not online` })); } catch {}
          return;
        }

        const pm = {
          type: "private",
          from: ws.userName,
          to: target.userName,
          text: (payload.text || "").toString(),
          time: Date.now(),
          colorIndex: ws.colorIndex,
        };

        try { target.send(JSON.stringify(pm)); } catch {}
        return;
      }

      
      if (payload.type === "typing" || payload.type === "stop_typing") {
        broadcast(ws.room, JSON.stringify({ type: payload.type, user: ws.userName }), ws);
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      const r = rooms.get(ws.room);
      if (r) r.delete(ws);
      logStats();
    });

    ws.on("error", () => {});
  });

  wss.on("error", (err) => {
    console.error("Server error:", err && err.message);
  });
}


module.exports = { startServer };
if (require.main === module) {
  startServer().catch((e) => {
    console.error("Failed to start server:", e && e.message);
    process.exit(1);
  });
}

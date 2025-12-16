require("dotenv").config();

const WebSocket = require("ws");
const { MongoClient } = require("mongodb");
const crypto = require("crypto");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/broadwave";
const PORT = Number(process.env.PORT) || 8080;
const MAX_HISTORY = Number(process.env.MAX_HISTORY) || 200;
const COLOR_COUNT = 10;
const MAX_NICK_CHANGES = 3;

let mongoClient = null;
let messagesColl = null;
let usersColl = null;

async function connectMongo(uri) {
  if (mongoClient) return mongoClient;
  mongoClient = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0, connectTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db();
  messagesColl = db.collection("messages");
  usersColl = db.collection("users");
  await messagesColl.createIndex({ room: 1, time: -1 });
  await usersColl.createIndex({ username: 1 }, { unique: true });
  return mongoClient;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function getRoomHistory(room, limit = MAX_HISTORY) {
  if (!messagesColl) return [];
  const cursor = messagesColl.find({ room }).sort({ time: -1 }).limit(limit);
  const rows = await cursor.toArray();
  return rows.reverse().map((r) => ({
    type: "message",
    room: r.room,
    username: r.username,
    text: r.text,
    timestamp: r.time,
    colorIndex: r.colorIndex,
  }));
}

async function saveMessageToDb(msg) {
  if (!messagesColl) return;
  try {
    await messagesColl.insertOne({
      room: msg.room,
      username: msg.username,
      text: msg.text,
      time: msg.time,
      colorIndex: msg.colorIndex,
    });
  } catch (e) {
    console.error("Mongo insert error:", e.message);
  }
}

function isUserOnline(name, clients) {
  const n = (name || "").toLowerCase();
  for (const c of clients) {
    if ((c.userName || "").toLowerCase() === n && c.authenticated) return true;
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
      if (client.readyState === WebSocket.OPEN && client !== exclude && client.authenticated) {
        try { client.send(packet); } catch {}
      }
    }
  }

  console.log(`WebSocket server running at ws://localhost:${port}`);

  wss.on("connection", (ws) => {
    ws.authenticated = false;
    ws.userName = null;
    ws.colorIndex = null;
    ws.room = "lobby";
    ws.nickChangeCount = 0;

    clients.add(ws);

    ws.on("message", async (data) => {
      let payload;
      try { payload = JSON.parse(data.toString()); } catch { return; }

 
      if (payload.type === "register") {
        const username = (payload.username || "").toString().trim();
        const password = (payload.password || "").toString();

        if (!username || !password || username.length < 3 || password.length < 4) {
          try { ws.send(JSON.stringify({ type: "auth_error", message: "Invalid username or password" })); } catch {}
          return;
        }

        if (isUserOnline(username, clients)) {
          try { ws.send(JSON.stringify({ type: "auth_error", message: "User already online" })); } catch {}
          return;
        }

        try {
          await usersColl.insertOne({
            username: username,
            password: hashPassword(password),
            colorIndex: Math.floor(Math.random() * COLOR_COUNT),
            nickChangeCount: 0
          });

          const user = await usersColl.findOne({ username: username });
          ws.authenticated = true;
          ws.userName = username;
          ws.colorIndex = user.colorIndex;
          ws.nickChangeCount = user.nickChangeCount;

          ensureRoom("lobby").add(ws);

          ws.send(JSON.stringify({ type: "auth_success", username: username, colorIndex: ws.colorIndex }));
          const history = await getRoomHistory("lobby");
          ws.send(JSON.stringify({ type: "history", messages: history }));
          broadcast("lobby", JSON.stringify({ type: "system", text: `${username} joined` }), ws);
        } catch (err) {
          ws.send(JSON.stringify({ type: "auth_error", message: "Username already exists" }));
        }
        return;
      }

      
      if (payload.type === "login") {
        const username = (payload.username || "").toString().trim();
        const password = (payload.password || "").toString();

        if (!username || !password) {
          try { ws.send(JSON.stringify({ type: "auth_error", message: "Username and password required" })); } catch {}
          return;
        }

        if (isUserOnline(username, clients)) {
          try { ws.send(JSON.stringify({ type: "auth_error", message: "User already online" })); } catch {}
          return;
        }

        const user = await usersColl.findOne({ username: username });
        if (!user || user.password !== hashPassword(password)) {
          try { ws.send(JSON.stringify({ type: "auth_error", message: "Invalid username or password" })); } catch {}
          return;
        }

        ws.authenticated = true;
        ws.userName = username;
        ws.colorIndex = user.colorIndex;
        ws.nickChangeCount = user.nickChangeCount || 0;

        ensureRoom("lobby").add(ws);

        ws.send(JSON.stringify({ type: "auth_success", username: username, colorIndex: ws.colorIndex }));
        const history = await getRoomHistory("lobby");
        ws.send(JSON.stringify({ type: "history", messages: history }));
        broadcast("lobby", JSON.stringify({ type: "system", text: `${username} joined` }), ws);
        return;
      }

      if (!ws.authenticated) {
        try { ws.send(JSON.stringify({ type: "error", message: "Not authenticated" })); } catch {}
        return;
      }

     
      if (payload.type === "join") {
        const newRoom = (payload.room || "lobby").toString().trim();
        const oldRoom = ws.room;
        const oldSet = rooms.get(oldRoom);
        if (oldSet) oldSet.delete(ws);

        if (oldRoom !== newRoom) {
          broadcast(oldRoom, JSON.stringify({ type: "system", text: `${ws.userName} left` }), ws);
        }

        ws.room = newRoom;
        ensureRoom(newRoom).add(ws);

        ws.send(JSON.stringify({ type: "join_ack", colorIndex: ws.colorIndex, username: ws.userName }));
        const history = await getRoomHistory(newRoom);
        ws.send(JSON.stringify({ type: "history", messages: history }));
        broadcast(newRoom, JSON.stringify({ type: "system", text: `${ws.userName} joined` }), ws);
        return;
      }

      if (payload.type === "nick") {
        const newName = (payload.username || payload.name || "").toString().trim();

        if (!newName || newName.length < 3) {
          try { ws.send(JSON.stringify({ type: "error", message: "Invalid username" })); } catch {}
          return;
        }

        if (ws.nickChangeCount >= MAX_NICK_CHANGES) {
          try { ws.send(JSON.stringify({ type: "error", message: `Max ${MAX_NICK_CHANGES} changes reached` })); } catch {}
          return;
        }

        const existing = await usersColl.findOne({ username: newName });
        if (existing || isUserOnline(newName, clients)) {
          try { ws.send(JSON.stringify({ type: "error", message: "Username taken" })); } catch {}
          return;
        }

        const old = ws.userName;
        ws.nickChangeCount++;

        await usersColl.updateOne({ username: old }, { $set: { username: newName, nickChangeCount: ws.nickChangeCount } });
        ws.userName = newName;

        ws.send(JSON.stringify({ type: "info", message: `Changed to ${newName}. ${MAX_NICK_CHANGES - ws.nickChangeCount} left` }));
        broadcast(ws.room, JSON.stringify({ type: "system", text: `${old} → ${newName}` }));
        return;
      }

   
      if (payload.type === "users") {
        const list = [];
        const set = rooms.get(ws.room);
        if (set) {
          for (const c of set) {
            if (c.userName && c.authenticated) {
              list.push({ username: c.userName, colorIndex: c.colorIndex });
            }
          }
        }
        ws.send(JSON.stringify({ type: "users", users: list }));
        return;
      }

    
      if (payload.type === "message") {
        const text = (payload.text || "").toString().trim();
        if (!text) return;

        const msg = {
          type: "message",
          room: ws.room,
          username: ws.userName,
          text,
          timestamp: Date.now(),
          colorIndex: ws.colorIndex,
        };

        saveMessageToDb(msg);
        broadcast(ws.room, JSON.stringify(msg), ws);
        return;
      }

      
      if (payload.type === "private") {
        const targetName = (payload.to || "").toLowerCase();
        let target = null;
        for (const c of clients) {
          if ((c.userName || "").toLowerCase() === targetName && c.authenticated) {
            target = c;
            break;
          }
        }

        if (!target) {
          ws.send(JSON.stringify({ type: "system", text: `User "${payload.to}" not online` }));
          return;
        }

        target.send(JSON.stringify({
          type: "private",
          from: ws.userName,
          text: (payload.text || "").toString(),
          timestamp: Date.now(),
          colorIndex: ws.colorIndex,
        }));
        return;
      }

      if (payload.type === "typing" || payload.type === "stop_typing") {
        broadcast(ws.room, JSON.stringify({ type: payload.type, username: ws.userName }), ws);
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      const r = rooms.get(ws.room);
      if (r) r.delete(ws);
      if (ws.authenticated && ws.userName) {
        broadcast(ws.room, JSON.stringify({ type: "system", text: `${ws.userName} left` }));
      }
    });

    ws.on("error", () => {});
  });
}

module.exports = { startServer };
if (require.main === module) {
  startServer().catch((e) => {
    console.error("Failed to start server:", e && e.message);
    process.exit(1);
  });
}
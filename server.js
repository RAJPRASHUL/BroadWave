require("dotenv").config();

const WebSocket = require("ws");
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/broadwave";
const PORT = Number(process.env.PORT) || 8080;
const MAX_HISTORY = Number(process.env.MAX_HISTORY) || 200;
const COLOR_COUNT = 10;
const MAX_NICK_CHANGES = 3; 

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

  console.log(`WebSocket server running at ws://localhost:${port}`);

  wss.on("connection", (ws) => {
    ws.userName = "Anonymous";
    ws.colorIndex = assignColor();
    ws.room = "lobby";
    ws.nickChangeCount = 0; 

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

    
      if (payload.type === "identify") {
      
        if (ws.userName === "Anonymous") {
          const newName = (payload.username || "Anonymous").toString().trim();
          ws.userName = newName;
          console.log(`Client identified as: ${ws.userName}`);
        } else {
          console.log(`Client tried to re-identify, but already set as: ${ws.userName}`);
        }
        return;
      }

   
      if (payload.type === "join") {
        const newRoomRaw = payload.room || "lobby";
        const newRoom = newRoomRaw.toString().trim();

  

        const oldRoom = ws.room;
        const oldSet = rooms.get(oldRoom);
        if (oldSet) oldSet.delete(ws);

        if (oldRoom !== newRoom) {
          broadcast(oldRoom, JSON.stringify({ 
            type: "system", 
            text: `${ws.userName} left room "${oldRoom}".` 
          }), ws);
        }

        ws.room = newRoom;
        ensureRoom(newRoom).add(ws);

       
        try {
          ws.send(JSON.stringify({ 
            type: "join_ack", 
            colorIndex: ws.colorIndex,
            username: ws.userName
          }));
        } catch {}

    
        try {
          const history = await getRoomHistory(newRoom);
          ws.send(JSON.stringify({ type: "history", messages: history }));
        } catch {}

     
        broadcast(newRoom, JSON.stringify({ 
          type: "system", 
          text: `${ws.userName} joined room "${newRoom}".` 
        }), ws);

        logStats();
        return;
      }

      if (payload.type === "nick") {
        const newName = (payload.username || payload.name || "").toString().trim();
        
       
        if (!newName) {
          try { 
            ws.send(JSON.stringify({ 
              type: "error", 
              message: "Usage: /nick <newname>" 
            })); 
          } catch {}
          return;
        }
        
 
        if (ws.nickChangeCount >= MAX_NICK_CHANGES) {
          try { 
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `You have reached the maximum limit of ${MAX_NICK_CHANGES} nickname changes.` 
            })); 
          } catch {}
          return;
        }
        
      
        if (isNameTaken(newName, clients)) {
          try { 
            ws.send(JSON.stringify({ 
              type: "error", 
              message: `Nickname "${newName}" is already taken.` 
            })); 
          } catch {}
          return;
        }
        
      
        const old = ws.userName;
        ws.userName = newName;
        ws.nickChangeCount++;
        
        const changesLeft = MAX_NICK_CHANGES - ws.nickChangeCount;
        
   
        try { 
          ws.send(JSON.stringify({ 
            type: "info", 
            message: `You changed your name to "${newName}". ${changesLeft} change${changesLeft !== 1 ? 's' : ''} remaining.` 
          })); 
        } catch {}
        
       
        broadcast(ws.room, JSON.stringify({ 
          type: "system", 
          text: `${old} changed name to ${newName}` 
        }));
        return;
      }

    
      if (payload.type === "users") {
        const list = [];
        const set = rooms.get(ws.room);
        if (set) {
          for (const c of set) {
            if (c.userName) {
              list.push({
                username: c.userName,
                colorIndex: c.colorIndex
              });
            }
          }
        }
        try { 
          ws.send(JSON.stringify({ type: "users", users: list })); 
        } catch {}
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

     
        saveMessageToDb(msg).catch((e) => console.error("save err:", e && e.message));
        
     
        broadcast(ws.room, JSON.stringify(msg), ws);
        return;
      }

     
      if (payload.type === "private") {
        const target = findClientByName(payload.to, clients);
        if (!target) {
          try { 
            ws.send(JSON.stringify({ 
              type: "system", 
              text: `User "${payload.to}" not online` 
            })); 
          } catch {}
          return;
        }

        const pm = {
          type: "private",
          from: ws.userName,
          to: target.userName,
          text: (payload.text || "").toString(),
          timestamp: Date.now(),
          colorIndex: ws.colorIndex,
        };

        try { target.send(JSON.stringify(pm)); } catch {}
        return;
      }

    
      if (payload.type === "typing" || payload.type === "stop_typing") {
        broadcast(ws.room, JSON.stringify({ 
          type: payload.type, 
          username: ws.userName  
        }), ws);
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      const r = rooms.get(ws.room);
      if (r) r.delete(ws);
      broadcast(ws.room, JSON.stringify({ 
        type: "system", 
        text: `${ws.userName} left.` 
      }));
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
const WebSocket = require("ws");

function startServer(port = 8080) {
  const wss = new WebSocket.Server({ port });
  const clients = new Set();
  const messageHistory = [];
  const MAX_HISTORY = 50;

  const COLOR_COUNT = 10;

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

  console.log(`Starting WebSocket server on ws://localhost:${port}`);
  wss.on("listening", () => console.log("Server is listening..."));

  wss.on("connection", (ws) => {
    ws.userName = "Anonymous";
    ws.colorIndex = 0;
    clients.add(ws);
    console.log("Client connected. Total:", clients.size);

    ws.on("message", (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch (e) {
        return;
      }

      if (payload.type === "join") {
        ws.userName = (payload.user || "Anonymous").toString().trim();
        ws.colorIndex = getUniqueColorIndex();

        if (!ws.historySent) {
          try {
            ws.send(
              JSON.stringify({ type: "history", messages: messageHistory })
            );
          } catch (e) {}
          ws.historySent = true;
        }

        try {
          ws.send(
            JSON.stringify({
              type: "system",
              text: `Welcome, ${ws.userName}! You are connected.`,
            })
          );
        } catch (e) {}

        return;
      }

      if (payload.type === "message") {
        const text = (payload.text || "").toString();
        const msg = {
          type: "message",
          user: ws.userName || "Anonymous",
          text,
          time: Date.now(),
          colorIndex: ws.colorIndex || 0,
        };

        messageHistory.push(msg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

        const packet = JSON.stringify(msg);

        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            try {
              client.send(packet);
            } catch (err) {
              console.error("Send error", err.message);
            }
          }
        }

        console.log(`[${msg.user}] ${msg.text}`);
        return;
      }

      if (payload.type === "typing" || payload.type === "stop_typing") {
        const packet = JSON.stringify({
          type: payload.type,
          user: ws.userName || "Anonymous",
        });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            try {
              client.send(packet);
            } catch (e) {}
          }
        }
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log("Client disconnected. Total:", clients.size);
    });

    ws.on("error", (err) => console.error("Client error:", err.message));
  });

  wss.on("error", (err) => console.error("Server error:", err.message));

  process.on("SIGINT", () => {
    console.log("\nShutting down server...");
    for (const client of clients)
      try {
        client.close();
      } catch {}
    wss.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
  });
}

module.exports = { startServer };

if (require.main === module) startServer(8080);

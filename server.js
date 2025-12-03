const WebSocket = require("ws");

function startServer(port = 8080) {
  const wss = new WebSocket.Server({ port });
  const clients = new Set();
  const messageHistory = [];
  const MAX_HISTORY = 50;

  console.log(`Starting WebSocket server on ws://localhost:${port}`);
  wss.on("listening", () => {
    console.log("Server is now listening for connections...");
  });

  wss.on("connection", (ws) => {
    ws.userName = "Anonymous";
    clients.add(ws);
    console.log("Client connected. Total:", clients.size);

    ws.on("message", (data) => {
      const raw = data.toString();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        console.warn("Invalid JSON from client, ignoring:", raw);
        return;
      }

      if (payload.type === "join") {
        ws.userName = (payload.user || "Anonymous").toString().trim();
        console.log(`Client set username: ${ws.userName}`);

        try {
          ws.send(
            JSON.stringify({ type: "history", messages: messageHistory })
          );
        } catch (e) {}

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
        };

        messageHistory.push(msg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

        const packet = JSON.stringify(msg);

        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            try {
              client.send(packet);
            } catch (err) {
              console.error("Send error:", err.message);
            }
          }
        }

        console.log(`[${msg.user}] ${msg.text}`);
        return;
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log("Client disconnected. Total:", clients.size);
    });

    ws.on("error", (err) => {
      console.error("Client error:", err.message);
    });
  });

  wss.on("error", (err) => {
    console.error("Server error:", err.message);
  });

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

const WebSocket = require("ws");
const readline = require("readline");

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function startClient(port = 8080, host = "localhost") {
  const url = `ws://${host}:${port}`;
  console.log(`Connecting to server at ${url} ...`);

  const ws = new WebSocket(url);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  let userName = "Anonymous";

  ws.on("open", () => {
    rl.question("Enter your username: ", (answer) => {
      userName = (answer || "").trim() || "Anonymous";
      ws.send(JSON.stringify({ type: "join", user: userName }));

      console.log(
        `Hi ${userName}! Type messages and press Enter. Type /quit to exit.`
      );
      rl.prompt();

      rl.on("line", (line) => {
        const text = (line || "").trim();
        if (text === "") {
          rl.prompt();
          return;
        }
        if (text === "/quit") {
          rl.close();
          ws.close();
          return;
        }

        if (ws.readyState === WebSocket.OPEN) {
          const payload = { type: "message", text };
          ws.send(JSON.stringify(payload));

          const now = Date.now();
          process.stdout.write(`\n[${formatTime(now)}] ${userName}: ${text}\n`);
        } else {
          console.log("Not connected to server.");
        }
        rl.prompt();
      });
    });
  });

  ws.on("message", (data) => {
    const raw = data.toString();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      process.stdout.write(`\n[Raw] ${raw}\n`);
      rl.prompt();
      return;
    }

    if (payload.type === "history") {
      process.stdout.write("\n--- Chat History ---\n");
      for (const msg of payload.messages) {
        const time = msg.time ? formatTime(msg.time) : "";
        process.stdout.write(`[${time}] ${msg.user}: ${msg.text}\n`);
      }
      process.stdout.write("--------------------\n");
      rl.prompt();
      return;
    }

    if (payload.type === "system") {
      process.stdout.write(`\n[System] ${payload.text}\n`);
      rl.prompt();
      return;
    }

    if (payload.type === "message") {
      const time = payload.time ? formatTime(payload.time) : "";
      process.stdout.write(`\n[${time}] ${payload.user}: ${payload.text}\n`);
      rl.prompt();
      return;
    }

    process.stdout.write(`\n[Unknown] ${JSON.stringify(payload)}\n`);
    rl.prompt();
  });

  ws.on("close", () => {
    console.log("\nDisconnected from server.");
    rl.close();
  });

  ws.on("error", (err) => {
    console.error("Connection error:", err.message);
    rl.close();
  });

  return ws;
}

module.exports = { startClient };

if (require.main === module) startClient(8080, "localhost");

const WebSocket = require("ws");
const readline = require("readline");

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(false);

)
const COLORS = [
  "\x1b[31m",
  "\x1b[32m", 
  "\x1b[33m", 
  "\x1b[34m", 
  "\x1b[35m", 
  "\x1b[36m", 
  "\x1b[37m", 
  "\x1b[95m",
  "\x1b[94m",
  "\x1b[92m", 
];

const RESET = "\x1b[0m";
const BRIGHT = "\x1b[1m";
const DIM = "\x1b[2m";
const FG_GRAY = "\x1b[90m";
const FG_YELLOW = "\x1b[33m";
const FG_RED = "\x1b[31m";

const c = (text, code) => `${code}${text}${RESET}`;

function formatTime(ts) {
  return new Date(ts)
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    .toLowerCase();
}

function padUser(user, width = 12) {
  if (!user) user = "";
  return user.length > width ? user.slice(0, width) : user.padEnd(width, " ");
}

function formatIncomingMessage(time, user, text, colorIndex, isSelf) {
  const ts = c(`[${formatTime(time)}]`, FG_GRAY + DIM);
  const usernameField = padUser(user, 12);
  const color = COLORS[colorIndex % COLORS.length] || "\x1b[37m";

  if (isSelf) {
  
    const coloredUser = c(usernameField.trim(), BRIGHT + color);
    const coloredText = c(text, color);
    const content = `${coloredUser} : ${coloredText}`;
    const max = (process.stdout.columns || 80) - 2;
    if (content.length < max) return content.padStart(max);
    return content;
  } else {
    const coloredUser = c(usernameField.trim(), BRIGHT + color);
    const coloredText = c(text, color); 
    return `${ts}  ${coloredUser}: ${coloredText}`;
  }
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

  let myName = "Anonymous";

  let myColorIndex = 0;

  ws.on("open", () => {
    rl.question("Enter your username: ", (answer) => {
      myName = (answer || "").trim() || "Anonymous";
     
      ws.send(JSON.stringify({ type: "join", user: myName }));

      console.log(
        c(`Hi ${myName}! Type messages. Type /quit to exit.`, "\x1b[37m")
      );
      rl.prompt();

      rl.on("line", (line) => {
        const text = line.trim();
        if (!text) {
          rl.prompt();
          return;
        }
        if (text === "/quit") {
          rl.close();
          ws.close();
          return;
        }


        try {
          readline.moveCursor(process.stdout, 0, -1);
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        } catch (e) {}

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "message", text }));

          console.log(
            formatIncomingMessage(Date.now(), myName, text, myColorIndex, true)
          );
        } else {
          console.log(c("Not connected.", FG_RED));
        }
        rl.prompt();
      });
    });
  });

  ws.on("message", (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch (e) {
      console.log(c(`[Raw] ${data.toString()}`, FG_YELLOW));
      rl.prompt();
      return;
    }

    if (payload.type === "join_ack") {
      if (typeof payload.colorIndex === "number") {
        myColorIndex = payload.colorIndex;
      }
      return;
    }

    if (payload.type === "history") {
      console.log(c("--- Chat History ---", FG_GRAY + DIM));
      for (const m of payload.messages) {
        const isMe = m.user === myName;
        const ci = typeof m.colorIndex === "number" ? m.colorIndex : 0;
        console.log(formatIncomingMessage(m.time, m.user, m.text, ci, isMe));
      }
      console.log(c("--------------------", FG_GRAY + DIM));
      rl.prompt();
      return;
    }

    if (payload.type === "system") {
      console.log(c(`[System] ${payload.text}`, FG_YELLOW));
      rl.prompt();
      return;
    }

    if (payload.type === "message") {
      const isMe = payload.user === myName;
      const ci =
        typeof payload.colorIndex === "number" ? payload.colorIndex : 0;
      console.log(
        formatIncomingMessage(
          payload.time,
          payload.user,
          payload.text,
          ci,
          isMe
        )
      );
      rl.prompt();
      return;
    }

    rl.prompt();
  });

  ws.on("close", () => {
    console.log(c("Disconnected from server.", FG_RED));
    rl.close();
  });

  ws.on("error", (err) => {
    console.log(c(`Error: ${err.message}`, FG_RED));
    rl.close();
  });

  return ws;
}

module.exports = { startClient };

if (require.main === module) startClient(8080, "localhost");

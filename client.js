const WebSocket = require("ws");
const readline = require("readline");

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(false);

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
    return content.length < max ? content.padStart(max) : content;
  } else {
    const coloredUser = c(usernameField.trim(), BRIGHT + color);
    const coloredText = c(text, color);
    return `${ts}  ${coloredUser}: ${coloredText}`;
  }
}

function formatPrivateMessage(time, from, to, text, colorIndex, isSelf) {
  const ts = c(`[${formatTime(time)}]`, FG_GRAY + DIM);
  const color = COLORS[colorIndex % COLORS.length] || "\x1b[37m";
  const label = isSelf
    ? c(`[PM to ${to}]`, FG_GRAY + DIM)
    : c("[PM]", FG_GRAY + DIM);

  const fromColored = c(from, BRIGHT + color);
  const textColored = c(text, color);

  const line = `${ts} ${label} ${fromColored}: ${textColored}`;
  if (!isSelf) return line;

  const max = (process.stdout.columns || 80) - 2;
  return line.length < max ? line.padStart(max) : line;
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
        c(
          `Hi ${myName}! Type messages. Type /help for commands, /quit to exit.`,
          "\x1b[37m"
        )
      );
      rl.prompt();

      rl.on("line", (line) => {
        const text = line.trim();

        if (text === "/help") {
          console.log("Available commands:");
          console.log("- /help              Show this help");
          console.log("- /users             List online users");
          console.log("- /pm <user> <msg>   Send private message");
          console.log("- /quit              Exit chat");
          console.log("- (normal text)      Send public message");
          rl.prompt();
          return;
        }

        if (text === "/users") {
          ws.send(JSON.stringify({ type: "users" }));
          rl.prompt();
          return;
        }

        if (text.startsWith("/pm ")) {
          const parts = text.split(" ");
          if (parts.length < 3) {
            console.log("Usage: /pm username message");
            rl.prompt();
            return;
          }

          const to = parts[1];
          const msg = parts.slice(2).join(" ");

          ws.send(
            JSON.stringify({
              type: "private",
              to,
              text: msg,
            })
          );

          console.log(
            formatPrivateMessage(
              Date.now(),
              myName,
              to,
              msg,
              myColorIndex,
              true
            )
          );
          rl.prompt();
          return;
        }

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

    if (payload.type === "users") {
      console.log(c(`Online users (${payload.users.length}):`, FG_GRAY + DIM));
      for (const u of payload.users) {
        console.log(`- ${u}`);
      }
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

    if (payload.type === "private") {
      const ci =
        typeof payload.colorIndex === "number" ? payload.colorIndex : 0;
      console.log(
        formatPrivateMessage(
          payload.time,
          payload.from,
          payload.to,
          payload.text,
          ci,
          false
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

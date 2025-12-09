// client.js
const WebSocket = require("ws");
const readline = require("readline");

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true); // needed for keypress

// ANSI colors (must match server COLOR_COUNT = 10)
const COLORS = [
  "\x1b[31m", // red
  "\x1b[32m", // green
  "\x1b[33m", // yellow
  "\x1b[34m", // blue
  "\x1b[35m", // magenta
  "\x1b[36m", // cyan
  "\x1b[37m", // white
  "\x1b[95m", // bright magenta
  "\x1b[94m", // bright blue
  "\x1b[92m", // bright green
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

  let currentRoom = "lobby";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `[${currentRoom}] > `,
  });

  let myName = "Anonymous";
  let myColorIndex = 0; // will be set from join_ack

  // --- typing state (me -> server) ---
  let iAmTyping = false;
  let typingTimeout = null;

  function sendTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (iAmTyping) return;
    iAmTyping = true;
    ws.send(JSON.stringify({ type: "typing" }));
  }

  function sendStopTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!iAmTyping) return;
    iAmTyping = false;
    ws.send(JSON.stringify({ type: "stop_typing" }));
  }

  function resetTypingTimeout() {
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      sendStopTyping();
    }, 1500); // 1.5s of inactivity
  }

  // --- typing state (others -> display) ---
  const typingUsers = new Set();
  let typingLineVisible = false;

  function clearTypingLine() {
    if (!typingLineVisible) return;
    try {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    } catch {}
    typingLineVisible = false;
  }

  function renderTypingLine() {
    clearTypingLine();

    if (typingUsers.size === 0) {
      rl.prompt(true);
      return;
    }

    const names = Array.from(typingUsers);
    const msg =
      names.length === 1
        ? `${names[0]} is typing...`
        : `${names.join(", ")} are typing...`;

    console.log(c(msg, FG_GRAY + DIM));
    typingLineVisible = true;
    rl.prompt(true);
  }

  function updatePrompt() {
    rl.setPrompt(`[${currentRoom}] > `);
  }

  ws.on("open", () => {
    rl.question("Enter your username: ", (answer) => {
      myName = (answer || "").trim() || "Anonymous";

      ws.send(JSON.stringify({ type: "join", user: myName }));

      console.log(
        c(
          `Hi ${myName}! Type messages. Commands: /pm, /nick, /join, /quit`,
          "\x1b[37m"
        )
      );
      updatePrompt();
      rl.prompt();

      // keypress listener (after username)
      const onKeypress = (str, key) => {
        if (key && key.ctrl && key.name === "c") return;

        // Enter -> line submitted, stop typing
        if (key && key.name === "return") {
          sendStopTyping();
          if (typingTimeout) clearTimeout(typingTimeout);
          return;
        }

        // Any other key
        sendTyping();
        resetTypingTimeout();
      };

      process.stdin.on("keypress", onKeypress);

      rl.on("line", (line) => {
        const text = line.trim();

        sendStopTyping();
        if (typingTimeout) clearTimeout(typingTimeout);

        // ----- /pm -----
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
            formatPrivateMessage(Date.now(), myName, to, msg, myColorIndex, true)
          );
          rl.prompt();
          return;
        }

        // ----- /nick -----
        if (text.startsWith("/nick ")) {
          const newName = text.replace("/nick", "").trim();

          if (!newName) {
            console.log("Usage: /nick NewName");
            rl.prompt();
            return;
          }

          ws.send(
            JSON.stringify({
              type: "message",
              text,
            })
          );

          myName = newName;
          rl.prompt();
          return;
        }

        // ----- /join -----
        if (text.startsWith("/join ")) {
          const newRoom = text.replace("/join", "").trim();

          if (!newRoom) {
            console.log("Usage: /join roomName");
            rl.prompt();
            return;
          }

          ws.send(
            JSON.stringify({
              type: "join_room",
              room: newRoom,
            })
          );

          currentRoom = newRoom;
          updatePrompt();
          rl.prompt();
          return;
        }

        if (!text) {
          rl.prompt();
          return;
        }

        if (text === "/quit") {
          process.stdin.removeAllListeners("keypress");
          rl.close();
          ws.close();
          return;
        }

        // clear typed line before printing own formatted message
        try {
          readline.moveCursor(process.stdout, 0, -1);
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        } catch {}

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
    } catch {
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
      clearTypingLine();
      console.log(c(`[System] ${payload.text}`, FG_YELLOW));
      renderTypingLine();
      return;
    }

    if (payload.type === "message") {
      const isMe = payload.user === myName;
      const ci =
        typeof payload.colorIndex === "number" ? payload.colorIndex : 0;

      clearTypingLine();
      console.log(
        formatIncomingMessage(
          payload.time,
          payload.user,
          payload.text,
          ci,
          isMe
        )
      );
      renderTypingLine();
      return;
    }

    if (payload.type === "private") {
      const ci =
        typeof payload.colorIndex === "number" ? payload.colorIndex : 0;

      clearTypingLine();
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
      renderTypingLine();
      return;
    }

    // typing events from others (room-scoped by server)
    if (payload.type === "typing") {
      if (payload.user && payload.user !== myName) {
        typingUsers.add(payload.user);
        renderTypingLine();
      }
      return;
    }

    if (payload.type === "stop_typing") {
      if (payload.user && typingUsers.has(payload.user)) {
        typingUsers.delete(payload.user);
        renderTypingLine();
      }
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

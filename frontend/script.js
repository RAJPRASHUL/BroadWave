const WS_URL = "ws://localhost:9000";
let ws = null;

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("app");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const authBtn = document.getElementById("authBtn");
const errorEl = document.getElementById("error");

const messagesEl = document.getElementById("messages");
const usersEl = document.getElementById("users");
const userCountEl = document.getElementById("userCount");
const typingEl = document.getElementById("typing");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const roomEl = document.getElementById("room");
const meEl = document.getElementById("me");

let username = "";
let currentRoom = "lobby";
let typingTimer = null;
let isTyping = false;
let users = [];
let isLogin = true;

loginTab.onclick = () => {
  isLogin = true;
  loginTab.classList.add("active");
  registerTab.classList.remove("active");
  authBtn.textContent = "Login";
  errorEl.textContent = "";
};

registerTab.onclick = () => {
  isLogin = false;
  registerTab.classList.add("active");
  loginTab.classList.remove("active");
  authBtn.textContent = "Register";
  errorEl.textContent = "";
};

function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === "auth_success") {
      username = msg.username;
      meEl.textContent = `You: ${username}`;
      authScreen.style.display = "none";
      appScreen.style.display = "flex";
      inputEl.focus();
      requestUserList();
    } else if (msg.type === "auth_error") {
      errorEl.textContent = msg.message;
    } else if (msg.type === "history") {
      messagesEl.innerHTML = "";
      addSystem("--- Chat History ---");
      msg.messages.forEach(m => displayMessage(m, true));
      addSystem("--------------------");
    } else if (msg.type === "message" && msg.username !== username) {
      displayMessage(msg);
    } else if (msg.type === "private") {
      displayPrivateMessage(msg);
    } else if (msg.type === "typing" && msg.username !== username) {
      typingEl.textContent = `${msg.username} is typing...`;
    } else if (msg.type === "stop_typing") {
      typingEl.textContent = "";
    } else if (msg.type === "users") {
      updateUsers(msg.users);
    } else if (msg.type === "error") {
      addSystem(`Error: ${msg.message}`);
    } else if (msg.type === "info") {
      addSystem(msg.message);
    } else if (msg.type === "system") {
      addSystem(msg.text);
    }
  };

  ws.onerror = () => {
    errorEl.textContent = "Connection error";
  };

  ws.onclose = () => {
    if (appScreen.style.display !== "none") {
      addSystem("Disconnected");
    }
  };
}

authBtn.onclick = () => {
  const user = usernameInput.value.trim();
  const pass = passwordInput.value;

  if (!user || !pass) {
    errorEl.textContent = "Username and password required";
    return;
  }

  errorEl.textContent = "";
  ws.send(JSON.stringify({
    type: isLogin ? "login" : "register",
    username: user,
    password: pass
  }));
};

passwordInput.onkeypress = (e) => {
  if (e.key === "Enter") authBtn.click();
};

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  if (text.startsWith("/")) {
    handleCommand(text);
  } else {
    displayOwnMessage(text);
    ws.send(JSON.stringify({ type: "message", text: text }));
  }

  inputEl.value = "";
  stopTyping();
}

function handleCommand(cmd) {
  const parts = cmd.split(" ");
  const command = parts[0].toLowerCase();

  if (command === "/join" && parts[1]) {
    currentRoom = parts[1];
    roomEl.textContent = `Room: ${currentRoom}`;
    messagesEl.innerHTML = "";
    ws.send(JSON.stringify({ type: "join", room: currentRoom }));
    setTimeout(() => requestUserList(), 100);
  } else if (command === "/nick" && parts[1]) {
    ws.send(JSON.stringify({ type: "nick", username: parts[1] }));
    setTimeout(() => requestUserList(), 100);
  } else if (command === "/pm" && parts.length >= 3) {
    ws.send(JSON.stringify({ type: "private", to: parts[1], text: parts.slice(2).join(" ") }));
    addSystem(`PM to ${parts[1]}: ${parts.slice(2).join(" ")}`);
  } else if (command === "/users") {
    requestUserList();
  } else {
    addSystem(`Unknown command: ${command}`);
  }
}

function displayMessage(msg, isHistory = false) {
  const div = document.createElement("div");
  div.className = "msg";
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : "";
  const color = getUserColor(msg.colorIndex || 0);
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(msg.username)}</span>: ${escapeHtml(msg.text)}`;
  messagesEl.appendChild(div);
  if (!isHistory) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function displayOwnMessage(text) {
  const div = document.createElement("div");
  div.className = "msg self";
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const myUser = users.find(u => u.username === username);
  const color = getUserColor(myUser ? myUser.colorIndex : 0);
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(username)}</span>: ${escapeHtml(text)}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function displayPrivateMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg pm";
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const color = getUserColor(msg.colorIndex || 0);
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(msg.from)}</span> → You (private): ${escapeHtml(msg.text)}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateUsers(userList) {
  users = userList;
  usersEl.innerHTML = "";
  userCountEl.textContent = userList.length;
  document.querySelectorAll('style[data-user-style]').forEach(style => style.remove());

  userList.forEach((user, index) => {
    const li = document.createElement("li");
    const isYou = user.username === username;
    const color = getUserColor(user.colorIndex);

    li.style.color = color;
    li.textContent = `${user.username}${isYou ? ' (you)' : ''}`;
    if (isYou) li.classList.add("you");

    const style = document.createElement('style');
    style.setAttribute('data-user-style', '');
    style.textContent = `#users li:nth-child(${index + 1})::before { background: ${color}; }`;
    document.head.appendChild(style);

    usersEl.appendChild(li);
  });
}

function handleTyping() {
  if (!isTyping) {
    isTyping = true;
    ws.send(JSON.stringify({ type: "typing" }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => stopTyping(), 2000);
}

function stopTyping() {
  if (isTyping) {
    isTyping = false;
    ws.send(JSON.stringify({ type: "stop_typing" }));
  }
}

function requestUserList() {
  ws.send(JSON.stringify({ type: "users" }));
}

function getUserColor(colorIndex) {
  const colors = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6"];
  return colors[colorIndex % colors.length];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

sendBtn.onclick = sendMessage;
inputEl.onkeydown = (e) => {
  if (e.key === "Enter") sendMessage();
  else handleTyping();
};

connectWebSocket();
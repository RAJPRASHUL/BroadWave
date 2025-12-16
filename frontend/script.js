const WS_URL = "ws://localhost:9000";
const ws = new WebSocket(WS_URL);

const messagesEl = document.getElementById("messages");
const usersEl = document.getElementById("users");
const userCountEl = document.getElementById("userCount");
const typingEl = document.getElementById("typing");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const roomEl = document.getElementById("room");
const meEl = document.getElementById("me");

let username = prompt("Enter your username:") || "Anonymous";
let currentRoom = "lobby";
let typingTimer = null;
let isTyping = false;
let users = [];

meEl.textContent = `You: ${username}`;
roomEl.textContent = `Room: ${currentRoom}`;


ws.onopen = () => {
  console.log("Connected to WebSocket");
  console.log("Sending username:", username);
  

  ws.send(JSON.stringify({
    type: "identify",
    username: username
  }));
  
  
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "join",
      room: currentRoom,
      username: username  
    }));
    
   
    setTimeout(() => {
      requestUserList();
    }, 100);
  }, 100);
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log("Received message:", msg); 
  
  switch (msg.type) {
    case "history":
      displayHistory(msg.messages);
      break;
      
    case "message":
      console.log("Message from:", msg.username, "My username:", username);
    
      if (msg.username !== username && msg.user !== username) {
        displayMessage(msg);
      }
      break;
      
    case "private":
      displayPrivateMessage(msg);
      break;
      
    case "typing":
      if (msg.username !== username && msg.user !== username) {
        showTyping(msg.username || msg.user);
      }
      break;
      
    case "stop_typing":
      hideTyping();
      break;
      
    case "users":
      updateUsers(msg.users);
      break;
      
    case "error":
      addSystem(`Error: ${msg.message}`);
      break;
      
    case "info":
      addSystem(msg.message);
      break;
  }
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
  addSystem("Connection error. Retrying...");
};

ws.onclose = () => {
  console.log("Disconnected from WebSocket");
  addSystem("Disconnected. Refresh to reconnect.");
};


function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  if (text.startsWith("/")) {
    handleCommand(text);
  } else {
    console.log("Sending message as:", username);
    
   
    displayOwnMessage(text);
    
   
    ws.send(JSON.stringify({
      type: "message",
      username: username,
      text: text
    }));
  }

  inputEl.value = "";
  stopTyping();
}

function handleCommand(cmd) {
  const parts = cmd.split(" ");
  const command = parts[0].toLowerCase();

  switch(command) {
    case "/join":
      if (parts[1]) {
        currentRoom = parts[1];
        roomEl.textContent = `Room: ${currentRoom}`;
        messagesEl.innerHTML = "";
        
        ws.send(JSON.stringify({
          type: "join",
          room: currentRoom,
          username: username
        }));
        
        setTimeout(() => requestUserList(), 100);
      }
      break;
      
    case "/nick":
      if (parts[1]) {
        const oldUsername = username;
        username = parts[1];
        meEl.textContent = `You: ${username}`;
        
        ws.send(JSON.stringify({
          type: "nick",
          username: username
        }));
        
        addSystem(`You changed your name from ${oldUsername} to ${username}`);
        
    
        ws.send(JSON.stringify({
          type: "identify",
          username: username
        }));
        
        setTimeout(() => requestUserList(), 100);
      }
      break;
      
    case "/pm":
      if (parts.length >= 3) {
        const to = parts[1];
        const message = parts.slice(2).join(" ");
        
        ws.send(JSON.stringify({
          type: "private",
          to: to,
          text: message,
          username: username  
        }));
        
       
        addSystem(`PM to ${to}: ${message}`);
      }
      break;
      
    case "/users":
      requestUserList();
      break;
      
    default:
      addSystem(`Unknown command: ${command}`);
  }
}


function displayHistory(messages) {
  messagesEl.innerHTML = "";
  addSystem("--- Chat History ---");
  messages.forEach(msg => displayMessage(msg, true));
  addSystem("--------------------");
}


function displayMessage(msg, isHistory = false) {
  const div = document.createElement("div");
  div.className = "msg";
  
 
  let time = "";
  if (msg.timestamp) {
    const date = new Date(msg.timestamp);
    time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
  
  const displayUsername = msg.username || msg.user || msg.from || "Anonymous";
  const displayText = msg.text || msg.message || "";
  const colorIndex = msg.colorIndex !== undefined ? msg.colorIndex : (msg.color || 0);
  const color = getUserColor(colorIndex);
  
  console.log("Displaying message - Username:", displayUsername, "Text:", displayText);
  
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(displayUsername)}</span>: ${escapeHtml(displayText)}`;
  
  messagesEl.appendChild(div);
  
  if (!isHistory) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}


function displayOwnMessage(text) {
  const div = document.createElement("div");
  div.className = "msg self";
  
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const myUser = users.find(u => (u.username || u) === username);
  const colorIndex = myUser && typeof myUser === 'object' ? myUser.colorIndex : 0;
  const color = getUserColor(colorIndex);
  
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(username)}</span>: ${escapeHtml(text)}`;
  
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function displayPrivateMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg pm";
  
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const colorIndex = msg.colorIndex !== undefined ? msg.colorIndex : (msg.color || 0);
  const color = getUserColor(colorIndex);
  const fromUser = msg.from || msg.username || msg.user || "Unknown";
  
  div.innerHTML = `<span class="time">${time}</span> <span class="username" style="color:${color}">${escapeHtml(fromUser)}</span> → You (private): ${escapeHtml(msg.text)}`;
  
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
  console.log("Updating users list:", userList);
  users = userList;
  usersEl.innerHTML = "";
  userCountEl.textContent = userList.length;
  

  document.querySelectorAll('style[data-user-style]').forEach(style => style.remove());
  
  userList.forEach((user, index) => {
    const li = document.createElement("li");
    

    let userName, colorIndex;
    if (typeof user === 'object') {
      userName = user.username || user.user || user.name || "Anonymous";
      colorIndex = user.colorIndex !== undefined ? user.colorIndex : (user.color || 0);
    } else {
      userName = user;
      colorIndex = 0;
    }
    
    const isYou = userName === username;
    const color = getUserColor(colorIndex);
    
    li.style.color = color;
    li.textContent = `${userName}${isYou ? ' (you)' : ''}`;
    
    if (isYou) {
      li.classList.add("you");
    }
    
   
    const style = document.createElement('style');
    style.setAttribute('data-user-style', '');
    style.textContent = `#users li:nth-child(${index + 1})::before { background: ${color}; }`;
    document.head.appendChild(style);
    
    usersEl.appendChild(li);
  });
}

function showTyping(user) {
  typingEl.textContent = `${user} is typing...`;
}

function hideTyping() {
  typingEl.textContent = "";
}

function handleTyping() {
  if (!isTyping) {
    isTyping = true;
    ws.send(JSON.stringify({ 
      type: "typing",
      username: username  
    }));
  }
  
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    stopTyping();
  }, 2000);
}

function stopTyping() {
  if (isTyping) {
    isTyping = false;
    ws.send(JSON.stringify({ 
      type: "stop_typing",
      username: username 
    }));
  }
  clearTimeout(typingTimer);
}


function requestUserList() {
  ws.send(JSON.stringify({ 
    type: "users",
    username: username  
  }));
}


function getUserColor(colorIndex) {
  const colors = [
    "#ef4444", "#f97316", "#f59e0b", "#84cc16", 
    "#10b981", "#14b8a6", "#06b6d4", "#3b82f6", 
    "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
    "#ec4899", "#f43f5e"
  ];
  return colors[colorIndex % colors.length];
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


sendBtn.onclick = sendMessage;

inputEl.onkeydown = (e) => {
  if (e.key === "Enter") {
    sendMessage();
  } else {
    handleTyping();
  }
};


inputEl.focus();
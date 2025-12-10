# BroadWave — Real-Time Chat (WebSockets + MongoDB)

BroadWave is a multi-room real-time chat application built with Node.js WebSockets and MongoDB Atlas.  
It includes a terminal client with colors, typing indicators, private messages, and persistent room history.



## Features

- Real-time WebSocket messaging  
- Multiple chat rooms (`/join <room>`)  
- Persistent MongoDB Atlas message history  
- Username system + rename (`/nick <name>`)  
- Private messages (`/pm <user> <msg>`)  
- Typing indicators  
- List users in room (`/users`)  
- Help menu (`/help`)  
- Color-coded terminal interface  
- Minimal server logging (clients & rooms count)



## Project Structure

server.js WebSocket server + MongoDB
client.js Terminal chat client
index.js CLI (start/connect)
.env Environment variables
test-mongo.js DB connection tester
show-env.js Env debug tool




## Environment Variables

Create a `.env` file:

MONGO_URI=<your-mongodb-atlas-uri>
PORT=9000
MAX_HISTORY=200



## Installation & Usage

Install dependencies:

npm install



Start the server:

node index.js start --port=9000



Start a client:

node index.js connect --port=9000 --host=localhost




## Client Commands

/nick <name> Change username
/join <room> Switch or create a room
/pm <user> <msg> Private message
/users List users in the current room
/help Show help menu
/quit Exit chat



const WebSocket = require('ws');

function startServer(port = 8080) {
  const wss = new WebSocket.Server({ port });
  const clients = new Set();

  console.log(`Starting WebSocket server on ws://localhost:${port}`);
  wss.on('listening', () => {
    console.log('Server is now listening for connections...');
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Client connected. Total:', clients.size);

   
    ws.on('message', (data) => {
      const text = data.toString();
      console.log(`Received message: ${text}`);


      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(text);
          } catch (e) {
       
            console.error('Error sending to client:', e.message);
          }
        }
      }
    });


    ws.on('close', () => {
      clients.delete(ws);
      console.log('Client disconnected. Total:', clients.size);
    });

    ws.on('error', (err) => {
      console.error('Client error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('Server error:', err.message);
  });


  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    for (const client of clients) {
      try { client.close(); } catch {}
    }
    wss.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });
}

module.exports = { startServer };


if (require.main === module) startServer(8080);

const Websocket = require("ws");

function startClient(port = 8080, host = 'localhost') {
  const url = `ws://${host}:${port}`;
  console.log(`connecting to the server at ${url}...`);

  const ws = new Websocket(url);

  ws.on('open', () => {
    console.log("connected to the server");
  });

  ws.on('close', () => {
    console.log('Disconnected from server');
  });

  ws.on('error', (err) => {
    console.log('Connection error:', err.message);
  });
}

module.export = { startClient };

if (require.main === module) {
  startClient(9000, 'localhost');
}


const WebSocket = require('ws');
const readline = require('readline');

function startClient(port = 8080, host = 'localhost') {
  const url = `ws://${host}:${port}`;
  console.log(`Connecting to server at ${url} ...`);

  const ws = new WebSocket(url);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  ws.on('open', () => {
    console.log('Connected to server! Type messages and press Enter. Type /quit to exit.');
    rl.prompt();

    rl.on('line', (line) => {
      const text = line.trim();
      if (text === '') {
        rl.prompt();
        return;
      }
      if (text === '/quit') {
        rl.close();
        ws.close();
        return;
      }

   
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      } else {
        console.log('Not connected to server.');
      }
      rl.prompt();
    });
  });

  ws.on('message', (data) => {
    const text = data.toString();

    process.stdout.write(`\n[Broadcast] ${text}\n`);
    rl.prompt();
  });

  ws.on('close', () => {
    console.log('\nDisconnected from server.');
    rl.close();
  });

  ws.on('error', (err) => {
    console.error('Connection error:', err.message);
    rl.close();
  });


  return ws;
}

module.exports = { startClient };

if (require.main === module) startClient(8080, 'localhost');

const { startServer } = require('./server');
const { startClient } = require('./client');

function showHelp() {
  console.log(`
Usage:
  node index.js start [--port=8080]
  node index.js connect [--port=8080] [--host=localhost]

Examples:
  node index.js start --port=9000
  node index.js connect --port=9000 --host=127.0.0.1
`);
}

function parseOptions(args) {
  const opts = {};
  for (const a of args) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        
        if (key === 'port') {
          opts.port = Number(val);
        } else {
          opts[key] = val;
        }
      } else {
 
        opts[a.slice(2)] = true;
      }
    }
  }
  return opts;
}

function main() {
  const argv = process.argv.slice(2); 
  if (argv.length === 0) {
    showHelp();
    process.exit(1);
  }

  const command = argv[0];
  const options = parseOptions(argv.slice(1));
  const port = options.port || 8080;
  const host = options.host || 'localhost';

  if (command === 'start') {
    startServer(port);
  } else if (command === 'connect') {
    startClient(port, host);
  } else if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
  } else {
    console.error(`Unknown command: ${command}\n`);
    showHelp();
    process.exit(1);
  }
}

main();

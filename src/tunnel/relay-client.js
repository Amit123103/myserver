'use strict';

/**
 * Custom Zero-Dependency Reverse Tunnel Client (Runs on Home Computer)
 * Connects outbound to the Relay Server and forwards incoming traffic to localhost:443.
 */

const net = require('net');

const RELAY_HOST = process.env.TUNNEL_RELAY_HOST || 'vps.yourdomain.com';
const RELAY_CONTROL_PORT = parseInt(process.env.TUNNEL_CONTROL_PORT || '9000', 10);
const LOCAL_TARGET_PORT = parseInt(process.env.TUNNEL_LOCAL_TARGET_PORT || '443', 10);
const TUNNEL_SECRET = process.env.TUNNEL_SECRET || 'secret-tunnel-auth-token-replace-me';

function connectControl() {
  console.log(`[TUNNEL CLIENT] Connecting to relay server at ${RELAY_HOST}:${RELAY_CONTROL_PORT}...`);
  const controlSocket = net.connect(RELAY_CONTROL_PORT, RELAY_HOST);

  controlSocket.on('connect', () => {
    console.log('[TUNNEL CLIENT] Connected. Sending AUTH...');
    controlSocket.write(JSON.stringify({ type: 'AUTH', secret: TUNNEL_SECRET }) + '\n');
  });

  controlSocket.on('data', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'AUTH_OK') {
        console.log('[TUNNEL CLIENT] Authenticated with relay server. Ready to tunnel incoming traffic!');
      }

      if (msg.type === 'NEW_CONNECTION' && msg.id) {
        // Open a new socket to relay, and pipe it to local HTTPS port
        openDataChannel(msg.id);
      }
    } catch (_) {}
  });

  controlSocket.on('close', () => {
    console.warn('[TUNNEL CLIENT] Control connection lost. Reconnecting in 5 seconds...');
    setTimeout(connectControl, 5000);
  });

  controlSocket.on('error', (err) => {
    console.error('[TUNNEL CLIENT] Control error:', err.message);
  });
}

function openDataChannel(connId) {
  const relayDataSocket = net.connect(RELAY_CONTROL_PORT, RELAY_HOST);
  const localAppSocket = net.connect(LOCAL_TARGET_PORT, '127.0.0.1');

  relayDataSocket.on('connect', () => {
    relayDataSocket.write(JSON.stringify({ type: 'CHANNEL_READY', id: connId }) + '\n');
    relayDataSocket.pipe(localAppSocket);
    localAppSocket.pipe(relayDataSocket);
  });

  relayDataSocket.on('error', () => {
    localAppSocket.destroy();
  });

  localAppSocket.on('error', () => {
    relayDataSocket.destroy();
  });
}

if (require.main === module) {
  connectControl();
}

module.exports = {
  connectControl
};

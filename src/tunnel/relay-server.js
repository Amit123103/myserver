'use strict';

/**
 * Custom Zero-Dependency Reverse Tunnel Relay Server (Runs on a VPS / Public Machine)
 * Enables exposing a computer behind CGNAT without third-party services like Cloudflare or Ngrok.
 * Uses only Node.js built-in 'net' and 'crypto' modules.
 */

const net = require('net');
const crypto = require('crypto');

const CONTROL_PORT = parseInt(process.env.TUNNEL_CONTROL_PORT || '9000', 10);
const PUBLIC_PORT = parseInt(process.env.TUNNEL_PUBLIC_PORT || '8443', 10);
const TUNNEL_SECRET = process.env.TUNNEL_SECRET || 'secret-tunnel-auth-token-replace-me';

let clientControlSocket = null;
const pendingConnections = new Map(); // id -> publicClientSocket

// 1. Control Server (For local home server to connect to)
const controlServer = net.createServer((socket) => {
  console.log('[TUNNEL SERVER] Incoming connection on control port from:', socket.remoteAddress);

  let authenticated = false;

  socket.on('data', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'AUTH') {
        const secretBuf = Buffer.from(msg.secret || '');
        const targetBuf = Buffer.from(TUNNEL_SECRET);

        if (secretBuf.length === targetBuf.length && crypto.timingSafeEqual(secretBuf, targetBuf)) {
          authenticated = true;
          clientControlSocket = socket;
          console.log('[TUNNEL SERVER] Home client authenticated successfully!');
          socket.write(JSON.stringify({ type: 'AUTH_OK' }) + '\n');
        } else {
          console.warn('[TUNNEL SERVER] Authentication failed from:', socket.remoteAddress);
          socket.destroy();
        }
        return;
      }

      if (!authenticated) {
        socket.destroy();
        return;
      }

      // Home client opened a channel for a specific public connection
      if (msg.type === 'CHANNEL_READY' && msg.id) {
        const publicSocket = pendingConnections.get(msg.id);
        if (publicSocket) {
          pendingConnections.delete(msg.id);
          // Pipe data directly
          socket.pipe(publicSocket);
          publicSocket.pipe(socket);
        }
      }
    } catch (_) {}
  });

  socket.on('close', () => {
    if (clientControlSocket === socket) {
      console.log('[TUNNEL SERVER] Home client disconnected.');
      clientControlSocket = null;
    }
  });

  socket.on('error', (err) => {
    console.error('[TUNNEL SERVER] Socket error:', err.message);
  });
});

controlServer.listen(CONTROL_PORT, () => {
  console.log(`[TUNNEL SERVER] Control listener active on port ${CONTROL_PORT}`);
});

// 2. Public Facing Server (Visitors connect here from the world)
const publicServer = net.createServer((visitorSocket) => {
  if (!clientControlSocket) {
    console.warn('[TUNNEL SERVER] Visitor connected but home client is offline.');
    visitorSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\nHome Server Offline');
    return;
  }

  const connId = crypto.randomUUID();
  pendingConnections.set(connId, visitorSocket);

  // Instruct home client to connect back on a dedicated data channel
  clientControlSocket.write(JSON.stringify({ type: 'NEW_CONNECTION', id: connId }) + '\n');

  visitorSocket.on('close', () => {
    pendingConnections.delete(connId);
  });

  visitorSocket.on('error', () => {
    pendingConnections.delete(connId);
  });
});

publicServer.listen(PUBLIC_PORT, () => {
  console.log(`[TUNNEL SERVER] Public ingress active on port ${PUBLIC_PORT}`);
});

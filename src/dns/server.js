'use strict';

/**
 * Custom Zero-Dependency Authoritative DNS Server
 * Serves DNS queries over UDP & TCP using Node's 'dgram' and 'net' modules.
 */

const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { parseDnsPacket, buildDnsResponse } = require('./protocol');

class DnsServer {
  constructor(options = {}) {
    this.port = options.port || config.dns.port || 53;
    this.fallbackPort = options.fallbackPort || config.dns.fallbackPort || 5353;
    this.host = options.host || config.dns.host || '0.0.0.0';
    this.zoneFilePath = options.zoneFilePath || path.join(config.paths.data, 'zone.json');

    this.records = [];
    this.udpSocket = null;
    this.tcpServer = null;

    this.loadZone();
    this.watchZone();
  }

  loadZone() {
    if (!fs.existsSync(this.zoneFilePath)) {
      console.warn(`[DNS] Zone file not found at ${this.zoneFilePath}`);
      return;
    }

    try {
      const content = fs.readFileSync(this.zoneFilePath, 'utf8');
      const parsed = JSON.parse(content);
      this.records = parsed.records || [];
      console.log(`[DNS] Loaded ${this.records.length} records from zone file.`);
    } catch (err) {
      console.error('[DNS] Failed to parse zone file:', err.message);
    }
  }

  watchZone() {
    try {
      fs.watch(this.zoneFilePath, (event) => {
        if (event === 'change') {
          console.log('[DNS] Zone file changed. Reloading DNS records...');
          this.loadZone();
        }
      });
    } catch (_) {}
  }

  findAnswers(question) {
    const qName = question.name.toLowerCase();
    const qType = question.type;

    const matched = [];

    for (const rec of this.records) {
      const recName = rec.name.toLowerCase();
      if (recName === qName && (rec.type === qType || qType === 'ANY')) {
        matched.push(rec);
      }
    }

    // CNAME resolution if direct match was not found
    if (matched.length === 0 && qType !== 'CNAME') {
      for (const rec of this.records) {
        if (rec.name.toLowerCase() === qName && rec.type === 'CNAME') {
          matched.push(rec);
          // Follow CNAME
          const target = rec.data.toLowerCase();
          for (const targetRec of this.records) {
            if (targetRec.name.toLowerCase() === target && targetRec.type === qType) {
              matched.push(targetRec);
            }
          }
        }
      }
    }

    return matched;
  }

  handlePacket(buffer) {
    const query = parseDnsPacket(buffer);
    const answers = [];

    for (const q of query.questions) {
      const matched = this.findAnswers(q);
      answers.push(...matched);
    }

    return buildDnsResponse(query, answers);
  }

  start() {
    this.startUdp(this.port);
    this.startTcp(this.port);
  }

  startUdp(targetPort) {
    this.udpSocket = dgram.createSocket('udp4');

    this.udpSocket.on('message', (msg, rinfo) => {
      try {
        const responseBuf = this.handlePacket(msg);
        this.udpSocket.send(responseBuf, rinfo.port, rinfo.address);
      } catch (err) {
        console.error('[DNS UDP] Processing error:', err.message);
      }
    });

    this.udpSocket.on('error', (err) => {
      if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && targetPort === 53) {
        console.warn(`[DNS] Port 53 ${err.code === 'EADDRINUSE' ? 'already in use' : 'requires administrator rights'}. Falling back to UDP port ${this.fallbackPort}`);
        try { this.udpSocket.close(); } catch (_) {}
        this.startUdp(this.fallbackPort);
      } else {
        console.error('[DNS UDP] Socket error:', err.message);
      }
    });

    this.udpSocket.bind(targetPort, this.host, () => {
      console.log(`[DNS] Authoritative DNS Server listening on UDP ${this.host}:${targetPort}`);
    });
  }

  startTcp(targetPort) {
    this.tcpServer = net.createServer((socket) => {
      let state = 'LENGTH';
      let expectedLength = 0;
      let buffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (state === 'LENGTH' && buffer.length >= 2) {
          expectedLength = buffer.readUInt16BE(0);
          buffer = buffer.slice(2);
          state = 'PAYLOAD';
        }

        if (state === 'PAYLOAD' && buffer.length >= expectedLength) {
          const queryBuf = buffer.slice(0, expectedLength);
          try {
            const responseBuf = this.handlePacket(queryBuf);
            const lenBuf = Buffer.alloc(2);
            lenBuf.writeUInt16BE(responseBuf.length, 0);
            socket.write(Buffer.concat([lenBuf, responseBuf]));
          } catch (err) {
            console.error('[DNS TCP] Query error:', err.message);
          }
          socket.end();
        }
      });
    });

    this.tcpServer.on('error', (err) => {
      if (err.code === 'EACCES' && targetPort === 53) {
        console.warn(`[DNS] Port 53 requires administrator rights. Falling back to TCP port ${this.fallbackPort}`);
        this.startTcp(this.fallbackPort);
      } else {
        console.error('[DNS TCP] Server error:', err.message);
      }
    });

    this.tcpServer.listen(targetPort, this.host, () => {
      console.log(`[DNS] Authoritative DNS Server listening on TCP ${this.host}:${targetPort}`);
    });
  }

  stop() {
    if (this.udpSocket) this.udpSocket.close();
    if (this.tcpServer) this.tcpServer.close();
  }
}

// Standalone execution support
if (require.main === module) {
  const srv = new DnsServer();
  srv.start();
}

module.exports = DnsServer;

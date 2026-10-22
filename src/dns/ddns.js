'use strict';

/**
 * Custom Zero-Dependency Dynamic DNS (DDNS) Updater
 * Detects IP changes and automatically updates the local zone file.
 */

const os = require('os');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config');

class DynamicDnsUpdater {
  constructor(options = {}) {
    this.zoneFilePath = options.zoneFilePath || path.join(config.paths.data, 'zone.json');
    this.domain = options.domain || config.domain;
    this.lastIp = null;
  }

  getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async getPublicIp() {
    return new Promise((resolve) => {
      // Query standard DNS / IP echo
      const req = https.get('https://api.ipify.org', { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data.trim()));
      });

      req.on('error', () => {
        // Fallback to local IP if offline or unable to reach echo
        resolve(this.getLocalIp());
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(this.getLocalIp());
      });
    });
  }

  updateZoneRecord(newIp) {
    if (!fs.existsSync(this.zoneFilePath)) return;

    try {
      const content = fs.readFileSync(this.zoneFilePath, 'utf8');
      const zone = JSON.parse(content);
      let updated = false;

      for (const rec of zone.records) {
        if (rec.type === 'A' && (rec.name === this.domain || rec.name === `ns1.${this.domain}`)) {
          if (rec.data !== newIp) {
            rec.data = newIp;
            updated = true;
          }
        }
      }

      if (updated) {
        fs.writeFileSync(this.zoneFilePath, JSON.stringify(zone, null, 2), 'utf8');
        console.log(`[DDNS] Dynamic DNS updated: ${this.domain} -> ${newIp}`);
      }
    } catch (err) {
      console.error('[DDNS] Failed to update zone record:', err.message);
    }
  }

  async check() {
    const currentIp = this.getLocalIp();
    if (currentIp !== this.lastIp) {
      console.log(`[DDNS] Network IP change detected: ${this.lastIp} -> ${currentIp}`);
      this.lastIp = currentIp;
      this.updateZoneRecord(currentIp);
    }
  }

  start(intervalMs = 60000) {
    this.check();
    const timer = setInterval(() => this.check(), intervalMs);
    timer.unref();
    return timer;
  }
}

module.exports = DynamicDnsUpdater;

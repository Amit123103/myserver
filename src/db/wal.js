'use strict';

/**
 * Custom Zero-Dependency Write-Ahead Log (WAL)
 * Stores mutations as append-only JSON lines with guaranteed fsync durability.
 */

const fs = require('fs');
const path = require('path');

class WriteAheadLog {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = null;
    this.lsn = 0; // Log Sequence Number
    this.open();
  }

  open() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open append-only
    this.fd = fs.openSync(this.filePath, 'a+');
    this.determineCurrentLsn();
  }

  determineCurrentLsn() {
    try {
      const stats = fs.fstatSync(this.fd);
      if (stats.size === 0) {
        this.lsn = 0;
        return;
      }

      // Read entries to find highest lsn
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.lsn && entry.lsn > this.lsn) {
            this.lsn = entry.lsn;
            break;
          }
        } catch (_) {}
      }
    } catch (_) {
      this.lsn = 0;
    }
  }

  append(collection, operation, payload) {
    this.lsn += 1;
    const entry = {
      lsn: this.lsn,
      ts: Date.now(),
      col: collection,
      op: operation, // 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'
      data: payload
    };

    const line = JSON.stringify(entry) + '\n';
    const buffer = Buffer.from(line, 'utf8');

    // Write and fsync
    fs.writeSync(this.fd, buffer, 0, buffer.length);
    try {
      fs.fdatasyncSync(this.fd);
    } catch (_) {
      fs.fsyncSync(this.fd);
    }

    return entry;
  }

  replay(fromLsn = 0) {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n');
    const entries = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const entry = JSON.parse(line);
        if (entry.lsn > fromLsn) {
          entries.push(entry);
        }
      } catch (err) {
        console.warn(`[WAL] Corrupted log line skipped: "${line}"`, err.message);
      }
    }

    return entries;
  }

  truncate() {
    this.close();
    // Truncate WAL file by re-creating empty file
    fs.writeFileSync(this.filePath, '', 'utf8');
    this.open();
    this.lsn = 0;
  }

  close() {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch (_) {}
      this.fd = null;
    }
  }
}

module.exports = WriteAheadLog;

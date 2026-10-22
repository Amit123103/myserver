'use strict';

/**
 * Custom Zero-Dependency Advisory File Lock
 * Prevents multiple processes from concurrently mutating data files.
 */

const fs = require('fs');
const path = require('path');

class FileLock {
  constructor(lockFilePath) {
    this.lockFilePath = lockFilePath;
    this.lockFd = null;
    this.isLocked = false;
  }

  acquire(timeoutMs = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // 'wx' flag: Open for writing, fails if file exists
        this.lockFd = fs.openSync(this.lockFilePath, 'wx');
        // Write current PID to lock file
        const payload = JSON.stringify({ pid: process.pid, time: Date.now() });
        fs.writeSync(this.lockFd, payload);
        fs.fsyncSync(this.lockFd);
        this.isLocked = true;
        return true;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Check if previous lock is stale (process died)
          if (this.isStale()) {
            this.forceRelease();
            continue;
          }
          // Sleep briefly (synchronous backoff)
          const waitTime = Math.min(50, timeoutMs);
          const endWait = Date.now() + waitTime;
          while (Date.now() < endWait) {
            // busy wait small slice
          }
        } else {
          throw err;
        }
      }
    }

    throw new Error(`[LOCK] Failed to acquire file lock on ${this.lockFilePath} within ${timeoutMs}ms`);
  }

  isStale() {
    try {
      const content = fs.readFileSync(this.lockFilePath, 'utf8');
      const data = JSON.parse(content);
      // Check if PID is alive
      process.kill(data.pid, 0); // throws error if process is dead
      return false;
    } catch (err) {
      // Process does not exist (ESRCH) or corrupted lock file
      return true;
    }
  }

  forceRelease() {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (_) {}
  }

  release() {
    if (!this.isLocked) return;
    try {
      if (this.lockFd !== null) {
        fs.closeSync(this.lockFd);
        this.lockFd = null;
      }
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (err) {
      // Ignore release errors if already cleaned up
    } finally {
      this.isLocked = false;
    }
  }
}

module.exports = FileLock;

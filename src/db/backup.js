'use strict';

/**
 * Custom Zero-Dependency Database Backup, Restore, and Integrity Verification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

class BackupManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || config.paths.data;
    this.backupDir = options.backupDir || config.paths.backups;
    this.retentionDays = options.retentionDays || config.backupRetentionDays;

    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  computeChecksum(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  createBackup(dbEngine) {
    this.ensureDirs();

    // Force snapshot in DB engine first if provided
    let snapshotFile = path.join(this.dataDir, 'snapshot.json');
    if (dbEngine) {
      dbEngine.createSnapshot();
    }

    if (!fs.existsSync(snapshotFile)) {
      throw new Error(`Snapshot file not found at ${snapshotFile}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup-${timestamp}.json`;
    const backupPath = path.join(this.backupDir, backupFileName);
    const checksumPath = `${backupPath}.sha256`;

    // Copy snapshot atomically
    fs.copyFileSync(snapshotFile, backupPath);

    // Compute and save checksum
    const checksum = this.computeChecksum(backupPath);
    fs.writeFileSync(checksumPath, `${checksum}  ${backupFileName}\n`, 'utf8');

    // Clean up older backups exceeding retention limit
    this.rotateBackups();

    return {
      fileName: backupFileName,
      path: backupPath,
      checksum,
      size: fs.statSync(backupPath).size
    };
  }

  rotateBackups() {
    const files = fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(this.backupDir, f),
        time: fs.statSync(path.join(this.backupDir, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time); // newest first

    if (files.length > this.retentionDays) {
      const toDelete = files.slice(this.retentionDays);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.path);
          const shaFile = `${item.path}.sha256`;
          if (fs.existsSync(shaFile)) fs.unlinkSync(shaFile);
        } catch (err) {
          console.warn(`[BACKUP] Failed to delete old backup ${item.path}:`, err.message);
        }
      }
    }
  }

  verifyBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
      return { valid: false, error: 'Backup file does not exist' };
    }

    const checksumPath = `${backupPath}.sha256`;
    if (!fs.existsSync(checksumPath)) {
      return { valid: false, error: 'Missing .sha256 checksum file' };
    }

    const expectedChecksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
    const actualChecksum = this.computeChecksum(backupPath);

    if (expectedChecksum !== actualChecksum) {
      return {
        valid: false,
        error: `Checksum mismatch! Expected: ${expectedChecksum}, got: ${actualChecksum}`
      };
    }

    try {
      const content = fs.readFileSync(backupPath, 'utf8');
      const data = JSON.parse(content);
      if (!data.collections) {
        return { valid: false, error: 'Invalid backup structure: missing collections' };
      }
      return { valid: true, checksum: actualChecksum, collections: Object.keys(data.collections) };
    } catch (err) {
      return { valid: false, error: `JSON parse error: ${err.message}` };
    }
  }

  restoreBackup(backupFileName, dbEngine) {
    const backupPath = path.isAbsolute(backupFileName)
      ? backupFileName
      : path.join(this.backupDir, backupFileName);

    const verification = this.verifyBackup(backupPath);
    if (!verification.valid) {
      throw new Error(`Cannot restore corrupted or invalid backup: ${verification.error}`);
    }

    const targetSnapshot = path.join(this.dataDir, 'snapshot.json');
    const walFile = path.join(this.dataDir, 'wal.jsonl');

    // Copy verified backup over snapshot
    fs.copyFileSync(backupPath, targetSnapshot);

    // Truncate WAL to ensure no replay overrides restored snapshot
    fs.writeFileSync(walFile, '', 'utf8');

    if (dbEngine) {
      dbEngine.recover();
    }

    return { success: true, restoredFrom: backupPath };
  }

  startDailyBackupSchedule(dbEngine) {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    // Perform initial backup on startup if none exists today
    try {
      this.createBackup(dbEngine);
    } catch (err) {
      console.warn(`[BACKUP] Initial backup skipped:`, err.message);
    }

    const timer = setInterval(() => {
      try {
        this.createBackup(dbEngine);
      } catch (err) {
        console.error(`[BACKUP SCHEDULE] Backup error:`, err.message);
      }
    }, ONE_DAY_MS);

    timer.unref(); // Don't prevent clean process exit
    return timer;
  }
}

module.exports = BackupManager;

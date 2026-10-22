#!/usr/bin/env node
'use strict';

/**
 * Database Backup Management CLI
 * Usage:
 *   node cli/backup.js create
 *   node cli/backup.js list
 *   node cli/backup.js verify [filename]
 *   node cli/backup.js restore <filename>
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const BackupManager = require('../src/db/backup');
const { getDatabase } = require('../src/db/engine');

const [,, command, ...args] = process.argv;
const backupManager = new BackupManager();

function printUsage() {
  console.log(`
myserver Database Backup Manager
--------------------------------
Usage:
  node cli/backup.js create             Create an immediate snapshot and SHA-256 verified backup
  node cli/backup.js list               List all stored backups
  node cli/backup.js verify [file]      Verify integrity and SHA-256 checksum of backup
  node cli/backup.js restore <file>     Restore database state from a backup file
`);
}

switch (command) {
  case 'create': {
    console.log('Initiating database snapshot and backup...');
    try {
      const db = getDatabase();
      const res = backupManager.createBackup(db);
      console.log('\n=======================================================');
      console.log('BACKUP CREATED SUCCESSFULLY');
      console.log('=======================================================');
      console.log(`File     : ${res.fileName}`);
      console.log(`Size     : ${(res.size / 1024).toFixed(2)} KB`);
      console.log(`SHA-256  : ${res.checksum}`);
      console.log(`Location : ${res.path}`);
      console.log('=======================================================\n');
    } catch (err) {
      console.error('Backup creation failed:', err.message);
      process.exit(1);
    }
    break;
  }

  case 'list': {
    const dir = config.paths.backups;
    if (!fs.existsSync(dir)) {
      console.log('No backups directory found.');
      break;
    }

    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .map(f => {
        const full = path.join(dir, f);
        const stats = fs.statSync(full);
        return {
          name: f,
          sizeKb: (stats.size / 1024).toFixed(2),
          date: stats.mtime.toLocaleString()
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));

    console.log('\nStored Database Backups:');
    console.log('-----------------------------------------------------------------------------------');
    console.log('BACKUP FILENAME                         SIZE (KB)      CREATED AT');
    console.log('-----------------------------------------------------------------------------------');
    if (files.length === 0) {
      console.log('No backups found. Run "node cli/backup.js create" to take a backup.');
    } else {
      for (const item of files) {
        console.log(`${item.name.padEnd(40)} ${item.sizeKb.padStart(9)}      ${item.date}`);
      }
    }
    console.log('-----------------------------------------------------------------------------------\n');
    break;
  }

  case 'verify': {
    let file = args[0];
    const dir = config.paths.backups;

    if (!file) {
      // Pick most recent
      const files = fs.readdirSync(dir).filter(f => f.startsWith('backup-') && f.endsWith('.json'));
      if (files.length === 0) {
        console.error('No backup files found to verify.');
        process.exit(1);
      }
      files.sort((a, b) => b.localeCompare(a));
      file = files[0];
    }

    const fullPath = path.isAbsolute(file) ? file : path.join(dir, file);
    console.log(`Verifying backup integrity for: ${path.basename(fullPath)}...`);

    const result = backupManager.verifyBackup(fullPath);
    if (result.valid) {
      console.log('\n[PASS] Backup file integrity verified!');
      console.log(`SHA-256 Checksum : ${result.checksum}`);
      console.log(`Collections      : [${result.collections.join(', ')}]\n`);
    } else {
      console.error(`\n[FAIL] Backup verification failed: ${result.error}\n`);
      process.exit(1);
    }
    break;
  }

  case 'restore': {
    const file = args[0];
    if (!file) {
      console.error('Error: Please specify the backup filename or path to restore.');
      process.exit(1);
    }

    console.log(`Restoring database from backup: ${file}...`);
    try {
      const db = getDatabase();
      const res = backupManager.restoreBackup(file, db);
      console.log('\n=======================================================');
      console.log('DATABASE RESTORED SUCCESSFULLY');
      console.log('=======================================================');
      console.log(`Restored From: ${res.restoredFrom}`);
      console.log('Database state reloaded into memory and WAL reset.');
      console.log('=======================================================\n');
    } catch (err) {
      console.error('Restore failed:', err.message);
      process.exit(1);
    }
    break;
  }

  default:
    printUsage();
    break;
}

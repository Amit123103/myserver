'use strict';

/**
 * Custom Zero-Dependency Database Engine
 * Features: WAL durability, In-Memory Indexing, Atomic Snapshots, Crash Recovery.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const FileLock = require('./lock');
const WriteAheadLog = require('./wal');
const Collection = require('./collection');
const { NoteSchema } = require('./schema');

class DatabaseEngine {
  constructor(options = {}) {
    this.dataDir = options.dataDir || config.paths.data;
    this.walPath = path.join(this.dataDir, 'wal.jsonl');
    this.snapshotPath = path.join(this.dataDir, 'snapshot.json');
    this.lockPath = path.join(this.dataDir, 'db.lock');

    this.collections = new Map();
    this.schemas = new Map();
    this.lock = null;
    this.wal = null;
    this.lastSnapshotLsn = 0;
    this.compactionThreshold = 5000; // compact every 5000 mutations

    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  registerSchema(name, schema, indexedFields = []) {
    this.schemas.set(name, schema);
    const col = new Collection(name, schema, indexedFields);
    this.collections.set(name, col);
    return col;
  }

  init() {
    this.ensureDirs();

    // Acquire lock
    this.lock = new FileLock(this.lockPath);
    this.lock.acquire(5000);

    // Register default schemas
    this.registerSchema('notes', NoteSchema, ['status', 'priority']);
    this.registerSchema('api_keys', null, ['id', 'status']);

    // Initialize WAL
    this.wal = new WriteAheadLog(this.walPath);

    // Replay recovery
    this.recover();

    return this;
  }

  recover() {
    // Step 1: Load snapshot if exists
    if (fs.existsSync(this.snapshotPath)) {
      try {
        const raw = fs.readFileSync(this.snapshotPath, 'utf8');
        const snapshot = JSON.parse(raw);
        this.lastSnapshotLsn = snapshot.lsn || 0;

        if (snapshot.collections) {
          for (const [colName, docs] of Object.entries(snapshot.collections)) {
            let col = this.collections.get(colName);
            if (!col) {
              col = this.registerSchema(colName, null);
            }
            col.loadState(docs);
          }
        }
      } catch (err) {
        console.error(`[DB RECOVERY] Snapshot load failed: ${err.message}. Relying on WAL replay.`);
      }
    }

    // Step 2: Replay WAL from last snapshot LSN
    const mutations = this.wal.replay(this.lastSnapshotLsn);
    for (const entry of mutations) {
      this.applyMutation(entry.col, entry.op, entry.data, false);
    }
  }

  applyMutation(collectionName, op, data, writeToWal = true) {
    let col = this.collections.get(collectionName);
    if (!col) {
      col = this.registerSchema(collectionName, null);
    }

    if (writeToWal) {
      this.wal.append(collectionName, op, data);
    }

    switch (op) {
      case 'INSERT':
        return col.insert(data);
      case 'UPDATE':
        return col.update(data.id, data.updates);
      case 'DELETE':
        return col.delete(data.id);
      case 'TRUNCATE':
        col.truncate();
        return true;
      default:
        throw new Error(`Unknown mutation operation: ${op}`);
    }
  }

  getCollection(name) {
    const col = this.collections.get(name);
    if (!col) {
      throw new Error(`Collection '${name}' not found`);
    }
    return col;
  }

  // --- CRUD API ---

  insert(collectionName, rawData) {
    const schema = this.schemas.get(collectionName);
    let docToInsert = rawData;

    if (schema) {
      const { valid, errors, data } = schema.validate(rawData, false);
      if (!valid) {
        const err = new Error(`Validation failed: ${errors.join(', ')}`);
        err.validationErrors = errors;
        err.statusCode = 400;
        throw err;
      }
      docToInsert = data;
    }

    if (!docToInsert.id) {
      docToInsert.id = crypto.randomUUID();
    }
    const now = new Date().toISOString();
    if (!docToInsert.createdAt) docToInsert.createdAt = now;
    if (!docToInsert.updatedAt) docToInsert.updatedAt = now;

    const inserted = this.applyMutation(collectionName, 'INSERT', docToInsert, true);

    this.checkCompaction();
    return inserted;
  }

  findById(collectionName, id) {
    return this.getCollection(collectionName).findById(id);
  }

  query(collectionName, options) {
    return this.getCollection(collectionName).query(options);
  }

  update(collectionName, id, updates) {
    const col = this.getCollection(collectionName);
    const existing = col.findById(id);
    if (!existing) {
      const err = new Error(`Document with id '${id}' not found`);
      err.statusCode = 404;
      throw err;
    }

    const schema = this.schemas.get(collectionName);
    let sanitizedUpdates = updates;

    if (schema) {
      const { valid, errors, data } = schema.validate(updates, true);
      if (!valid) {
        const err = new Error(`Validation failed: ${errors.join(', ')}`);
        err.validationErrors = errors;
        err.statusCode = 400;
        throw err;
      }
      sanitizedUpdates = data;
    }

    delete sanitizedUpdates.id; // Prevent updating id
    delete sanitizedUpdates.createdAt; // Prevent modifying creation date

    const updated = this.applyMutation(collectionName, 'UPDATE', { id, updates: sanitizedUpdates }, true);
    this.checkCompaction();
    return updated;
  }

  delete(collectionName, id) {
    const col = this.getCollection(collectionName);
    const existing = col.findById(id);
    if (!existing) {
      const err = new Error(`Document with id '${id}' not found`);
      err.statusCode = 404;
      throw err;
    }

    const deleted = this.applyMutation(collectionName, 'DELETE', { id }, true);
    this.checkCompaction();
    return deleted;
  }

  // --- Snapshot & Compaction ---

  createSnapshot() {
    const state = {
      version: 1,
      timestamp: Date.now(),
      lsn: this.wal ? this.wal.lsn : 0,
      collections: {}
    };

    for (const [name, col] of this.collections.entries()) {
      state.collections[name] = col.getAll();
    }

    const tmpSnapshotPath = `${this.snapshotPath}.tmp.${Date.now()}`;
    const json = JSON.stringify(state, null, 2);

    // Atomic write: write to temp file, fsync, rename
    const fd = fs.openSync(tmpSnapshotPath, 'w');
    fs.writeSync(fd, json, 0, 'utf8');
    try {
      fs.fdatasyncSync(fd);
    } catch (_) {
      fs.fsyncSync(fd);
    }
    fs.closeSync(fd);

    fs.renameSync(tmpSnapshotPath, this.snapshotPath);

    // Truncate WAL safely since state is flushed
    this.lastSnapshotLsn = state.lsn;
    if (this.wal) {
      this.wal.truncate();
    }

    return state;
  }

  checkCompaction() {
    if (this.wal && this.wal.lsn >= this.compactionThreshold) {
      this.createSnapshot();
    }
  }

  close() {
    if (this.wal) {
      this.wal.close();
      this.wal = null;
    }
    if (this.lock) {
      this.lock.release();
      this.lock = null;
    }
  }
}

// Singleton database instance
let dbInstance = null;

function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseEngine();
    dbInstance.init();
  }
  return dbInstance;
}

module.exports = {
  DatabaseEngine,
  getDatabase
};

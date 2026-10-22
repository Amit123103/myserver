'use strict';

/**
 * Custom Zero-Dependency API Key & Authentication Manager
 * Stores SHA-256 hashed keys, verifies via constant-time comparison, supports revocation & rotation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

class AuthManager {
  constructor(filePath) {
    this.filePath = filePath || path.join(config.paths.data, 'api_keys.json');
    this.keys = new Map(); // id -> keyObject
    this.loadKeys();
  }

  hashKey(rawKey) {
    return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
  }

  loadKeys() {
    if (!fs.existsSync(this.filePath)) {
      this.saveKeys();
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.keys.clear();
      for (const k of data) {
        this.keys.set(k.id, k);
      }
    } catch (err) {
      console.error(`[AUTH] Failed to load keys from ${this.filePath}:`, err.message);
    }
  }

  saveKeys() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = Array.from(this.keys.values());
    const tmp = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  createKey(name = 'default') {
    // Generate 32 bytes cryptographically secure random key
    const rawKey = `sk_${crypto.randomBytes(24).toString('hex')}`;
    const hashedKey = this.hashKey(rawKey);
    const keyId = crypto.randomUUID();

    const record = {
      id: keyId,
      name,
      hashedKey,
      prefix: rawKey.substring(0, 7) + '...',
      status: 'active', // 'active' | 'revoked'
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };

    this.keys.set(keyId, record);
    this.saveKeys();

    return {
      id: keyId,
      name,
      rawKey, // Returned ONCE upon creation
      createdAt: record.createdAt
    };
  }

  verifyKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, reason: 'Missing or invalid key format' };
    }

    const incomingHash = this.hashKey(rawKey);
    const incomingBuf = Buffer.from(incomingHash, 'hex');

    for (const keyRecord of this.keys.values()) {
      if (keyRecord.status !== 'active') {
        continue;
      }

      const storedBuf = Buffer.from(keyRecord.hashedKey, 'hex');
      // Constant-time comparison
      if (storedBuf.length === incomingBuf.length && crypto.timingSafeEqual(storedBuf, incomingBuf)) {
        keyRecord.lastUsedAt = new Date().toISOString();
        this.saveKeys();
        return {
          valid: true,
          keyId: keyRecord.id,
          name: keyRecord.name
        };
      }
    }

    return { valid: false, reason: 'Unauthorized: Invalid API Key' };
  }

  listKeys() {
    return Array.from(this.keys.values()).map(k => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      status: k.status,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt
    }));
  }

  revokeKey(keyId) {
    const keyRecord = this.keys.get(keyId);
    if (!keyRecord) {
      throw new Error(`API Key '${keyId}' not found`);
    }

    keyRecord.status = 'revoked';
    keyRecord.revokedAt = new Date().toISOString();
    this.saveKeys();
    return keyRecord;
  }

  rotateKey(keyId) {
    const keyRecord = this.keys.get(keyId);
    if (!keyRecord) {
      throw new Error(`API Key '${keyId}' not found`);
    }

    this.revokeKey(keyId);
    return this.createKey(`${keyRecord.name}-rotated`);
  }
}

const authManager = new AuthManager();

module.exports = {
  AuthManager,
  authManager
};

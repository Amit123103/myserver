'use strict';

/**
 * Custom Zero-Dependency Rotating Logger
 * Writes structured access and error logs with rotation and secret masking.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure log dir exists
if (!fs.existsSync(config.paths.logs)) {
  fs.mkdirSync(config.paths.logs, { recursive: true });
}

const SENSITIVE_HEADERS = new Set(['x-api-key', 'authorization', 'cookie', 'set-cookie']);
const SENSITIVE_FIELDS = new Set(['password', 'secret', 'apikey', 'api_key', 'token', 'jwt']);

function maskValue(val) {
  if (!val) return val;
  if (typeof val !== 'string') return '[REDACTED]';
  if (val.length <= 6) return '***';
  return val.substring(0, 3) + '***' + val.substring(val.length - 3);
}

function sanitizeObject(obj, depth = 0) {
  if (depth > 4 || !obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey) || SENSITIVE_HEADERS.has(lowerKey)) {
      clone[key] = maskValue(value);
    } else if (typeof value === 'object' && value !== null) {
      clone[key] = sanitizeObject(value, depth + 1);
    } else {
      clone[key] = value;
    }
  }

  return clone;
}

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || config.paths.logs;
    this.maxSizeBytes = options.maxSizeBytes || 10 * 1024 * 1024; // 10MB
    this.currentDate = this.getDateString();

    this.accessStream = null;
    this.errorStream = null;

    this.initStreams();
  }

  getDateString() {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  initStreams() {
    const today = this.getDateString();
    this.currentDate = today;

    const accessPath = path.join(this.logDir, `access-${today}.log`);
    const errorPath = path.join(this.logDir, `error-${today}.log`);

    if (this.accessStream) this.accessStream.end();
    if (this.errorStream) this.errorStream.end();

    this.accessStream = fs.createWriteStream(accessPath, { flags: 'a', encoding: 'utf8' });
    this.errorStream = fs.createWriteStream(errorPath, { flags: 'a', encoding: 'utf8' });
  }

  checkRotation() {
    const today = this.getDateString();
    if (today !== this.currentDate) {
      this.initStreams();
    }
  }

  write(stream, level, message, meta = null) {
    this.checkRotation();

    const timestamp = new Date().toISOString();
    let sanitizedMeta = null;
    if (meta) {
      try {
        sanitizedMeta = sanitizeObject(meta);
      } catch (_) {
        sanitizedMeta = '[Unserializable Meta]';
      }
    }

    const logEntry = {
      timestamp,
      level,
      message,
      ...(sanitizedMeta ? { meta: sanitizedMeta } : {})
    };

    const line = JSON.stringify(logEntry) + '\n';
    stream.write(line);

    // Also output to console in non-production or for errors
    if (!config.isProd || level === 'ERROR') {
      const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
      const reset = '\x1b[0m';
      console.log(`${color}[${timestamp}] [${level}]${reset} ${message}`);
      if (sanitizedMeta && level === 'ERROR') {
        console.error(sanitizedMeta);
      }
    }
  }

  info(msg, meta) {
    this.write(this.accessStream, 'INFO', msg, meta);
  }

  warn(msg, meta) {
    this.write(this.accessStream, 'WARN', msg, meta);
  }

  error(msg, meta) {
    this.write(this.errorStream, 'ERROR', msg, meta);
  }

  access(req, res, durationMs) {
    const meta = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      durationMs,
      userAgent: req.headers['user-agent'],
      contentLength: res.getHeader('content-length')
    };

    this.info(`${req.method} ${req.url} -> ${res.statusCode} (${durationMs}ms)`, meta);
  }
}

const logger = new Logger();

module.exports = {
  logger,
  Logger,
  sanitizeObject,
  maskValue
};

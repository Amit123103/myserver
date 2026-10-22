'use strict';

const path = require('path');
const { loadEnv } = require('./security/env');

// Auto-load .env on import
loadEnv();

const ROOT_DIR = path.resolve(__dirname, '..');

const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.HTTP_PORT || '80', 10),
  httpsPort: parseInt(process.env.HTTPS_PORT || '443', 10),
  fallbackPort: parseInt(process.env.FALLBACK_HTTP_PORT || '8080', 10),
  fallbackHttpsPort: parseInt(process.env.FALLBACK_HTTPS_PORT || '8443', 10),
  host: process.env.HOST || '0.0.0.0',
  domain: process.env.DOMAIN || 'myserver.local',

  // Security
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://myserver.local,https://localhost,https://127.0.0.1')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  maxBodySize: parseInt(process.env.MAX_BODY_SIZE_BYTES || '1048576', 10), // 1MB
  jwtSecret: process.env.JWT_SECRET || 'insecure-default-jwt-secret-replace-immediately',

  // Storage Directories
  paths: {
    root: ROOT_DIR,
    data: path.resolve(ROOT_DIR, process.env.DATA_DIR || './data'),
    backups: path.resolve(ROOT_DIR, process.env.BACKUP_DIR || './backups'),
    logs: path.resolve(ROOT_DIR, process.env.LOG_DIR || './logs'),
    certs: path.resolve(ROOT_DIR, process.env.CERTS_DIR || './certs')
  },

  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10),

  // DNS
  dns: {
    enabled: process.env.DNS_ENABLED !== 'false',
    port: parseInt(process.env.DNS_PORT || '53', 10),
    fallbackPort: parseInt(process.env.DNS_FALLBACK_PORT || '5353', 10),
    host: process.env.DNS_HOST || '0.0.0.0'
  },

  // ACME
  acme: {
    enabled: process.env.ACME_ENABLED === 'true',
    email: process.env.ACME_EMAIL || 'admin@myserver.local',
    directoryUrl: process.env.ACME_DIRECTORY_URL || 'https://acme-staging-v02.api.letsencrypt.org/directory'
  }
};

module.exports = config;

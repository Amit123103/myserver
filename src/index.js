'use strict';

/**
 * Main Application Entrypoint
 * Bootstraps the Database Engine, HTTP/HTTPS Server, DNS Server, and Automated Schedulers.
 */

const config = require('./config');
const { getDatabase } = require('./db/engine');
const BackupManager = require('./db/backup');
const { authManager } = require('./security/auth');
const ApiServer = require('./http/server');
const DnsServer = require('./dns/server');
const DynamicDnsUpdater = require('./dns/ddns');
const { logger } = require('./security/logger');

console.log('================================================================');
console.log('            myserver - Zero-Dependency Production API           ');
console.log('================================================================');

// 1. Initialize Database
console.log('[INIT] Initializing WAL Database Engine...');
const db = getDatabase();
console.log('[INIT] Database ready. Active collections:', Array.from(db.collections.keys()).join(', '));

// 2. Ensure at least one active API key exists
const existingKeys = authManager.listKeys();
if (existingKeys.length === 0) {
  console.log('[INIT] Generating initial Master API Key...');
  const newKey = authManager.createKey('Master Key');
  console.log('----------------------------------------------------------------');
  console.log('>>> IMPORTANT: SAVE YOUR INITIAL API KEY (shown only once):');
  console.log(`>>> Key ID : ${newKey.id}`);
  console.log(`>>> API KEY: ${newKey.rawKey}`);
  console.log('----------------------------------------------------------------');
} else {
  console.log(`[INIT] Found ${existingKeys.length} configured API key(s).`);
}

// 3. Initialize Backup Manager & Schedule
const backupManager = new BackupManager();
backupManager.startDailyBackupSchedule(db);
console.log(`[INIT] Daily automatic backup scheduled (Retention: ${config.backupRetentionDays} days)`);

// 4. Initialize DNS Server
let dnsServer = null;
if (config.dns.enabled) {
  dnsServer = new DnsServer();
  dnsServer.start();

  const ddns = new DynamicDnsUpdater();
  ddns.start(60000);
}

// 5. Initialize & Start API Server
const server = new ApiServer();
server.start();

// Graceful Shutdown
let isClosing = false;
function gracefulShutdown(signal) {
  if (isClosing) return;
  isClosing = true;

  console.log(`\n[SHUTDOWN] Received ${signal}. Closing all connections and flushing state...`);
  logger.info(`Server shutting down via ${signal}`);

  // Flush snapshot
  try {
    db.createSnapshot();
    console.log('[SHUTDOWN] Database state flushed to snapshot.');
  } catch (err) {
    console.error('[SHUTDOWN] Snapshot error:', err.message);
  }

  // Close database locks and file descriptors
  db.close();

  // Stop DNS
  if (dnsServer) {
    dnsServer.stop();
  }

  // Stop HTTP/HTTPS servers
  server.stop(() => {
    console.log('[SHUTDOWN] All network listeners closed. Goodbye!');
    process.exit(0);
  });

  // Forced exit fallback after 5s
  setTimeout(() => {
    console.warn('[SHUTDOWN] Force exiting process after timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { reason: reason && reason.message ? reason.message : reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
  console.error('[FATAL] Uncaught Exception:', err);
  gracefulShutdown('FATAL_EXCEPTION');
});

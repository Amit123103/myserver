'use strict';

/**
 * Custom Zero-Dependency Process Supervisor & Watchdog
 * Features: Automatic crash recovery with exponential backoff, health monitoring, and signal forwarding.
 */

const { fork } = require('child_process');
const path = require('path');
const { logger } = require('../security/logger');

const APP_PATH = path.resolve(__dirname, '../index.js');
let child = null;
let restarts = 0;
let lastRestartTime = Date.now();
let isShuttingDown = false;

function calculateBackoffMs(retryCount) {
  // 1s, 2s, 4s, 8s, up to max 30s
  return Math.min(1000 * Math.pow(2, retryCount), 30000);
}

function startChild() {
  if (isShuttingDown) return;

  const now = Date.now();
  // If app ran stably for more than 60s, reset crash counter
  if (now - lastRestartTime > 60000) {
    restarts = 0;
  }
  lastRestartTime = now;

  console.log(`[SUPERVISOR] Starting application worker process (PID parent: ${process.pid})...`);
  logger.info(`Supervisor starting child process from ${APP_PATH}`);

  child = fork(APP_PATH, [], {
    stdio: 'inherit',
    env: { ...process.env, SUPERVISED: '1' }
  });

  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      console.log('[SUPERVISOR] Child exited cleanly during shutdown.');
      process.exit(0);
      return;
    }

    restarts++;
    const backoff = calculateBackoffMs(restarts - 1);
    const msg = `Child process died (exit code: ${code}, signal: ${signal}). Crash count: ${restarts}. Restarting in ${backoff / 1000}s...`;
    console.error(`[SUPERVISOR] ${msg}`);
    logger.error(msg, { code, signal, restarts });

    setTimeout(startChild, backoff);
  });

  child.on('error', (err) => {
    console.error('[SUPERVISOR] Failed to spawn child process:', err.message);
    logger.error(`Supervisor child error: ${err.message}`);
  });
}

function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[SUPERVISOR] Received ${signal}. Gracefully stopping worker process...`);

  if (child && child.connected) {
    child.kill(signal);
    // Hard kill fallback after 10s
    setTimeout(() => {
      console.warn('[SUPERVISOR] Child did not terminate in time. Forcing kill...');
      if (child) child.kill('SIGKILL');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Launch worker
startChild();

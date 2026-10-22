'use strict';

/**
 * Custom Zero-Dependency .env Parser
 * Implemented using Node.js built-in 'fs' and 'path' modules.
 */

const fs = require('fs');
const path = require('path');

function parseEnvString(src) {
  const env = {};
  const lines = src.toString().split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }

    const eqIndex = rawLine.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = rawLine.substring(0, eqIndex).trim();
    let val = rawLine.substring(eqIndex + 1).trim();

    // Handle quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
      // Unescape newlines and quotes if double-quoted
      if (rawLine.startsWith(`${key}="`)) {
        val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      }
    } else {
      // Remove inline comments
      const commentIdx = val.indexOf('#');
      if (commentIdx !== -1) {
        val = val.substring(0, commentIdx).trim();
      }
    }

    env[key] = val;
  }

  return env;
}

function loadEnv(envPath) {
  const targetPath = envPath || path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(targetPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    const parsed = parseEnvString(content);

    // Apply to process.env if not already set
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    // Attempt to lock down file permissions on POSIX systems (chmod 600)
    try {
      if (process.platform !== 'win32') {
        fs.chmodSync(targetPath, 0o600);
      }
    } catch (_) {
      // Ignore permission chmod errors on non-compatible filesystems
    }

    return parsed;
  } catch (err) {
    console.error(`[ENV] Failed to load .env from ${targetPath}:`, err.message);
    return {};
  }
}

module.exports = {
  parseEnvString,
  loadEnv
};

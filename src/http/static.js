'use strict';

/**
 * Custom Zero-Dependency Static File Server
 * Safely streams static assets from ./public with MIME type detection and path traversal protection.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const PUBLIC_DIR = path.resolve(config.paths.root, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function ensurePublicDir() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
}

function serveStatic(req, res, targetDir = PUBLIC_DIR) {
  ensurePublicDir();

  const urlPath = req.url.split('?')[0];

  // Prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(targetDir, safePath);

  // If request is a directory, look for index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Ensure filePath stays within targetDir
  if (!filePath.startsWith(targetDir)) {
    return false; // not allowed
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false; // not found
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const stats = fs.statSync(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  return true;
}

module.exports = {
  PUBLIC_DIR,
  MIME_TYPES,
  ensurePublicDir,
  serveStatic
};

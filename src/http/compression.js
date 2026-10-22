'use strict';

/**
 * Custom Zero-Dependency Gzip Response Compression
 * Uses Node's built-in 'zlib' module.
 */

const zlib = require('zlib');

function compressionMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) {
    return next();
  }

  const originalEnd = res.end;
  const originalWrite = res.write;

  // Intercept write & end for compressible payloads
  const chunks = [];

  res.write = function(chunk, encoding) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }
    return true;
  };

  res.end = function(chunk, encoding) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }

    const bodyBuffer = Buffer.concat(chunks);
    const contentType = res.getHeader('Content-Type') || '';

    // Only compress text, json, html > 1024 bytes
    const isCompressible = /json|text|html|javascript|xml/i.test(contentType);

    if (isCompressible && bodyBuffer.length > 1024) {
      zlib.gzip(bodyBuffer, (err, compressed) => {
        if (err) {
          // Fallback to uncompressed
          res.removeHeader('Content-Encoding');
          res.setHeader('Content-Length', bodyBuffer.length);
          return originalEnd.call(res, bodyBuffer);
        }

        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', compressed.length);
        res.removeHeader('ETag');
        return originalEnd.call(res, compressed);
      });
    } else {
      res.setHeader('Content-Length', bodyBuffer.length);
      return originalEnd.call(res, bodyBuffer);
    }
  };

  next();
}

module.exports = {
  compressionMiddleware
};

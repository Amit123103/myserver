'use strict';

/**
 * Custom Zero-Dependency Middleware Suite
 * Includes Security Headers, CORS, Rate Limiting, Body Parser, Authentication, and Safe Error Handling.
 */

const config = require('../config');
const { rateLimiter } = require('../security/rate-limiter');
const { authManager } = require('../security/auth');
const { logger } = require('../security/logger');

// Security headers
function securityHeaders(req, res, next) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()');
  next();
}

// CORS middleware
function cors(req, res, next) {
  const origin = req.headers.origin;

  if (origin) {
    // If configured to allow all or matches allowed origins
    const isAllowed = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }

  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  next();
}

// Rate limit & Brute-force lockout
function rateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  // Check brute-force lockout
  if (rateLimiter.isLockedOut(ip)) {
    return res.error(403, 'Your IP has been temporarily locked out due to repeated authentication failures.', 'LOCKOUT');
  }

  // Rate limit check
  const apiKey = req.headers['x-api-key'];
  const identifier = apiKey ? `key:${apiKey}` : `ip:${ip}`;

  const result = rateLimiter.check(identifier);
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);

  if (!result.allowed) {
    res.setHeader('Retry-After', result.retryAfterSec);
    return res.error(429, `Too many requests. Please try again in ${result.retryAfterSec} seconds.`, 'RATE_LIMIT_EXCEEDED');
  }

  next();
}

// JSON Body Parser with size limits
function jsonBodyParser(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method) && !req.headers['content-length']) {
    req.body = {};
    return next();
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json') && req.headers['content-length']) {
    return res.error(415, 'Unsupported Media Type: expected application/json', 'UNSUPPORTED_MEDIA_TYPE');
  }

  let totalBytes = 0;
  const chunks = [];

  req.on('data', chunk => {
    totalBytes += chunk.length;
    if (totalBytes > config.maxBodySize) {
      res.error(413, `Payload Too Large: maximum allowed body size is ${config.maxBodySize} bytes`, 'PAYLOAD_TOO_LARGE');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (chunks.length === 0) {
      req.body = {};
      return next();
    }

    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = JSON.parse(raw);
      next();
    } catch (err) {
      res.error(400, 'Invalid JSON format in request body', 'INVALID_JSON');
    }
  });

  req.on('error', err => {
    res.error(400, `Stream read error: ${err.message}`, 'REQUEST_ERROR');
  });
}

// API Key Authentication middleware
function requireApiKey(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    rateLimiter.recordFailure(ip);
    return res.error(401, 'Unauthorized: Missing x-api-key header', 'UNAUTHORIZED');
  }

  const verification = authManager.verifyKey(apiKey);
  if (!verification.valid) {
    rateLimiter.recordFailure(ip);
    return res.error(401, verification.reason, 'UNAUTHORIZED');
  }

  rateLimiter.recordSuccess(ip);
  req.auth = {
    keyId: verification.keyId,
    name: verification.name
  };

  next();
}

// Pipeline Runner
function runMiddlewares(middlewares, req, res, finalHandler) {
  let index = 0;

  function next(err) {
    if (err) {
      logger.error('Middleware failure:', { error: err.message, stack: err.stack });
      return res.error(500, 'Internal Server Error', 'INTERNAL_SERVER_ERROR');
    }

    if (index < middlewares.length) {
      const current = middlewares[index++];
      try {
        current(req, res, next);
      } catch (e) {
        next(e);
      }
    } else {
      try {
        finalHandler(req, res);
      } catch (e) {
        logger.error('Handler execution error:', { error: e.message, stack: e.stack });
        const statusCode = e.statusCode || 500;
        const msg = statusCode >= 500 ? 'Internal Server Error' : e.message;
        res.error(statusCode, msg, 'HANDLER_ERROR', e.validationErrors || null);
      }
    }
  }

  next();
}

module.exports = {
  securityHeaders,
  cors,
  rateLimit,
  jsonBodyParser,
  requireApiKey,
  runMiddlewares
};

'use strict';

/**
 * Custom Zero-Dependency HTTP & HTTPS Server
 * Features: Port 80 -> 443 redirect, dynamic TLS hot-reload, compression, middleware, and graceful shutdown.
 */

const http = require('http');
const https = require('https');
const path = require('path');
const config = require('../config');
const Router = require('./router');
const { attachResponseHelpers } = require('./response');
const { compressionMiddleware } = require('./compression');
const {
  securityHeaders,
  cors,
  rateLimit,
  jsonBodyParser,
  requireApiKey,
  runMiddlewares
} = require('./middleware');
const { logger } = require('../security/logger');
const CertManager = require('../certs/cert-manager');
const { renderDocsHtml } = require('./docs');
const { serveStatic, PUBLIC_DIR } = require('./static');
const { handleHealth } = require('../api/health');
const { registerNotesRoutes } = require('../api/notes');
const { registerProjectRoutes, PROJECTS_DIR } = require('../api/projects');

class ApiServer {
  constructor() {
    this.router = new Router();
    this.certManager = new CertManager();
    this.httpServer = null;
    this.httpsServer = null;

    this.activeHttpPort = config.port;
    this.activeHttpsPort = config.httpsPort;

    this.setupRoutes();
  }

  setupRoutes() {
    // 1. Public Health Check
    this.router.get('/health', handleHealth, {
      summary: 'Public Health Check',
      description: 'Returns server operational status, uptime, system metrics, and database health.',
      auth: false,
      tags: ['System']
    });

    // 2. Interactive API Documentation
    const docsHandler = (req, res) => {
      const html = renderDocsHtml(this.router, config.domain, this.activeHttpsPort);
      res.sendHtml(200, html);
    };

    this.router.get('/docs', docsHandler, {
      summary: 'API Documentation',
      description: 'Interactive HTML documentation with runnable curl commands.',
      auth: false,
      tags: ['Documentation']
    });

    // 3. Register Notes CRUD routes
    registerNotesRoutes(this.router);

    // 4. Register Project Deployment routes
    registerProjectRoutes(this.router);
  }

  handleRequest(req, res) {
    const startTime = Date.now();
    attachResponseHelpers(req, res);

    // Track request completion for access logging
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      logger.access(req, res, durationMs);
    });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    req.query = this.router.parseQuery(req.url);

    // Match route
    const match = this.router.match(req.method, pathname);

    if (!match) {
      // Try serving static files

      // 1. Dashboard UI at /dashboard/*
      if (pathname === '/' || pathname.startsWith('/dashboard')) {
        securityHeaders(req, res, () => {
          const dashboardDir = path.join(PUBLIC_DIR, 'dashboard');
          const dashReq = { ...req, url: pathname === '/' ? '/index.html' : pathname.replace('/dashboard', '') || '/index.html' };
          const served = serveStatic(dashReq, res, dashboardDir);
          if (!served) {
            // Serve index.html as SPA fallback
            dashReq.url = '/index.html';
            if (!serveStatic(dashReq, res, dashboardDir)) {
              res.error(404, 'Dashboard file not found', 'NOT_FOUND');
            }
          }
        });
        return;
      }

      // 2. Deployed projects at /projects/*
      if (pathname.startsWith('/projects/')) {
        securityHeaders(req, res, () => {
          const projReq = { ...req, url: pathname.replace('/projects', '') };
          if (!serveStatic(projReq, res, PROJECTS_DIR)) {
            res.error(404, 'Project file not found', 'NOT_FOUND');
          }
        });
        return;
      }

      // 3. Generic public/* static file
      if (serveStatic(req, res)) {
        return;
      }

      // 404 fallback
      securityHeaders(req, res, () => {
        cors(req, res, () => {
          res.error(404, `Route ${req.method} ${pathname} not found`, 'NOT_FOUND');
        });
      });
      return;
    }

    req.params = match.params;

    // Build middleware pipeline
    const pipeline = [
      securityHeaders,
      cors,
      compressionMiddleware,
      rateLimit
    ];

    // Require API Key if route is protected
    if (match.route.meta.auth) {
      pipeline.push(requireApiKey);
    }

    // Parse body for mutations
    pipeline.push(jsonBodyParser);

    // Execute pipeline
    runMiddlewares(pipeline, req, res, match.handler);
  }

  startHttpRedirect(port) {
    this.httpServer = http.createServer((req, res) => {
      // Redirect all HTTP requests to HTTPS
      const host = (req.headers.host || config.domain).split(':')[0];
      const targetPort = this.activeHttpsPort === 443 ? '' : `:${this.activeHttpsPort}`;
      const targetUrl = `https://${host}${targetPort}${req.url}`;

      res.writeHead(301, {
        Location: targetUrl,
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
      });
      res.end(`Redirecting to ${targetUrl}`);
    });

    this.httpServer.on('error', (err) => {
      if (err.code === 'EACCES' && port === 80) {
        console.warn(`[HTTP] Port 80 requires administrator permissions. Falling back to port ${config.fallbackPort}`);
        this.activeHttpPort = config.fallbackPort;
        this.startHttpRedirect(config.fallbackPort);
      } else {
        logger.error(`HTTP server error: ${err.message}`);
      }
    });

    this.httpServer.listen(port, config.host, () => {
      this.activeHttpPort = port;
      console.log(`[HTTP] Port ${port} active (Auto-redirecting to HTTPS)`);
    });
  }

  startHttps(port) {
    const tlsOptions = this.certManager.getTlsOptions();
    if (!tlsOptions) {
      console.warn('[HTTPS] No TLS certificates available. Serving plain HTTP on main port.');
      this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
      this.httpServer.listen(port, config.host, () => {
        console.log(`[HTTP FALLBACK] Listening on http://${config.host}:${port}`);
      });
      return;
    }

    this.httpsServer = https.createServer(tlsOptions, (req, res) => this.handleRequest(req, res));

    this.httpsServer.on('error', (err) => {
      if (err.code === 'EACCES' && port === 443) {
        console.warn(`[HTTPS] Port 443 requires administrator permissions. Falling back to port ${config.fallbackHttpsPort}`);
        this.activeHttpsPort = config.fallbackHttpsPort;
        this.startHttps(config.fallbackHttpsPort);
      } else {
        logger.error(`HTTPS server error: ${err.message}`);
      }
    });

    this.httpsServer.listen(port, config.host, () => {
      this.activeHttpsPort = port;
      console.log(`[HTTPS] Secure API Server active on https://${config.domain}:${port}`);
      console.log(`[HTTPS] Local endpoint: https://localhost:${port}`);
      console.log(`[DOCS] API Documentation: https://localhost:${port}/docs`);

      // Attach TLS watcher for zero-downtime hot reloading
      this.certManager.watchAndHotReload(this.httpsServer);
    });
  }

  start() {
    this.startHttpRedirect(this.activeHttpPort);
    this.startHttps(this.activeHttpsPort);
  }

  stop(callback) {
    let pending = 0;
    const done = () => {
      pending--;
      if (pending <= 0 && callback) callback();
    };

    if (this.httpServer) {
      pending++;
      this.httpServer.close(done);
    }
    if (this.httpsServer) {
      pending++;
      this.httpsServer.close(done);
    }
    this.certManager.close();

    if (pending === 0 && callback) callback();
  }
}

module.exports = ApiServer;

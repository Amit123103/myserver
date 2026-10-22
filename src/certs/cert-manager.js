'use strict';

/**
 * Custom Zero-Dependency TLS Certificate Manager & Hot-Reloader
 * Creates secure contexts and dynamically updates HTTPS server without downtime.
 */

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const config = require('../config');
const CertificateGenerator = require('./ca-gen');
const { logger } = require('../security/logger');

class CertManager {
  constructor(certsDir = config.paths.certs) {
    this.certsDir = certsDir;
    this.keyPath = path.join(this.certsDir, 'server.key');
    this.crtPath = path.join(this.certsDir, 'server.crt');
    this.caPath = path.join(this.certsDir, 'ca.crt');

    this.serverInstance = null;
    this.watcher = null;

    this.ensureCertificates();
  }

  ensureCertificates() {
    if (!fs.existsSync(this.keyPath) || !fs.existsSync(this.crtPath)) {
      console.log('[CERTS] No server certificate found. Automatically initializing private Root CA and certificates...');
      const gen = new CertificateGenerator(this.certsDir);
      try {
        gen.generateServerCert(config.domain);
      } catch (err) {
        console.warn('[CERTS] Automatic certificate generation failed:', err.message);
      }
    }
  }

  hasCertificates() {
    return fs.existsSync(this.keyPath) && fs.existsSync(this.crtPath);
  }

  getTlsOptions() {
    if (!this.hasCertificates()) {
      return null;
    }

    try {
      const key = fs.readFileSync(this.keyPath);
      const cert = fs.readFileSync(this.crtPath);
      const ca = fs.existsSync(this.caPath) ? fs.readFileSync(this.caPath) : undefined;

      return {
        key,
        cert,
        ...(ca ? { ca } : {}),
        minVersion: 'TLSv1.2',
        ciphers: [
          'ECDHE-ECDSA-AES128-GCM-SHA256',
          'ECDHE-RSA-AES128-GCM-SHA256',
          'ECDHE-ECDSA-AES256-GCM-SHA384',
          'ECDHE-RSA-AES256-GCM-SHA384',
          'DHE-RSA-AES128-GCM-SHA256'
        ].join(':')
      };
    } catch (err) {
      logger.error('Failed to read TLS certificate options:', { error: err.message });
      return null;
    }
  }

  createSecureContext() {
    const opts = this.getTlsOptions();
    if (!opts) return null;
    return tls.createSecureContext(opts);
  }

  watchAndHotReload(httpsServer) {
    this.serverInstance = httpsServer;

    try {
      // Watch certs directory for file updates
      this.watcher = fs.watch(this.certsDir, (eventType, filename) => {
        if (filename === 'server.crt' || filename === 'server.key') {
          console.log(`[CERTS] Certificate change detected (${filename}). Hot-reloading TLS context...`);
          try {
            const newContext = this.createSecureContext();
            if (newContext && this.serverInstance) {
              this.serverInstance.setSecureContext(newContext);
              logger.info('HTTPS TLS context reloaded successfully without connection drop.');
              console.log('[CERTS] Hot-reload complete: new certificate is active.');
            }
          } catch (err) {
            logger.error('Failed to hot-reload TLS context:', { error: err.message });
          }
        }
      });
      this.watcher.unref();
    } catch (err) {
      console.warn('[CERTS] File watcher could not be attached:', err.message);
    }
  }

  close() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = CertManager;

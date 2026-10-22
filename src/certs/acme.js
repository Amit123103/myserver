'use strict';

/**
 * Custom Zero-Dependency ACME Client (RFC 8555)
 * Enables obtaining and auto-renewing free Let's Encrypt SSL/TLS certificates using Node's built-in 'https' and 'crypto'.
 * NOTE: Obtaining public certificates requires a registered public domain and port 80 open to the world.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { base64urlEncode } = require('../security/jwt');

class AcmeClient {
  constructor(options = {}) {
    this.directoryUrl = options.directoryUrl || config.acme.directoryUrl;
    this.email = options.email || config.acme.email;
    this.domain = options.domain || config.domain;
    this.certsDir = options.certsDir || config.paths.certs;

    this.accountKeyPath = path.join(this.certsDir, 'acme-account.key');
    this.challenges = new Map(); // token -> keyAuthorization

    this.accountKey = null;
    this.directory = null;
    this.replayNonce = null;
    this.accountUrl = null;
  }

  // HTTP-01 challenge response handler to attach to HTTP router
  handleChallenge(token) {
    return this.challenges.get(token) || null;
  }

  ensureAccountKey() {
    if (fs.existsSync(this.accountKeyPath)) {
      this.accountKey = crypto.createPrivateKey(fs.readFileSync(this.accountKeyPath));
    } else {
      console.log('[ACME] Generating new 2048-bit RSA Account Key...');
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      fs.writeFileSync(this.accountKeyPath, privateKey, 'utf8');
      this.accountKey = crypto.createPrivateKey(privateKey);
    }
  }

  async request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const reqOpts = {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'myserver-acme/1.0',
          ...(options.headers || {})
        }
      };

      const req = https.request(reqOpts, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          // Update replay nonce if present
          if (res.headers['replay-nonce']) {
            this.replayNonce = res.headers['replay-nonce'];
          }

          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch (_) {
            parsed = body;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
          } else {
            reject(new Error(`ACME HTTP ${res.statusCode}: ${typeof parsed === 'object' ? JSON.stringify(parsed) : parsed}`));
          }
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  async getDirectory() {
    if (!this.directory) {
      const res = await this.request(this.directoryUrl);
      this.directory = res.body;
    }
    return this.directory;
  }

  async getNonce() {
    if (this.replayNonce) {
      const nonce = this.replayNonce;
      this.replayNonce = null;
      return nonce;
    }
    const dir = await this.getDirectory();
    const res = await this.request(dir.newNonce, { method: 'HEAD' });
    return res.headers['replay-nonce'];
  }

  getThumbprint() {
    const jwk = this.accountKey.export({ format: 'jwk' });
    // Canonical JSON format for thumbprint: {"e":"...","kty":"RSA","n":"..."}
    const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
    return base64urlEncode(crypto.createHash('sha256').update(canonical).digest());
  }

  async signedRequest(url, payload) {
    const nonce = await this.getNonce();
    const jwk = this.accountKey.export({ format: 'jwk' });

    const header = {
      alg: 'RS256',
      nonce,
      url
    };

    if (this.accountUrl) {
      header.kid = this.accountUrl;
    } else {
      header.jwk = { e: jwk.e, kty: jwk.kty, n: jwk.n };
    }

    const encHeader = base64urlEncode(JSON.stringify(header));
    const encPayload = payload === '' ? '' : base64urlEncode(JSON.stringify(payload));
    const signInput = `${encHeader}.${encPayload}`;

    const sign = crypto.createSign('SHA256');
    sign.update(signInput);
    sign.end();
    const signature = base64urlEncode(sign.sign(this.accountKey));

    const jwsBody = {
      protected: encHeader,
      payload: encPayload,
      signature
    };

    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/jose+json' },
      body: JSON.stringify(jwsBody)
    });
  }

  async registerAccount() {
    this.ensureAccountKey();
    const dir = await this.getDirectory();

    const payload = {
      termsOfServiceAgreed: true,
      contact: [`mailto:${this.email}`]
    };

    const res = await this.signedRequest(dir.newAccount, payload);
    this.accountUrl = res.headers.location;
    return this.accountUrl;
  }
}

module.exports = AcmeClient;

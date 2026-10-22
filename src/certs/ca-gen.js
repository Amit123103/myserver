'use strict';

/**
 * Custom Certificate Authority & Server Certificate Generator
 * Uses system OpenSSL (cross-platform: Windows, Linux, macOS) to issue a private Root CA
 * and signed server certificates with Subject Alternative Names (SAN).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const config = require('../config');

class CertificateGenerator {
  constructor(certsDir = config.paths.certs) {
    this.certsDir = certsDir;
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.certsDir)) {
      fs.mkdirSync(this.certsDir, { recursive: true });
    }
  }

  getLocalIps() {
    const interfaces = os.networkInterfaces();
    const ips = ['127.0.0.1'];

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push(net.address);
        }
      }
    }

    return ips;
  }

  getOpenSslCommand() {
    // 1. Try standard openssl in PATH
    try {
      execSync('openssl version', { stdio: 'ignore' });
      return 'openssl';
    } catch (_) {}

    // 2. Check common Windows locations
    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
        'C:\\OpenSSL-Win64\\bin\\openssl.exe'
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return `"${p}"`;
        }
      }
    }

    return 'openssl'; // fallback
  }

  isOpenSslAvailable() {
    try {
      const cmd = this.getOpenSslCommand();
      execSync(`${cmd} version`, { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  }

  generateCA() {
    this.ensureDirs();
    const caKeyPath = path.join(this.certsDir, 'ca.key');
    const caCrtPath = path.join(this.certsDir, 'ca.crt');

    if (fs.existsSync(caKeyPath) && fs.existsSync(caCrtPath)) {
      console.log('[CERTS] Root CA already exists at:', caCrtPath);
      return { keyPath: caKeyPath, crtPath: caCrtPath };
    }

    const cmd = this.getOpenSslCommand();
    console.log('[CERTS] Generating Private Root Certificate Authority (CA)...');

    // 1. Generate CA Private Key (4096-bit RSA)
    execSync(`${cmd} genrsa -out "${caKeyPath}" 4096`, { stdio: 'inherit' });

    // 2. Generate Self-Signed Root CA Certificate (valid for 10 years / 3650 days)
    const subject = '/C=US/ST=Local/L=Local/O=MyServer/OU=DevOps/CN=MyServer-Root-CA';
    execSync(
      `${cmd} req -x509 -new -nodes -key "${caKeyPath}" -sha256 -days 3650 -out "${caCrtPath}" -subj "${subject}"`,
      { stdio: 'inherit' }
    );

    console.log('[CERTS] Root CA created successfully!');
    console.log(`[CERTS] Root CA Certificate: ${caCrtPath}`);
    console.log(`[CERTS] Root CA Key: ${caKeyPath}`);

    return { keyPath: caKeyPath, crtPath: caCrtPath };
  }

  generateServerCert(domain = config.domain) {
    this.ensureDirs();
    const caKeyPath = path.join(this.certsDir, 'ca.key');
    const caCrtPath = path.join(this.certsDir, 'ca.crt');

    if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCrtPath)) {
      this.generateCA();
    }

    const serverKeyPath = path.join(this.certsDir, 'server.key');
    const serverCsrPath = path.join(this.certsDir, 'server.csr');
    const serverCrtPath = path.join(this.certsDir, 'server.crt');
    const extFilePath = path.join(this.certsDir, 'server.ext');

    const cmd = this.getOpenSslCommand();
    console.log(`[CERTS] Generating Server Certificate for domain: ${domain}...`);

    // 1. Generate Server Private Key (2048-bit RSA)
    execSync(`${cmd} genrsa -out "${serverKeyPath}" 2048`, { stdio: 'inherit' });

    // 2. Generate Certificate Signing Request (CSR)
    const subject = `/C=US/ST=Local/L=Local/O=MyServer/CN=${domain}`;
    execSync(
      `${cmd} req -new -key "${serverKeyPath}" -out "${serverCsrPath}" -subj "${subject}"`,
      { stdio: 'inherit' }
    );

    // 3. Create OpenSSL Extension file with Subject Alternative Names (SAN)
    const localIps = this.getLocalIps();
    const sanList = [
      `DNS.1 = ${domain}`,
      `DNS.2 = localhost`,
      `DNS.3 = *.${domain}`
    ];

    localIps.forEach((ip, idx) => {
      sanList.push(`IP.${idx + 1} = ${ip}`);
    });

    const extContent = `
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
${sanList.join('\n')}
`;

    fs.writeFileSync(extFilePath, extContent.trim(), 'utf8');

    // 4. Sign the Server Certificate with our Root CA
    execSync(
      `${cmd} x509 -req -in "${serverCsrPath}" -CA "${caCrtPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${serverCrtPath}" -days 825 -sha256 -extfile "${extFilePath}"`,
      { stdio: 'inherit' }
    );

    // Cleanup temporary files
    if (fs.existsSync(serverCsrPath)) fs.unlinkSync(serverCsrPath);
    if (fs.existsSync(extFilePath)) fs.unlinkSync(extFilePath);

    console.log('[CERTS] Server Certificate successfully signed by Root CA!');
    console.log(`[CERTS] Certificate: ${serverCrtPath}`);
    console.log(`[CERTS] Private Key: ${serverKeyPath}`);

    return {
      keyPath: serverKeyPath,
      crtPath: serverCrtPath,
      caPath: caCrtPath
    };
  }
}

module.exports = CertificateGenerator;

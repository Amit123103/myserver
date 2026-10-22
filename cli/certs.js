#!/usr/bin/env node
'use strict';

/**
 * Certificate Authority & SSL/TLS Management CLI
 * Usage:
 *   node cli/certs.js ca
 *   node cli/certs.js server [domain]
 *   node cli/certs.js trust
 */

const path = require('path');
const config = require('../src/config');
const CertificateGenerator = require('../src/certs/ca-gen');

const [,, command, ...args] = process.argv;
const gen = new CertificateGenerator(config.paths.certs);

function printTrustInstructions() {
  const caPath = path.join(config.paths.certs, 'ca.crt');
  console.log(`
================================================================================
HOW TO TRUST YOUR PRIVATE ROOT CA CERTIFICATE ON YOUR DEVICES
================================================================================
Your Root CA file is located at:
  ${caPath}

Once installed on a device, all browsers (Chrome, Edge, Safari) and apps on that
device will automatically trust your server with a valid green HTTPS padlock!

--- WINDOWS 11 ---
Option 1: Using PowerShell (Administrator):
  Import-Certificate -FilePath "${caPath}" -CertStoreLocation Cert:\\LocalMachine\\Root

Option 2: Using the GUI:
  1. Double-click "ca.crt" in Windows Explorer.
  2. Click "Install Certificate...".
  3. Select "Local Machine" and click Next.
  4. Choose "Place all certificates in the following store".
  5. Click Browse and select "Trusted Root Certification Authorities".
  6. Click OK, Next, and Finish. Restart your browser.

--- macOS ---
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caPath}"

--- iOS (iPhone / iPad) ---
  1. AirDrop or email "ca.crt" to your device and tap to download.
  2. Go to Settings > Profile Downloaded > Install.
  3. Go to Settings > General > About > Certificate Trust Settings.
  4. Under "Enable full trust for root certificates", turn ON your CA switch.

--- ANDROID ---
  1. Transfer "ca.crt" to phone storage.
  2. Go to Settings > Security > Encryption & Credentials > Install a certificate > CA certificate.
  3. Select "ca.crt" and confirm.

--- LINUX (Ubuntu / Debian) ---
  sudo cp "${caPath}" /usr/local/share/ca-certificates/myserver-ca.crt
  sudo update-ca-certificates
================================================================================
`);
}

switch (command) {
  case 'ca': {
    gen.generateCA();
    printTrustInstructions();
    break;
  }

  case 'server': {
    const domain = args[0] || config.domain;
    gen.generateServerCert(domain);
    break;
  }

  case 'trust': {
    printTrustInstructions();
    break;
  }

  default:
    console.log(`
myserver Certificate CLI
------------------------
Usage:
  node cli/certs.js ca               Generate a private 4096-bit Root CA
  node cli/certs.js server [domain]  Generate a server certificate signed by your Root CA
  node cli/certs.js trust            Show step-by-step device trust installation instructions
`);
    break;
}

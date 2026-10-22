#!/usr/bin/env node
'use strict';

/**
 * API Key Management CLI
 * Usage:
 *   node cli/keys.js create "My Laptop"
 *   node cli/keys.js list
 *   node cli/keys.js revoke <keyId>
 *   node cli/keys.js rotate <keyId>
 */

const { authManager } = require('../src/security/auth');

const [,, command, ...args] = process.argv;

function printUsage() {
  console.log(`
myserver API Key Manager
------------------------
Usage:
  node cli/keys.js create [name]    Generate a new API key (hashed before storage)
  node cli/keys.js list             List all API keys (masked)
  node cli/keys.js revoke <id>      Revoke access for an API key
  node cli/keys.js rotate <id>      Revoke existing key and issue a new replacement

Examples:
  node cli/keys.js create "Production Web App"
  node cli/keys.js list
  node cli/keys.js revoke b3e91f42-45e2-479c-859a-1158a1d044ee
`);
}

switch (command) {
  case 'create': {
    const name = args.join(' ') || 'Default Key';
    const result = authManager.createKey(name);
    console.log('\n=======================================================');
    console.log('API KEY GENERATED SUCCESSFULLY');
    console.log('=======================================================');
    console.log(`Key ID   : ${result.id}`);
    console.log(`Name     : ${result.name}`);
    console.log(`Created  : ${result.createdAt}`);
    console.log(`\nRaw Key  : ${result.rawKey}`);
    console.log('\n⚠️  SAVE THIS KEY NOW! The raw key will never be shown again.');
    console.log('Only its cryptographically secure SHA-256 hash is stored on disk.');
    console.log('=======================================================\n');
    break;
  }

  case 'list': {
    const keys = authManager.listKeys();
    console.log('\nConfigured API Keys:');
    console.log('-----------------------------------------------------------------------------------------');
    console.log('ID                                     NAME             PREFIX     STATUS    LAST USED');
    console.log('-----------------------------------------------------------------------------------------');
    if (keys.length === 0) {
      console.log('No keys found. Run "node cli/keys.js create" to create one.');
    } else {
      for (const k of keys) {
        const id = k.id.padEnd(38);
        const name = (k.name || '').substring(0, 15).padEnd(17);
        const prefix = (k.prefix || '').padEnd(11);
        const status = k.status === 'active' ? '\x1b[32mactive\x1b[0m  ' : '\x1b[31mrevoked\x1b[0m ';
        const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never';
        console.log(`${id} ${name} ${prefix} ${status} ${lastUsed}`);
      }
    }
    console.log('-----------------------------------------------------------------------------------------\n');
    break;
  }

  case 'revoke': {
    const keyId = args[0];
    if (!keyId) {
      console.error('Error: Please provide a key ID to revoke.');
      process.exit(1);
    }
    try {
      const revoked = authManager.revokeKey(keyId);
      console.log(`\nKey '${revoked.name}' (${keyId}) has been successfully REVOKED.\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    break;
  }

  case 'rotate': {
    const keyId = args[0];
    if (!keyId) {
      console.error('Error: Please provide a key ID to rotate.');
      process.exit(1);
    }
    try {
      const newKey = authManager.rotateKey(keyId);
      console.log(`\nKey ${keyId} revoked and new rotated key created:`);
      console.log(`New Key ID: ${newKey.id}`);
      console.log(`New Raw Key: ${newKey.rawKey}\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    break;
  }

  default:
    printUsage();
    break;
}

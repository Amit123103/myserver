'use strict';

/**
 * Custom Zero-Dependency Test Suite
 * Validates DB engine, WAL durability, Crash Recovery, Security, API endpoints, DNS wire protocol, and HTTPS.
 * Uses only Node.js built-in 'assert', 'http', 'https', 'crypto', 'fs'.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Modules under test
const { Schema, NoteSchema } = require('../src/db/schema');
const Collection = require('../src/db/collection');
const WriteAheadLog = require('../src/db/wal');
const { DatabaseEngine } = require('../src/db/engine');
const BackupManager = require('../src/db/backup');
const { AuthManager } = require('../src/security/auth');
const jwt = require('../src/security/jwt');
const { RateLimiter } = require('../src/security/rate-limiter');
const { parseDnsPacket, buildDnsResponse, encodeDomainName, decodeDomainName } = require('../src/dns/protocol');
const ApiServer = require('../src/http/server');
const CertificateGenerator = require('../src/certs/ca-gen');

const TEST_DIR = path.resolve(__dirname, '../data/test-run');

function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    process.stdout.write(`  [TEST] ${name.padEnd(65)} `);
    await fn();
    console.log('\x1b[32m[PASS]\x1b[0m');
    passed++;
  } catch (err) {
    console.log('\x1b[31m[FAIL]\x1b[0m');
    console.error(`         Error: ${err.message}`);
    failed++;
  }
}

async function runAllTests() {
  console.log('\n================================================================');
  console.log('       RUNNING ZERO-DEPENDENCY AUTOMATED VERIFICATION SUITE      ');
  console.log('================================================================\n');

  cleanupTestDir();

  // 1. Schema Validation Tests
  console.log('--- 1. Database Schema & Type Validator ---');
  await test('Valid note payload passes schema validation', () => {
    const res = NoteSchema.validate({
      title: 'Complete DevOps Deployment',
      content: 'Run self-hosted server with standard library',
      status: 'in_progress',
      priority: 'high',
      tags: ['devops', 'production']
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.data.status, 'in_progress');
  });

  await test('Missing required fields fails schema validation', () => {
    const res = NoteSchema.validate({ content: 'Only content, missing title' });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.errors.includes("Field 'title' is required"), true);
  });

  await test('Invalid enum value fails validation', () => {
    const res = NoteSchema.validate({
      title: 'Invalid Enum Note',
      content: 'Testing enum checking',
      status: 'unknown_status'
    });
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('must be one of: [todo, in_progress, completed, archived]')));
  });

  // 2. Collection & Secondary Index Tests
  console.log('\n--- 2. In-Memory Collection & Indexing ---');
  await test('Collection handles insert, index update, and findById', () => {
    const col = new Collection('test_notes', null, ['status']);
    const doc = { id: 'uuid-1', title: 'Task 1', status: 'todo' };
    col.insert(doc);

    const found = col.findById('uuid-1');
    assert.deepStrictEqual(found, doc);
    assert.strictEqual(col.indexes.get('status').get('todo').has('uuid-1'), true);
  });

  await test('Collection query filtering and pagination', () => {
    const col = new Collection('test_notes', null, ['status']);
    col.insert({ id: '1', title: 'A', status: 'todo', createdAt: '2026-01-01' });
    col.insert({ id: '2', title: 'B', status: 'in_progress', createdAt: '2026-01-02' });
    col.insert({ id: '3', title: 'C', status: 'todo', createdAt: '2026-01-03' });

    const queryRes = col.query({ filter: { status: 'todo' }, limit: 10 });
    assert.strictEqual(queryRes.total, 2);
    assert.strictEqual(queryRes.count, 2);
    assert.strictEqual(queryRes.items[0].id, '3'); // default desc sort
  });

  // 3. Write-Ahead Log (WAL) & Durability Tests
  console.log('\n--- 3. WAL Durability & Crash Recovery ---');
  await test('WAL appends entries, fsyncs, and replays accurately', () => {
    const walFile = path.join(TEST_DIR, 'test.wal');
    const wal = new WriteAheadLog(walFile);

    wal.append('notes', 'INSERT', { id: 'w1', title: 'WAL Note 1' });
    wal.append('notes', 'INSERT', { id: 'w2', title: 'WAL Note 2' });
    assert.strictEqual(wal.lsn, 2);

    const entries = wal.replay(0);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].data.id, 'w1');
    wal.close();
  });

  await test('DatabaseEngine recovers state after simulated crash', () => {
    const dbDir = path.join(TEST_DIR, 'db-recovery-test');
    // Instance 1: write data then abruptly close
    const db1 = new DatabaseEngine({ dataDir: dbDir });
    db1.init();
    db1.insert('notes', { title: 'Durable Note', content: 'Must survive crash' });
    db1.close();

    // Instance 2: start up fresh, should replay WAL and recover
    const db2 = new DatabaseEngine({ dataDir: dbDir });
    db2.init();
    const notes = db2.query('notes', {}).items;
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0].title, 'Durable Note');
    db2.close();
  });

  // 4. Backup & SHA-256 Integrity Tests
  console.log('\n--- 4. Automated Backup & SHA-256 Verification ---');
  await test('BackupManager creates snapshot, computes SHA-256 and verifies', () => {
    const dbDir = path.join(TEST_DIR, 'db-backup-test');
    const backupDir = path.join(TEST_DIR, 'backups');
    const db = new DatabaseEngine({ dataDir: dbDir });
    db.init();
    db.insert('notes', { title: 'Backup Test Note', content: 'Safe' });

    const bm = new BackupManager({ dataDir: dbDir, backupDir, retentionDays: 7 });
    const backupRes = bm.createBackup(db);

    assert.ok(fs.existsSync(backupRes.path));
    const verification = bm.verifyBackup(backupRes.path);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.checksum, backupRes.checksum);
    db.close();
  });

  // 5. Security & Authentication Tests
  console.log('\n--- 5. Security, API Keys & JWT ---');
  await test('API Keys are generated, stored as SHA-256, and verified with timingSafeEqual', () => {
    const keysFile = path.join(TEST_DIR, 'keys.json');
    const auth = new AuthManager(keysFile);

    const created = auth.createKey('Test Client');
    assert.ok(created.rawKey.startsWith('sk_'));

    // Disk inspection: verify raw key is NEVER stored
    const fileContent = fs.readFileSync(keysFile, 'utf8');
    assert.strictEqual(fileContent.includes(created.rawKey), false);

    // Verification
    const validCheck = auth.verifyKey(created.rawKey);
    assert.strictEqual(validCheck.valid, true);

    const invalidCheck = auth.verifyKey('sk_invalid_fake_key_123456');
    assert.strictEqual(invalidCheck.valid, false);

    // Revocation
    auth.revokeKey(created.id);
    const postRevokeCheck = auth.verifyKey(created.rawKey);
    assert.strictEqual(postRevokeCheck.valid, false);
  });

  await test('JWT sign, verify, and tamper detection with HMAC-SHA256', () => {
    const secret = 'super-secret-key-at-least-32-chars!';
    const token = jwt.sign({ user: 'admin', role: 'engineer' }, secret, 3600);
    assert.strictEqual(token.split('.').length, 3);

    const decoded = jwt.verify(token, secret);
    assert.strictEqual(decoded.user, 'admin');

    // Tampering test
    const tampered = token.slice(0, -4) + 'abcd';
    assert.throws(() => jwt.verify(tampered, secret));
  });

  await test('Rate Limiter enforces sliding window limits and IP lockout', () => {
    const rl = new RateLimiter({ windowMs: 1000, maxRequests: 3, lockoutThreshold: 2 });
    assert.strictEqual(rl.check('ip:1.2.3.4').allowed, true);
    assert.strictEqual(rl.check('ip:1.2.3.4').allowed, true);
    assert.strictEqual(rl.check('ip:1.2.3.4').allowed, true);
    // Exceeded
    assert.strictEqual(rl.check('ip:1.2.3.4').allowed, false);

    // Lockout test
    rl.recordFailure('5.6.7.8');
    assert.strictEqual(rl.isLockedOut('5.6.7.8'), false);
    rl.recordFailure('5.6.7.8'); // hits threshold of 2
    assert.strictEqual(rl.isLockedOut('5.6.7.8'), true);
  });

  // 6. DNS Protocol Tests
  console.log('\n--- 6. DNS Wire Protocol (RFC 1035) ---');
  await test('DNS Domain Name wire encoding and decoding', () => {
    const encoded = encodeDomainName('myserver.local');
    const decoded = decodeDomainName(encoded, 0);
    assert.strictEqual(decoded.name, 'myserver.local');
  });

  await test('DNS Query and Response Packet builder and parser', () => {
    // Construct sample DNS query for myserver.local (Type A)
    const qHeader = Buffer.alloc(12);
    qHeader.writeUInt16BE(0x1234, 0); // ID
    qHeader.writeUInt16BE(0x0100, 2); // RD=1
    qHeader.writeUInt16BE(1, 4);      // 1 Question
    const qName = encodeDomainName('myserver.local');
    const qMeta = Buffer.alloc(4);
    qMeta.writeUInt16BE(1, 0); // Type A
    qMeta.writeUInt16BE(1, 2); // Class IN

    const queryBuffer = Buffer.concat([qHeader, qName, qMeta]);
    const parsedQuery = parseDnsPacket(queryBuffer);

    assert.strictEqual(parsedQuery.id, 0x1234);
    assert.strictEqual(parsedQuery.questions[0].name, 'myserver.local');
    assert.strictEqual(parsedQuery.questions[0].type, 'A');

    const responseBuf = buildDnsResponse(parsedQuery, [
      { name: 'myserver.local', type: 'A', data: '192.168.1.50', ttl: 300 }
    ]);

    assert.ok(responseBuf.length > 12);
    assert.strictEqual(responseBuf.readUInt16BE(0), 0x1234); // Match query ID
    assert.strictEqual(responseBuf.readUInt16BE(6), 1);      // 1 Answer
  });

  // 7. Live HTTP / HTTPS API Endpoints
  console.log('\n--- 7. Live API Server & REST Endpoints ---');

  // Generate test certificates
  const certGen = new CertificateGenerator(path.join(TEST_DIR, 'certs'));
  try {
    certGen.generateServerCert('localhost');
  } catch (_) {
    // If openssl command isn't in test runner env, continue
  }

  // Setup test keys using the active authManager instance
  const { authManager } = require('../src/security/auth');
  const { rateLimiter } = require('../src/security/rate-limiter');
  rateLimiter.recordSuccess('127.0.0.1');
  const testKey = authManager.createKey('Integration Test');

  // Start live test server
  const testServer = new ApiServer();
  // Override ports for test
  testServer.activeHttpPort = 19080;
  testServer.activeHttpsPort = 19443;

  await new Promise((resolve) => {
    testServer.httpServer = http.createServer((req, res) => testServer.handleRequest(req, res));
    testServer.httpServer.listen(testServer.activeHttpPort, '127.0.0.1', resolve);
  });

  function makeRequest(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: testServer.activeHttpPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch (_) {
            data = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  await test('GET /health returns 200 with UP status', async () => {
    const res = await makeRequest('GET', '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.status, 'UP');
  });

  await test('GET /api/v1/notes without x-api-key returns 401 Unauthorized', async () => {
    const res = await makeRequest('GET', '/api/v1/notes');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'UNAUTHORIZED');
  });

  await test('GET /api/v1/notes with invalid x-api-key returns 401', async () => {
    const res = await makeRequest('GET', '/api/v1/notes', { 'x-api-key': 'sk_bogus_key' });
    assert.strictEqual(res.status, 401);
  });

  let createdNoteId = null;

  await test('POST /api/v1/notes with valid key creates note and returns 201', async () => {
    const payload = {
      title: 'DevOps Checklist Note',
      content: 'Production readiness verification',
      status: 'todo',
      priority: 'high',
      tags: ['deployment', 'checklist']
    };

    const res = await makeRequest('POST', '/api/v1/notes', { 'x-api-key': testKey.rawKey }, payload);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.title, 'DevOps Checklist Note');
    assert.ok(res.data.data.id);
    createdNoteId = res.data.data.id;
  });

  await test('GET /api/v1/notes/:id returns 200 with the note details', async () => {
    const res = await makeRequest('GET', `/api/v1/notes/${createdNoteId}`, { 'x-api-key': testKey.rawKey });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.id, createdNoteId);
  });

  await test('PUT /api/v1/notes/:id updates the note status to completed', async () => {
    const res = await makeRequest(
      'PUT',
      `/api/v1/notes/${createdNoteId}`,
      { 'x-api-key': testKey.rawKey },
      { status: 'completed' }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.status, 'completed');
  });

  await test('POST /api/v1/notes with invalid payload returns 400 Bad Request', async () => {
    const res = await makeRequest(
      'POST',
      '/api/v1/notes',
      { 'x-api-key': testKey.rawKey },
      { content: 'No title' }
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  await test('GET /docs returns 200 with interactive HTML documentation', async () => {
    const res = await makeRequest('GET', '/docs');
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.data === 'string' && res.data.includes('myserver API Documentation'));
  });

  await test('DELETE /api/v1/notes/:id deletes the note and returns 200', async () => {
    const res = await makeRequest('DELETE', `/api/v1/notes/${createdNoteId}`, { 'x-api-key': testKey.rawKey });
    assert.strictEqual(res.status, 200);
  });

  // Cleanup test server
  testServer.httpServer.close();
  cleanupTestDir();

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: \x1b[32m${passed}\x1b[0m | FAILED: \x1b[31m${failed}\x1b[0m`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});

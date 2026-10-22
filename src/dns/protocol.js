'use strict';

/**
 * Custom Zero-Dependency DNS Wire Protocol Parser & Builder (RFC 1035)
 * Handles binary DNS packet encoding and decoding for UDP/TCP.
 */

const RECORD_TYPES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  MX: 15,
  TXT: 16,
  AAAA: 28
};

const RECORD_CODES = Object.fromEntries(Object.entries(RECORD_TYPES).map(([k, v]) => [v, k]));

function decodeDomainName(buffer, offset) {
  const parts = [];
  let curr = offset;
  let jumped = false;
  let bytesRead = 0;

  while (true) {
    const len = buffer.readUInt8(curr);
    if (len === 0) {
      if (!jumped) bytesRead += 1;
      curr += 1;
      break;
    }

    // Pointer (compression)
    if ((len & 0xc0) === 0xc0) {
      const pointer = buffer.readUInt16BE(curr) & 0x3fff;
      if (!jumped) bytesRead += 2;
      jumped = true;
      curr = pointer;
      continue;
    }

    if (!jumped) bytesRead += 1 + len;
    curr += 1;
    parts.push(buffer.toString('utf8', curr, curr + len));
    curr += len;
  }

  return { name: parts.join('.'), bytesRead };
}

function encodeDomainName(domain) {
  if (!domain || domain === '.') return Buffer.from([0]);
  const parts = domain.split('.');
  const buffers = [];

  for (const part of parts) {
    const len = Buffer.byteLength(part);
    const buf = Buffer.alloc(1 + len);
    buf.writeUInt8(len, 0);
    buf.write(part, 1, 'utf8');
    buffers.push(buf);
  }

  buffers.push(Buffer.from([0])); // End of name
  return Buffer.concat(buffers);
}

function parseDnsPacket(buffer) {
  if (buffer.length < 12) {
    throw new Error('DNS packet too small for header');
  }

  const id = buffer.readUInt16BE(0);
  const flags = buffer.readUInt16BE(2);
  const qdCount = buffer.readUInt16BE(4);
  const anCount = buffer.readUInt16BE(6);
  const nsCount = buffer.readUInt16BE(8);
  const arCount = buffer.readUInt16BE(10);

  const qr = (flags >> 15) & 0x1;
  const opcode = (flags >> 11) & 0xf;
  const rd = (flags >> 8) & 0x1;

  let offset = 12;
  const questions = [];

  for (let i = 0; i < qdCount; i++) {
    const { name, bytesRead } = decodeDomainName(buffer, offset);
    offset += bytesRead;
    const qtype = buffer.readUInt16BE(offset);
    offset += 2;
    const qclass = buffer.readUInt16BE(offset);
    offset += 2;

    questions.push({
      name,
      type: RECORD_CODES[qtype] || qtype,
      typeCode: qtype,
      classCode: qclass
    });
  }

  return {
    id,
    flags,
    qr,
    opcode,
    rd,
    questions
  };
}

function buildDnsResponse(queryPacket, answers = []) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(queryPacket.id, 0);

  // Flags: QR=1 (Response), AA=1 (Authoritative), RA=1 (Recursion Available)
  let flags = 0x8180;
  header.writeUInt16BE(flags, 2);

  header.writeUInt16BE(queryPacket.questions.length, 4); // QDCOUNT
  header.writeUInt16BE(answers.length, 6); // ANCOUNT
  header.writeUInt16BE(0, 8); // NSCOUNT
  header.writeUInt16BE(0, 10); // ARCOUNT

  const chunks = [header];

  // Re-encode question
  for (const q of queryPacket.questions) {
    chunks.push(encodeDomainName(q.name));
    const qMeta = Buffer.alloc(4);
    qMeta.writeUInt16BE(q.typeCode, 0);
    qMeta.writeUInt16BE(q.classCode || 1, 2);
    chunks.push(qMeta);
  }

  // Encode answers
  for (const ans of answers) {
    chunks.push(encodeDomainName(ans.name));

    const typeCode = RECORD_TYPES[ans.type] || 1;
    const ttl = ans.ttl || 300;

    let rdataBuf = null;

    if (ans.type === 'A') {
      rdataBuf = Buffer.from(ans.data.split('.').map(n => parseInt(n, 10)));
    } else if (ans.type === 'TXT') {
      const txt = Buffer.from(ans.data, 'utf8');
      rdataBuf = Buffer.alloc(1 + txt.length);
      rdataBuf.writeUInt8(txt.length, 0);
      txt.copy(rdataBuf, 1);
    } else if (ans.type === 'CNAME' || ans.type === 'NS') {
      rdataBuf = encodeDomainName(ans.data);
    } else if (ans.type === 'MX') {
      const exchange = encodeDomainName(ans.data);
      rdataBuf = Buffer.alloc(2 + exchange.length);
      rdataBuf.writeUInt16BE(ans.priority || 10, 0);
      exchange.copy(rdataBuf, 2);
    } else {
      // Fallback A
      rdataBuf = Buffer.from([127, 0, 0, 1]);
    }

    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(typeCode, 0);
    meta.writeUInt16BE(1, 2); // IN class
    meta.writeUInt32BE(ttl, 4);
    meta.writeUInt16BE(rdataBuf.length, 8);

    chunks.push(meta);
    chunks.push(rdataBuf);
  }

  return Buffer.concat(chunks);
}

module.exports = {
  RECORD_TYPES,
  RECORD_CODES,
  parseDnsPacket,
  buildDnsResponse,
  encodeDomainName,
  decodeDomainName
};

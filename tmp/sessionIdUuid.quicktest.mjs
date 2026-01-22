// Quicktest: verify our sessionId generators produce UUIDs.
// - Client uses crypto.randomUUID() when available, else secure fallback.
// - Server uses node:crypto.randomUUID() or randomBytes fallback.

import * as crypto from 'node:crypto';

function isUuidV4(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));
}

// Mirrors server.js generateSessionId()
function serverGenerateSessionId() {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto?.randomBytes === 'function') {
      const bytes = crypto.randomBytes(16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytes.toString('hex');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* ignore */ }
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// Validate shape + uniqueness for a batch.
const n = 500;
const set = new Set();
for (let i = 0; i < n; i++) {
  const id = serverGenerateSessionId();
  assert(isUuidV4(id), `server sessionId is not UUIDv4: ${id}`);
  set.add(id);
}
assert(set.size === n, `server sessionId collisions: ${n - set.size}`);

console.log('PASS: sessionId UUIDv4 generation');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../lib/rateLimit.js';

function makeFakeRedis(overrides = {}) {
  const store = new Map();
  return {
    async incr(key) {
      const next = (store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire() { return 1; },
    ...overrides,
  };
}

const NOW = new Date('2026-06-30T12:00:00Z');

test('allows the first two requests, denies the third', async () => {
  const redis = makeFakeRedis();
  assert.deepEqual(await rateLimit('1.2.3.4', redis, NOW), { allowed: true, remaining: 1 });
  assert.deepEqual(await rateLimit('1.2.3.4', redis, NOW), { allowed: true, remaining: 0 });
  assert.deepEqual(await rateLimit('1.2.3.4', redis, NOW), { allowed: false, remaining: 0 });
});

test('tracks IPs independently', async () => {
  const redis = makeFakeRedis();
  await rateLimit('1.1.1.1', redis, NOW);
  assert.deepEqual(await rateLimit('2.2.2.2', redis, NOW), { allowed: true, remaining: 1 });
});

test('refreshes the daily TTL on every request', async () => {
  let expireCalls = 0;
  const redis = makeFakeRedis({ async expire() { expireCalls += 1; return 1; } });
  await rateLimit('9.9.9.9', redis, NOW);
  await rateLimit('9.9.9.9', redis, NOW);
  assert.equal(expireCalls, 2);
});

test('fails open when no Redis client is configured', async () => {
  assert.deepEqual(await rateLimit('1.2.3.4', null, NOW), { allowed: true, remaining: 999 });
});

test('fails open when Redis throws', async () => {
  const redis = makeFakeRedis({ async incr() { throw new Error('connection refused'); } });
  assert.deepEqual(await rateLimit('1.2.3.4', redis, NOW), { allowed: true, remaining: 999 });
});

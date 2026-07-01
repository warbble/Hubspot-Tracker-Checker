import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); });

test('serves the landing page at /', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /HubSpot/i);
});

test('POST /api/check with no url returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).status, 'error');
});

test('GET /api/check returns 405', async () => {
  const res = await fetch(`${baseUrl}/api/check`);
  assert.equal(res.status, 405);
});

test('POST /api/check with a non-JSON body returns 400, not 500', async () => {
  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not json',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).status, 'error');
});

test('POST /api/check with malformed JSON returns a clean 400 (no stack trace)', async () => {
  const res = await fetch(`${baseUrl}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ broken',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).status, 'error');
});

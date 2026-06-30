# Railway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the HubSpot Tracking Code Checker off Vercel onto Railway as a single long-running Express service backed by a Railway Redis instance, preserving all user-facing behavior.

**Architecture:** One Express process serves the static front end (`public/`) and the `POST /api/check` route. The per-request Vercel function becomes an exported handler mounted on Express. The Vercel-KV (Upstash REST) rate limiter is replaced by an ioredis-backed limiter talking to a Railway Redis service over TCP.

**Tech Stack:** Node.js (ESM) ≥18, Express, ioredis, built-in `node:test` runner, Railway (Nixpacks build + Redis service).

## Global Constraints

- Node ≥18; package is ESM (`"type": "module"` in `package.json`).
- Runtime dependencies limited to `express` and `ioredis`. No new dev dependencies — tests use the built-in `node:test` runner and global `fetch`.
- Rate-limit policy is unchanged: 2 checks per IP per day, **fail open** (allow when Redis is absent or errors), `DEBUG_KEY` bypass.
- The server must bind to `process.env.PORT` (Railway injects it).
- Front-end (`public/index.html`) and all detection/HubSpot logic in `api/check.js` stay behaviorally unchanged.
- Env vars: `BROWSERLESS_TOKEN`, `HUBSPOT_TOKEN`, `DEBUG_KEY` (optional), `REDIS_URL`. The `KV_REST_API_*` / Upstash vars are dropped.

## File Structure

- `server.js` *(new)* — Express app factory + process entry point. Owns HTTP wiring only.
- `lib/rateLimit.js` *(new)* — Redis-backed rate limiter. Owns the limiter policy + Redis client.
- `api/check.js` *(modified)* — keeps detection + HubSpot logic; imports the limiter; exports the handler.
- `package.json` *(modified)* — ESM flag, deps, scripts.
- `test/rateLimit.test.js`, `test/server.test.js` *(new)* — unit/smoke tests.
- Removed: `vercel.json`, `.vercel/`, `api/.gitignore`, stray root `test` file.

---

### Task 1: Scaffold — package config and Vercel cleanup

**Files:**
- Modify: `package.json`
- Remove: `vercel.json`, `.vercel/`, `api/.gitignore`, `test`

**Interfaces:**
- Consumes: nothing.
- Produces: an ESM package with `express` + `ioredis` installed, `npm start` → `node server.js`, `npm test` → `node --test test/`. Later tasks rely on `"type": "module"` and the two dependencies being present.

- [ ] **Step 1: Rewrite `package.json`**

```json
{
  "name": "hubspot-tracker-checker",
  "version": "1.0.0",
  "description": "Check if a website has HubSpot tracking code installed and firing",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": {},
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Install dependencies** (populates the `dependencies` block with real versions)

Run: `npm install express ioredis`
Expected: completes without error; `package.json` `dependencies` now lists `express` and `ioredis`; `package-lock.json` created/updated.

- [ ] **Step 3: Remove the stray root `test` file** (it collides with the new `test/` directory)

Run: `git rm test`
Expected: `rm 'test'`

- [ ] **Step 4: Remove Vercel artifacts**

Run: `git rm vercel.json && rm -f api/.gitignore && rm -rf .vercel`
Expected: `rm 'vercel.json'`; the other two are untracked/ignored so they vanish silently.

- [ ] **Step 5: Verify the package loads as ESM and deps resolve**

Run: `node -e "import('express').then(()=>import('ioredis')).then(()=>console.log('ok'))"`
Expected: prints `ok`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: convert package to ESM Railway service, remove Vercel config"
```

---

### Task 2: Redis-backed rate limiter (`lib/rateLimit.js`)

**Files:**
- Create: `lib/rateLimit.js`
- Test: `test/rateLimit.test.js`

**Interfaces:**
- Consumes: `ioredis`; `process.env.REDIS_URL`.
- Produces:
  - `rateLimit(ip, redis?, now?) → Promise<{ allowed: boolean, remaining: number }>` — core logic; `redis` and `now` are injectable for testing (default to the module Redis client and `new Date()`).
  - `checkRateLimit(ip) → Promise<{ allowed: boolean, remaining: number }>` — convenience wrapper bound to the module client. **`api/check.js` (Task 3) calls this name.**

- [ ] **Step 1: Write the failing test** — `test/rateLimit.test.js`

```js
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

test('sets the daily TTL only on the first request', async () => {
  let expireCalls = 0;
  const redis = makeFakeRedis({ async expire() { expireCalls += 1; return 1; } });
  await rateLimit('9.9.9.9', redis, NOW);
  await rateLimit('9.9.9.9', redis, NOW);
  assert.equal(expireCalls, 1);
});

test('fails open when no Redis client is configured', async () => {
  assert.deepEqual(await rateLimit('1.2.3.4', null, NOW), { allowed: true, remaining: 999 });
});

test('fails open when Redis throws', async () => {
  const redis = makeFakeRedis({ async incr() { throw new Error('connection refused'); } });
  assert.deepEqual(await rateLimit('1.2.3.4', redis, NOW), { allowed: true, remaining: 999 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rateLimit.test.js`
Expected: FAIL — cannot find module `../lib/rateLimit.js`.

- [ ] **Step 3: Implement `lib/rateLimit.js`**

```js
import Redis from 'ioredis';

const DAILY_LIMIT = 2;
const TTL_SECONDS = 86400;

let defaultClient = null;
if (process.env.REDIS_URL) {
  defaultClient = new Redis(process.env.REDIS_URL);
  defaultClient.on('error', (err) => console.error('Redis error:', err));
}

// Core limiter. `redis` and `now` are injectable so the policy can be tested
// without a live Redis. Returns { allowed, remaining }.
export async function rateLimit(ip, redis = defaultClient, now = new Date()) {
  if (!redis) {
    return { allowed: true, remaining: 999 }; // fail open: no Redis configured
  }

  const day = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `rate:${ip}:${day}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, TTL_SECONDS);
    }
    if (count > DAILY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: DAILY_LIMIT - count };
  } catch (err) {
    console.error('Rate limit error:', err);
    return { allowed: true, remaining: 999 }; // fail open: Redis error
  }
}

export function checkRateLimit(ip) {
  return rateLimit(ip);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/rateLimit.test.js`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/rateLimit.js test/rateLimit.test.js
git commit -m "feat: add Redis-backed rate limiter"
```

---

### Task 3: Express server + handler refactor

**Files:**
- Create: `server.js`
- Modify: `api/check.js` (remove `export const config`, remove inline `checkRateLimit`, import the new limiter, change to a named `handler` export)
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `checkRateLimit` from `lib/rateLimit.js` (Task 2); `express`.
- Produces:
  - `api/check.js`: `export async function handler(req, res)` — Express-compatible route handler.
  - `server.js`: `export function createApp()` → configured Express `app`; when run as the main module, listens on `process.env.PORT` (default `3000`).

- [ ] **Step 1: Write the failing smoke test** — `test/server.test.js`

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — cannot find module `../server.js`.

- [ ] **Step 3: Edit `api/check.js` — top of file**

Remove these lines (lines 5–7):

```js
export const config = {
  maxDuration: 30, // Allow up to 30 seconds for headless browser
};
```

Add an import at the very top of the file (above the leading comment is fine, or as the first statement after it):

```js
import { checkRateLimit } from '../lib/rateLimit.js';
```

- [ ] **Step 4: Edit `api/check.js` — remove the inline limiter**

Delete the entire `checkRateLimit` function (the block starting with `// Rate limiting helper using Upstash Redis REST API` through its closing brace, originally lines 9–45). The handler keeps calling `checkRateLimit(ip)` — it now resolves to the imported version.

- [ ] **Step 5: Edit `api/check.js` — export the handler by name**

Change the handler signature (originally line 431):

```js
export default async function handler(req, res) {
```

to:

```js
export async function handler(req, res) {
```

- [ ] **Step 6: Create `server.js`**

```js
import express from 'express';
import { handler } from './api/check.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  // `app.all` lets the handler keep its own method handling (405 on non-POST,
  // 200 on OPTIONS) and CORS headers, exactly as on Vercel.
  app.all('/api/check', handler);
  app.use(express.static('public'));
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`hubspot-tracker-checker listening on port ${port}`);
  });
}
```

- [ ] **Step 7: Run the smoke test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS — 3 tests pass. (No `REDIS_URL` / tokens set; none of these three paths reach Redis or Browserless.)

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — all 8 tests (5 limiter + 3 server) pass.

- [ ] **Step 9: Commit**

```bash
git add server.js api/check.js test/server.test.js
git commit -m "feat: serve app via Express, mount check handler"
```

---

### Task 4: Provision Railway and deploy

> **Execution note:** Run this task in the **main session** (not a subagent) using the `railway:use-railway` skill — it needs interactive Railway auth, the user's account, and confirmation before outward-facing steps. There is no automated test; verification is against the live deployment.

**Files:** none (infrastructure + deploy).

**Interfaces:**
- Consumes: a working `npm start` server (Tasks 1–3); a Railway account.
- Produces: a deployed web service with a public domain, a Redis service, and the required env vars set.

- [ ] **Step 1: Confirm with the user** before creating any Railway resources or deploying. Confirm: target Railway account/team, and whether to deploy the current working tree (which has pre-existing uncommitted edits to `api/check.js`, `public/index.html`, etc.) or commit/revert those first.

- [ ] **Step 2: Authenticate / select project**

Via the railway skill: ensure `railway` CLI is authenticated, then create or select the project for this app.

- [ ] **Step 3: Provision a Redis service** in the project.

- [ ] **Step 4: Create the web service** from this repo and wire `REDIS_URL` as a reference to the Redis service (Railway reference variable, e.g. `${{Redis.REDIS_URL}}`).

- [ ] **Step 5: Set the application env vars** on the web service: `BROWSERLESS_TOKEN`, `HUBSPOT_TOKEN`, and (optionally) `DEBUG_KEY`. Use the same values currently configured in Vercel.

- [ ] **Step 6: Deploy**

Run (via the railway skill): `railway up`
Expected: build succeeds (Nixpacks detects Node, runs `npm install`, starts with `npm start`); deployment goes live.

- [ ] **Step 7: Generate a public domain** for the web service.

- [ ] **Step 8: Verify the live deployment**

```bash
# Front end loads
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/          # expect 200

# Known-positive site
curl -s -X POST https://<domain>/api/check \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.hubspot.com"}'                            # expect "status":"positive"

# Known-negative site
curl -s -X POST https://<domain>/api/check \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.wikipedia.org"}'                          # expect "status":"negative"
```

Expected: 200 on `/`; `positive` for hubspot.com; `negative` for wikipedia.org. Confirm in Railway logs that Redis connected (no `Redis error:` spam) and a Company record appears in HubSpot.

- [ ] **Step 9: Update docs**

Update `README.md` and `CLAUDE.md` to describe the Railway deploy (`npm start`, `railway up`, `railway run npm start` for local dev with injected env) and drop the Vercel-specific setup. Commit:

```bash
git add README.md CLAUDE.md
git commit -m "docs: document Railway deployment, remove Vercel instructions"
```

---

## Self-Review

**Spec coverage:**
- Express + ioredis single web service → Tasks 1–3. ✓
- Railway topology (web + Redis services) → Task 4. ✓
- `server.js` (json, CORS via handler, static, listen on PORT) → Task 3. ✓
- `lib/rateLimit.js` (INCR + conditional EXPIRE, fail open, 2/day) → Task 2. ✓
- `api/check.js` edits (drop config, import limiter, export handler, keep detection/HubSpot) → Task 3. ✓
- `package.json` (type module, deps, scripts, drop vercel scripts) → Task 1. ✓
- Remove `vercel.json`/`.vercel/`/`api/.gitignore` → Task 1. ✓
- Env vars carried/dropped, `REDIS_URL` wired → Tasks 4 (steps 4–5). ✓
- `public/index.html` untouched → not modified by any task. ✓
- Local dev via `railway run npm start` → Task 4 step 9 docs. ✓

**Placeholder scan:** `<domain>` in Task 4 is a runtime value (the Railway-generated host), not a plan placeholder — every code step contains complete content. No TBD/TODO.

**Type consistency:** `checkRateLimit(ip)` is defined in Task 2 and consumed by name in `api/check.js` (Task 3). `rateLimit(ip, redis, now)` signature matches its tests. `createApp()` and `handler` names match between `server.js`, `api/check.js`, and `test/server.test.js`. ✓

**Note on the stray `test` file:** removed in Task 1 Step 3 specifically so the `test/` directory and `node --test test/` work.

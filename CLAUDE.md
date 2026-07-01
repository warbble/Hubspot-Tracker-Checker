# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-purpose lead-gen tool: a public landing page where a visitor enters a website URL, and the backend reports whether that site has HubSpot tracking code installed and firing. Every check is written to HubSpot CRM as a Company record (and optional Contact), so the tool doubles as a lead capture funnel.

Deployed on **Railway** as one long-running Express service plus a managed **Redis** service. (It previously ran on Vercel as a serverless function + Vercel KV; that migration is documented in `docs/superpowers/specs/` and `docs/superpowers/plans/`.)

## Commands

```bash
npm start                  # node server.js — the Express server (serves public/ + /api/check)
npm test                   # node --test test/ — the unit + smoke tests
railway run npm start      # run locally with Railway env vars injected (incl. REDIS_URL)
railway up                 # deploy the current directory to Railway
```

`npm test` runs the built-in Node test runner (no framework); tests live in `test/`. There is **no build step and no linter** — everything is ESM (`"type": "module"`) run directly on Node ≥18, with only `express` and `ioredis` as dependencies.

## Architecture

Three source files do the work, plus the front end:

- **`server.js`** — process entry point. `createApp()` builds the Express app (`express.json()` → `app.all('/api/check', handler)` → `express.static('public')`) and is exported for tests; the server calls `listen(process.env.PORT || 3000)` only when run as the main module. HTTP wiring only, no business logic.
- **`api/check.js`** — exports `handler(req, res)`, the single API route. Contains all tracking-detection and HubSpot CRM logic. Ported almost verbatim from the Vercel function (Vercel's `req.body` / `res.status().json()` match Express's shapes).
- **`lib/rateLimit.js`** — Redis-backed limiter. Exports `checkRateLimit(ip)`; `rateLimit(ip, redis, now)` is the injectable core used by tests.
- **`public/index.html`** — self-contained front end (HTML + inline CSS + inline JS, no framework). Posts `{ url, name, email, debug }` to `/api/check` on a relative path. `CONFIG.bookingLink` near the bottom holds the HubSpot meetings URL; the JS rewrites every `href="BOOKING_LINK_HERE"` placeholder to that value at load time, so update `CONFIG`, not each link.

Request flow inside `handler`:

1. **Rate limit** (`lib/rateLimit.js`) — 2 checks per IP per day via Redis `INCR` + `EXPIRE` (`rate:<ip>:<UTC-day>`). **Fails open**: if `REDIS_URL` is unset or Redis errors, the request is allowed. Bypassed when the request's `debug` field equals `process.env.DEBUG_KEY`.
2. **Detection** (`checkHubSpotTracking` → `analyzeTracking`) — calls Browserless.io twice: `/content` for rendered HTML, `/scrape` for cookies. `positive` = HubSpot script regex match **and** a HubSpot cookie (`__hstc`/`hubspotutk`/…); `unsure` = script but no cookie; `negative` = no script. The portal ID is extracted from the script URL.
3. **CRM write** (`saveToHubSpot`) — upserts a Company by `domain`, and if an email was supplied, upserts a Contact by email and associates it. HubSpot failures are caught and swallowed so they never fail the user-facing check.

External services, all via REST + bearer token (no SDKs): **Browserless.io** (`BROWSERLESS_TOKEN`), **HubSpot CRM v3** (`HUBSPOT_TOKEN`), **Redis** (`REDIS_URL`, via `ioredis`).

## Environment variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `BROWSERLESS_TOKEN` | Browserless.io rendering — `/api/check` 500s without it | Yes |
| `HUBSPOT_TOKEN` | HubSpot private-app token; CRM save is skipped if absent | Yes (for lead capture) |
| `REDIS_URL` | Rate-limit backend; on Railway wired as `${{Redis.REDIS_URL}}`. Absence disables limiting (fails open) | Yes on Railway |
| `DEBUG_KEY` | Secret that, passed as `debug`, bypasses rate limiting | Optional |
| `PORT` | Injected by Railway; the server binds it | Auto |

## Railway deployment

Project `hubspot-tracker-checker` (workspace "Aktelmiele's Projects") has two services: **web** (this repo, Nixpacks/Railpack build, `npm start`) and **Redis**. `REDIS_URL` on web references the Redis service. Secrets (`BROWSERLESS_TOKEN`, `HUBSPOT_TOKEN`, `DEBUG_KEY`) are set in the Railway dashboard. Deploy with `railway up` from the repo root; `railway up` uploads the working directory (respecting `.gitignore`, so `node_modules`/`.env.local` are excluded).

## Gotchas when modifying

- **HubSpot custom properties must exist first.** `saveToHubSpot` writes `tracking_status`, `hubspot_portal_id_detected`, `tracking_checked_at`, `tracking_checker_notes` on the Company object. Adding a new property to the write payload requires creating it in HubSpot (Settings → Properties) or the API call 400s. See README.md for the property/scope setup.
- **Detection currently skews to `unsure`.** The `/scrape` call in `checkHubSpotTracking` no longer requests cookies (a prior `cookies: true` was removed), so `cookiesFound` is effectively always false and sites with real HubSpot tracking return `unsure` instead of `positive` (script + portal ID are still detected). Fixing accuracy means restoring cookie retrieval from Browserless (v2 `production-sfo` API) — tune the `/scrape` body and the cookie list in `analyzeTracking`, not the status logic.
- **No per-request timeout on Railway.** Unlike Vercel's `maxDuration: 30`, Railway imposes no function timeout, so the Browserless-latency workaround was dropped. Long renders just run.
- `api/check.js` contains `console.log` lines that print `BROWSERLESS_TOKEN` length and first 8 chars for debugging — remove these if hardening for production.

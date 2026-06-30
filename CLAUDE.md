# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-purpose lead-gen tool: a public landing page where a visitor enters a website URL, and the backend reports whether that site has HubSpot tracking code installed and firing. Every check is written to HubSpot CRM as a Company record (and optional Contact), so the tool doubles as a lead capture funnel.

## Commands

```bash
npm run dev        # vercel dev — runs the static site + serverless function locally
npm run deploy     # vercel --prod
```

Local dev requires Vercel env vars pulled down first (one-time):

```bash
vercel link        # link to the Vercel project
vercel env pull    # writes .env.local (gitignored)
```

There is **no build step, no lint, and no test runner**. `dependencies` in `package.json` is empty — everything uses native `fetch`. The root file named `test` is a stray artifact (`git show 373aacd`), not a test suite.

## Architecture

Two files do all the work:

- **`public/index.html`** — self-contained front end (HTML + inline CSS + inline JS, ~1300 lines, no framework). Posts `{ url, name, email, debug }` to the API and renders the result. `CONFIG.bookingLink` near the bottom holds the HubSpot meetings URL; the JS rewrites every `href="BOOKING_LINK_HERE"` placeholder to that value at load time, so update `CONFIG`, not each link.
- **`api/check.js`** — the only serverless function (`POST /api/check`). A standard Vercel Node handler (`export default async function handler(req, res)`).

The request flow inside `check.js`:

1. **Rate limit** (`checkRateLimit`) — 2 checks per IP per day, stored in Vercel KV / Upstash Redis via its REST API (not a client lib). Fails open: if KV is unreachable or unconfigured, the request is allowed. Bypassed when the request's `debug` field equals `process.env.DEBUG_KEY`.
2. **Detection** (`checkHubSpotTracking` → `analyzeTracking`) — calls Browserless.io twice: `/content` for rendered HTML, `/scrape` for cookies. Tracking presence is decided by two signals:
   - *script found* — regex match for `js.hs-scripts.com/<portalId>.js` or `js.hs-analytics.net/.../<portalId>.js` in the HTML (this is also where `portalId` is extracted).
   - *cookies found* — any of `__hstc`, `__hssc`, `__hssrc`, `hubspotutk` present.
   - Status: `positive` (script + cookies), `unsure` (script but no cookies — likely consent banner / ad blocker), `negative` (no script).
3. **CRM write** (`saveToHubSpot`) — upserts a Company by `domain` (search → create or update), and if an email was supplied, upserts a Contact by email and associates it to the company. HubSpot failures are caught and swallowed so they never fail the user-facing check.

External services, all via REST + bearer token (no SDKs):

- **Browserless.io** — headless Chrome rendering (`BROWSERLESS_TOKEN`).
- **HubSpot CRM v3** — `https://api.hubapi.com/crm/v3/...` (`HUBSPOT_TOKEN`).
- **Vercel KV / Upstash** — rate-limit counters (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).

## Environment variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `BROWSERLESS_TOKEN` | Browserless.io rendering — request 500s without it | Yes |
| `HUBSPOT_TOKEN` | HubSpot private-app token; CRM save is skipped if absent | Yes (for lead capture) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Rate limiting; absence disables it (fails open) | Optional |
| `DEBUG_KEY` | Secret that, passed as `debug`, bypasses rate limiting | Optional |

## Gotchas when modifying

- **HubSpot custom properties must exist first.** `saveToHubSpot` writes `tracking_status`, `hubspot_portal_id_detected`, `tracking_checked_at`, `tracking_checker_notes` on the Company object. Adding a new property to the write payload requires creating it in HubSpot (Settings → Properties) or the API call 400s. See README.md for the property/scope setup.
- **`maxDuration` is set in two places** — `vercel.json` and the `export const config` in `check.js`. Keep them in sync (30s) to allow for headless-browser latency.
- **Detection is HTML/cookie heuristics**, so sites that load HubSpot only after consent, or via uncommon script hosts, surface as `unsure`/`negative`. Tune the regexes in `analyzeTracking` and the cookie list, not the status logic, when adjusting accuracy.
- `check.js` contains `console.log` lines that print `BROWSERLESS_TOKEN` length and first 8 chars for debugging — remove these if hardening for production.

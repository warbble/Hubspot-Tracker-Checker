# HubSpot Tracking Code Checker - Setup Guide

## Overview

This tool allows visitors to check if their website has HubSpot tracking code installed and working correctly. Results are stored as Company records in HubSpot (with optional Contact association).

It runs on **Railway** as a single long-running Express server plus a managed Redis service.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Landing Page   │────▶│  Express server  │────▶│  Browserless.io │
│  (public/)      │     │  /api/check      │     │  (Headless Chrome)
└─────────────────┘     └──────────────────┘     └─────────────────┘
   served by the same         │
   Railway web service        │
                    ┌──────────┴───────────┐
                    ▼                      ▼
           ┌──────────────────┐    ┌──────────────────┐
           │  Railway Redis   │    │  HubSpot API     │
           │  (Rate Limiting) │    │  (Company/Contact)
           └──────────────────┘    └──────────────────┘
```

The web service serves `public/index.html` at `/` and handles `POST /api/check` in the same process (`server.js` → `api/check.js`). Rate limiting uses Railway Redis via `ioredis` (`lib/rateLimit.js`).

---

## What Gets Stored in HubSpot

### Company Record (always created/updated)
- **Domain** - extracted from the URL checked
- **Name** - set to domain (can be updated manually)
- **tracking_status** - `positive`, `negative`, or `unsure`
- **hubspot_portal_id_detected** - the portal ID found (if any)
- **tracking_checked_at** - timestamp of the check
- **tracking_checker_notes** - details about what was found

### Contact Record (only if email provided)
- **Email** - from the form
- **First Name / Last Name** - split from name field
- **Associated to the Company record**

If someone checks the same domain again, the Company record is **updated** (not duplicated). You can see the history via the property history in HubSpot.

---

## Step 1: Create HubSpot Custom Properties

Before deploying, create these custom properties in HubSpot:

### Company Properties
Go to **Settings → Properties → Company Properties → Create Property**

| Property Name | Internal Name | Type | Group |
|---------------|---------------|------|-------|
| Tracking Status | `tracking_status` | Single-line text | Company information |
| Portal ID Detected | `hubspot_portal_id_detected` | Single-line text | Company information |
| Tracking Checked At | `tracking_checked_at` | Single-line text | Company information |
| Tracking Checker Notes | `tracking_checker_notes` | Multi-line text | Company information |

---

## Step 2: Create HubSpot Private App (API Token)

1. Go to **Settings → Integrations → Private Apps**
2. Click **Create a private app**
3. Name it: `Tracking Code Checker`
4. Under **Scopes**, enable:
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
5. Click **Create app**
6. Copy the **Access Token** - you'll need this for Railway

---

## Step 3: Browserless.io Setup

1. Go to [browserless.io](https://www.browserless.io/) and create a free account
2. Navigate to your dashboard and copy your **API Token**
3. Free tier includes **1,000 sessions/month**

---

## Step 4: Railway Setup

The app is a standard Node/Express service — Railway builds it with Nixpacks and runs `npm start`.

### 4.1 Create the project and services

Using the Railway CLI from the repo root:

```bash
railway init --name hubspot-tracker-checker   # create + link the project
railway add --database redis                  # add a managed Redis service
railway add --service web                     # create the web (app) service
```

### 4.2 Wire Redis and deploy

```bash
# Reference the Redis service's URL from the web service
railway variable set 'REDIS_URL=${{Redis.REDIS_URL}}' --service web

# Deploy the current directory to the web service
railway up --service web
```

### 4.3 Configure Environment Variables

In **Railway Dashboard → web service → Variables** (or `railway variable set KEY=value --service web`):

| Variable | Value | Notes |
|----------|-------|-------|
| `BROWSERLESS_TOKEN` | Your browserless.io token | Required |
| `HUBSPOT_TOKEN` | Your HubSpot private app token | Required |
| `DEBUG_KEY` | Any secret string | Optional — `?debug=<value>` bypasses rate limiting |

`REDIS_URL` is set in 4.2 as a reference to the Redis service. `PORT` is injected by Railway automatically. Saving variables triggers a redeploy.

### 4.4 Generate a domain

```bash
railway domain --service web
```

This returns a public `*.up.railway.app` URL.

---

## Step 5: Booking Link

The booking link lives in `public/index.html`:

```javascript
const CONFIG = {
  apiEndpoint: '/api/check',
  bookingLink: 'https://meetings.hubspot.com/gregfurlong/round-robin',
};
```

The front-end rewrites every `href="BOOKING_LINK_HERE"` placeholder to `CONFIG.bookingLink` at load time, so update `CONFIG` — not each link.

---

## Step 6: (Optional) Custom Domain

In Railway:
1. Go to the **web service → Settings → Networking → Custom Domain** (or `railway domain <your-domain>`)
2. Add your domain (e.g., `tracker.warbble.digital`)
3. Add the CNAME record Railway shows you to your DNS

---

## Configuration Reference

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BROWSERLESS_TOKEN` | API token from browserless.io | Yes |
| `HUBSPOT_TOKEN` | Private app token from HubSpot | Yes |
| `REDIS_URL` | Redis connection URL (Railway reference `${{Redis.REDIS_URL}}`) | Yes |
| `DEBUG_KEY` | Secret that bypasses rate limiting when passed as `debug` | No |
| `PORT` | Port to listen on (injected by Railway) | Auto |

### Rate Limiting

- **Default:** 2 checks per IP per day
- **To change:** Edit `DAILY_LIMIT` in `lib/rateLimit.js`
- **Storage:** Railway Redis with a 24-hour key TTL
- **Fails open:** if `REDIS_URL` is unset or Redis errors, requests are allowed

---

## Testing

### Test URLs

| URL | Expected Result |
|-----|-----------------|
| `https://www.hubspot.com` | Script + portal ID detected (currently reports `unsure` — see note) |
| `https://www.wikipedia.org` | Negative (no HubSpot) |
| `https://invalid-url-12345.com` | Error (unreachable) |

> **Note:** the `/scrape` call in `api/check.js` does not currently request cookies, so `cookiesFound` is always false and sites with real HubSpot tracking report `unsure` rather than `positive` (the script and portal ID are still detected). Restoring cookie retrieval from Browserless is a known follow-up.

### Local Development

```bash
railway run npm start   # runs locally with Railway env vars (incl. REDIS_URL) injected
npm test                # unit + smoke tests (node --test)
```

---

## Troubleshooting

### "Service configuration error"
- Check `BROWSERLESS_TOKEN` is set on the web service
- Verify token is valid at browserless.io

### Company not appearing in HubSpot
- Check `HUBSPOT_TOKEN` is set
- Verify private app has correct scopes
- Check Railway deploy logs (`railway logs --service web`) for errors

### Rate limiting not working
- Ensure the Redis service is running and `REDIS_URL` is set on the web service
- The limiter fails open, so a missing/broken Redis silently disables it

### "Property doesn't exist" error
- Create the custom properties in HubSpot first (Step 1)
- Property internal names must match exactly

---

## Files Overview

```
hubspot-tracker-checker/
├── server.js             # Express entry point (serves public/ + mounts /api/check)
├── api/
│   └── check.js          # API handler - tracking check + HubSpot save
├── lib/
│   └── rateLimit.js      # Redis-backed rate limiter
├── public/
│   └── index.html        # Front-end interface
├── test/                 # node --test suites (rateLimit, server)
├── package.json          # ESM; deps: express, ioredis
└── README.md             # This file
```

---

## HubSpot Private App Scopes Required

| Scope | Purpose |
|-------|---------|
| `crm.objects.companies.read` | Search for existing companies by domain |
| `crm.objects.companies.write` | Create/update company records |
| `crm.objects.contacts.read` | Search for existing contacts by email |
| `crm.objects.contacts.write` | Create/update contacts + associations |

---

## Future Enhancements

- [ ] Restore cookie detection in the Browserless `/scrape` call so real tracking reports `positive`
- [ ] Add "Check Another URL" button after results
- [ ] Email results to user
- [ ] Webhook to Slack when new lead captured
- [ ] Track conversion from check → booked meeting
- [ ] Batch checking for agencies

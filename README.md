# HubSpot Tracking Code Checker - Setup Guide

## Overview

This tool allows visitors to check if their website has HubSpot tracking code installed and working correctly. Results are stored as Company records in HubSpot (with optional Contact association).

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Landing Page   │────▶│  Vercel API      │────▶│  Browserless.io │
│  (Vercel)       │     │  /api/check      │     │  (Headless Chrome)
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
           ┌──────────────────┐    ┌──────────────────┐
           │  Vercel KV       │    │  HubSpot API     │
           │  (Rate Limiting) │    │  (Company/Contact)
           └──────────────────┘    └──────────────────┘
```

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
6. Copy the **Access Token** - you'll need this for Vercel

---

## Step 3: Browserless.io Setup

1. Go to [browserless.io](https://www.browserless.io/) and create a free account
2. Navigate to your dashboard and copy your **API Token**
3. Free tier includes **1,000 sessions/month**

---

## Step 4: Vercel Setup

### 4.1 Create Vercel Account
1. Go to [vercel.com](https://vercel.com) and sign up
2. Click **Add New Project**

### 4.2 Deploy the Project

**Option A: GitHub (Recommended)**
1. Create a new GitHub repository
2. Push the project files to the repo:
   ```
   hubspot-tracker-checker/
   ├── api/
   │   └── check.js
   ├── public/
   │   └── index.html
   ├── package.json
   ├── vercel.json
   └── .gitignore
   ```
3. In Vercel, click **Import Git Repository**
4. Select your repo and deploy

**Option B: Vercel CLI**
```bash
npm install -g vercel
cd hubspot-tracker-checker
vercel login
vercel --prod
```

### 4.3 Configure Environment Variables

In **Vercel Dashboard → Your Project → Settings → Environment Variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `BROWSERLESS_TOKEN` | Your browserless.io token | Required |
| `HUBSPOT_TOKEN` | Your HubSpot private app token | Required |

### 4.4 Enable Vercel KV (Rate Limiting)

1. In Vercel Dashboard → **Storage** → **Create Database**
2. Select **KV** (Redis-compatible)
3. Name it `tracker-checker-kv`
4. Click **Create**
5. Connect it to your project (auto-adds env vars)

---

## Step 5: Update the Booking Link

Edit `public/index.html` and replace `BOOKING_LINK_HERE` with your HubSpot meetings link:

```javascript
const CONFIG = {
  apiEndpoint: '/api/check',
  bookingLink: 'https://meetings.hubspot.com/warbble/consultation', // Your link here
};
```

Also update the booking links in the HTML (search for `BOOKING_LINK_HERE`).

---

## Step 6: (Optional) Custom Domain

In Vercel:
1. Go to **Settings → Domains**
2. Add your domain (e.g., `tracker.warbble.digital`)
3. Update DNS as instructed

---

## Configuration Reference

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BROWSERLESS_TOKEN` | API token from browserless.io | Yes |
| `HUBSPOT_TOKEN` | Private app token from HubSpot | Yes |
| `KV_REST_API_URL` | Auto-set by Vercel KV | Yes |
| `KV_REST_API_TOKEN` | Auto-set by Vercel KV | Yes |

### Rate Limiting

- **Default:** 2 checks per IP per day
- **To change:** Edit `checkRateLimit()` in `/api/check.js`
- **Storage:** Vercel KV with 24-hour expiry

---

## Testing

### Test URLs

| URL | Expected Result |
|-----|-----------------|
| `https://www.hubspot.com` | Positive (has tracking) |
| `https://www.wikipedia.org` | Negative (no HubSpot) |
| `https://invalid-url-12345.com` | Error (unreachable) |

### Local Development

```bash
npm install -g vercel
vercel link
vercel env pull
vercel dev
```

---

## Troubleshooting

### "Service configuration error"
- Check `BROWSERLESS_TOKEN` is set in Vercel
- Verify token is valid at browserless.io

### Company not appearing in HubSpot
- Check `HUBSPOT_TOKEN` is set
- Verify private app has correct scopes
- Check Vercel function logs for errors

### Rate limiting not working
- Ensure Vercel KV is connected
- Check KV env vars are present

### "Property doesn't exist" error
- Create the custom properties in HubSpot first (Step 1)
- Property internal names must match exactly

---

## Files Overview

```
hubspot-tracker-checker/
├── api/
│   └── check.js          # Main API - tracking check + HubSpot save
├── public/
│   └── index.html        # Front-end interface
├── package.json          # Dependencies (@vercel/kv)
├── vercel.json           # Vercel configuration
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

- [ ] Add "Check Another URL" button after results
- [ ] Email results to user
- [ ] Webhook to Slack when new lead captured
- [ ] Track conversion from check → booked meeting
- [ ] Batch checking for agencies

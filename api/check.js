// /api/check.js - HubSpot Tracking Code Checker
// Uses Browserless.io to render page and verify tracking
// Stores results in HubSpot as Company records (with optional Contact association)

import { checkRateLimit } from '../lib/rateLimit.js';
import { isFreeEmail } from '../lib/freeEmailDomains.js';

// Validate and normalize URL
function normalizeUrl(input) {
  let url = input.trim();
  
  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  try {
    const parsed = new URL(url);
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Invalid protocol. Please use http or https.' };
    }
    return { valid: true, url: parsed.href, domain: parsed.hostname.replace(/^www\./, '') };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format. Please enter a valid website address.' };
  }
}

// Main check function using Browserless
async function checkHubSpotTracking(url, browserlessToken) {
  // Use the /content endpoint to get full page content
  const contentUrl = `https://production-sfo.browserless.io/content?token=${browserlessToken}`;
  
  console.log('Fetching URL:', url);
  
  const response = await fetch(contentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: url
    }),
  });

  console.log('Browserless response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Browserless error:', errorText);
    throw new Error(`Failed to load page: ${response.status}`);
  }

  const html = await response.text();
  console.log('HTML length:', html.length);
  
  // Detection is based on the rendered HTML (HubSpot script tag + portal ID).
  // Browserless v2 /scrape does not return cookies, so there is no second call.
  const result = analyzeTracking(html, [], url);
  return result;
}

export function analyzeTracking(html, cookies, checkedUrl) {
  const result = {
    status: 'negative',
    portalId: null,
    scriptFound: false,
    scriptFiring: false,
    cookiesFound: false,
    message: '',
    details: [],
  };

  // Check for HubSpot script in HTML
  const scriptPatterns = [
    /js\.hs-scripts\.com\/(\d+)\.js/g,
    /js\.hs-analytics\.net\/analytics\/[^"']+\/(\d+)\.js/g,
  ];

  let portalIds = new Set();
  
  for (const pattern of scriptPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      result.scriptFound = true;
      if (match[1]) {
        portalIds.add(match[1]);
      }
    }
  }

  // Also check for inline HubSpot config
  const inlineConfigPattern = /window\._hsq|_hsq\.push|hs-script-loader/gi;
  if (inlineConfigPattern.test(html)) {
    result.details.push('HubSpot code references found in page');
  }

  // Check for HubSpot cookies
  const hubspotCookies = ['__hstc', '__hssc', '__hssrc', 'hubspotutk'];
  const foundCookies = cookies.filter(c => hubspotCookies.includes(c.name));
  
  if (foundCookies.length > 0) {
    result.cookiesFound = true;
    result.scriptFiring = true;
    result.details.push(`HubSpot cookies detected: ${foundCookies.map(c => c.name).join(', ')}`);
  }

  // Set portal ID if found
  if (portalIds.size > 0) {
    result.portalId = Array.from(portalIds)[0];
    if (portalIds.size > 1) {
      result.details.push(`Multiple portal IDs detected: ${Array.from(portalIds).join(', ')}`);
    }
  }

  // Determine final status. A found script + portal ID means the tracking code
  // is installed; detected cookies additionally confirm it fired during our
  // (headless) visit - often blocked by consent banners even when tracking works.
  if (result.scriptFound && result.cookiesFound) {
    result.status = 'positive';
    result.message = 'HubSpot tracking code is installed and firing correctly';
    result.details.push('Firing confirmed: HubSpot cookies were set on page load');
  } else if (result.scriptFound) {
    result.status = 'positive';
    result.message = 'HubSpot tracking code is installed';
    result.details.push('Tracking script and portal ID detected. Cookie firing was not confirmed in this headless check (commonly a cookie consent banner), but the tracking code is present.');
  } else {
    result.status = 'negative';
    result.message = 'No HubSpot tracking code detected on this page';
    result.details.push('The tracking script was not found in the page source');
  }

  return result;
}

// ============================================================
// HubSpot API Functions
// ============================================================

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

// Search for existing company by domain
async function findCompanyByDomain(domain, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'domain',
          operator: 'EQ',
          value: domain,
        }]
      }],
      properties: ['domain', 'name', 'tracking_status', 'hubspot_portal_id_detected'],
      limit: 1,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot search error:', error);
    return null;
  }

  const data = await response.json();
  return data.results?.[0] || null;
}

// Create a new company
async function createCompany(companyData, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: companyData,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot create company error:', error);
    throw new Error('Failed to create company in HubSpot');
  }

  return await response.json();
}

// Update an existing company
async function updateCompany(companyId, companyData, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: companyData,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot update company error:', error);
    throw new Error('Failed to update company in HubSpot');
  }

  return await response.json();
}

// Search for existing contact by email
async function findContactByEmail(email, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email,
        }]
      }],
      properties: ['email', 'firstname', 'lastname'],
      limit: 1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.results?.[0] || null;
}

// Create a new contact
async function createContact(contactData, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: contactData,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot create contact error:', error);
    throw new Error('Failed to create contact in HubSpot');
  }

  return await response.json();
}

// Update an existing contact
async function updateContact(contactId, contactData, hubspotToken) {
  const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${hubspotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: contactData,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot update contact error:', error);
    throw new Error('Failed to update contact in HubSpot');
  }

  return await response.json();
}

// Associate contact to company
async function associateContactToCompany(contactId, companyId, hubspotToken) {
  const response = await fetch(
    `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${hubspotToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('HubSpot association error:', error);
    // Don't throw - association failure shouldn't break the flow
  }
}

// Main function to save to HubSpot
async function saveToHubSpot(domain, trackingResult, contactInfo, hubspotToken) {
  const now = new Date().toISOString();
  
  // Prepare company data
  const companyData = {
    domain: domain,
    name: domain, // Use domain as name if we don't have a company name
    tracking_status: trackingResult.status,
    hubspot_portal_id_detected: trackingResult.portalId || '',
    tracking_checked_at: now,
    tracking_checker_notes: trackingResult.details.join('; '),
  };

  // Find or create company
  let company = await findCompanyByDomain(domain, hubspotToken);
  
  if (company) {
    // Update existing company
    company = await updateCompany(company.id, companyData, hubspotToken);
    console.log(`Updated company ${company.id} for domain ${domain}`);
  } else {
    // Create new company
    company = await createCompany(companyData, hubspotToken);
    console.log(`Created company ${company.id} for domain ${domain}`);
  }

  // Handle contact if email provided
  if (contactInfo.email) {
    const contactData = {
      email: contactInfo.email,
    };
    
    if (contactInfo.name) {
      // Try to split name into first/last
      const nameParts = contactInfo.name.trim().split(/\s+/);
      contactData.firstname = nameParts[0] || '';
      contactData.lastname = nameParts.slice(1).join(' ') || '';
    }

    let contact = await findContactByEmail(contactInfo.email, hubspotToken);
    
    if (contact) {
      // Update existing contact (only if we have new name info)
      if (contactInfo.name) {
        contact = await updateContact(contact.id, contactData, hubspotToken);
      }
      console.log(`Found existing contact ${contact.id}`);
    } else {
      // Create new contact
      contact = await createContact(contactData, hubspotToken);
      console.log(`Created contact ${contact.id}`);
    }

    // Associate contact to company
    await associateContactToCompany(contact.id, company.id, hubspotToken);
    console.log(`Associated contact ${contact.id} to company ${company.id}`);
  }

  return { companyId: company.id };
}

// ============================================================
// Main Handler
// ============================================================

export async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, name, email, debug } = req.body || {};

    if (!url) {
      return res.status(400).json({ 
        error: 'URL is required',
        status: 'error' 
      });
    }

    // Validate URL
    const normalized = normalizeUrl(url);
    if (!normalized.valid) {
      return res.status(400).json({ 
        error: normalized.error,
        status: 'error' 
      });
    }

    // Business emails only — reject free / personal / disposable providers
    if (email && isFreeEmail(email)) {
      return res.status(400).json({
        status: 'error',
        error: 'Please use your work email address. Free and personal email providers aren\'t accepted.',
      });
    }

    // Check for debug mode (bypasses rate limiting)
    const debugKey = process.env.DEBUG_KEY;
    const isDebugMode = debugKey && debug === debugKey;

    // Check rate limit (skip if debug mode)
    let rateLimit = { allowed: true, remaining: 999 };
    
    if (!isDebugMode) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
                 req.headers['x-real-ip'] || 
                 'unknown';
      
      rateLimit = await checkRateLimit(ip);
      
      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: 'Daily limit reached. You can check up to 2 URLs per day.',
          status: 'rate_limited',
          checksRemaining: 0,
        });
      }
    }

    // Check HubSpot tracking
    const browserlessToken = process.env.BROWSERLESS_TOKEN;
    console.log('BROWSERLESS_TOKEN configured:', !!browserlessToken);

    if (!browserlessToken) {
      console.error('BROWSERLESS_TOKEN not configured');
      return res.status(500).json({ 
        error: 'Service configuration error',
        status: 'error' 
      });
    }

    const result = await checkHubSpotTracking(normalized.url, browserlessToken);

    // Save to HubSpot
    const hubspotToken = process.env.HUBSPOT_TOKEN;
    let hubspotResult = null;
    
    if (hubspotToken) {
      try {
        hubspotResult = await saveToHubSpot(
          normalized.domain,
          result,
          { name: name || null, email: email || null },
          hubspotToken
        );
      } catch (hubspotError) {
        console.error('HubSpot save error:', hubspotError);
        // Don't fail the request if HubSpot save fails
      }
    } else {
      console.warn('HUBSPOT_TOKEN not configured - skipping CRM save');
    }

    // Return result
    return res.status(200).json({
      ...result,
      url: normalized.url,
      domain: normalized.domain,
      checksRemaining: isDebugMode ? 'unlimited' : rateLimit.remaining,
      debugMode: isDebugMode,
      hubspot: hubspotResult,
    });

  } catch (error) {
    console.error('Check error:', error);
    
    if (error.message.includes('Failed to load page')) {
      return res.status(200).json({
        status: 'error',
        message: "Couldn't load this website",
        details: ['The site may be down, blocking automated access, or the URL may be incorrect'],
        error: 'site_unreachable',
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while checking the URL',
      error: error.message,
    });
  }
}

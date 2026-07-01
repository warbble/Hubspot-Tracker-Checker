// Free / personal / disposable email domains to block, so the form captures
// business emails only. This is a curated subset of HubSpot's "email domains
// to block" list (that full list is ~3,000 mostly-obscure disposable domains):
// https://knowledge.hubspot.com/forms/what-domains-are-blocked-when-using-the-forms-email-domains-to-block-feature
// It covers the common consumer providers, major ISP webmail, and common
// disposable services. Keep in sync with the copy inlined in public/index.html.
export const FREE_EMAIL_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de',
  'yahoo.es', 'yahoo.it', 'yahoo.in', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'hotmail.es', 'hotmail.ca', 'outlook.com', 'outlook.co.uk', 'outlook.fr',
  'outlook.de', 'outlook.es', 'outlook.it', 'live.com', 'live.co.uk', 'live.fr',
  'live.ca', 'msn.com', 'windowslive.com',
  // AOL
  'aol.com', 'aim.com', 'aol.co.uk',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Proton
  'protonmail.com', 'proton.me', 'pm.me',
  // GMX / Mail.com
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.co.uk', 'mail.com', 'email.com', 'usa.com',
  // Yandex / Mail.ru
  'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'list.ru', 'bk.ru', 'inbox.ru',
  // Other consumer webmail
  'zoho.com', 'zohomail.com', 'fastmail.com', 'hushmail.com', 'tutanota.com',
  'tuta.io', 'hey.com', 'qq.com', '163.com', '126.com', 'sina.com', 'sohu.com',
  'naver.com', 'hanmail.net', 'daum.net', 'nate.com', 'rediffmail.com',
  // ISP webmail (US)
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'cox.net', 'charter.net', 'earthlink.net', 'roadrunner.com', 'frontier.com',
  // ISP webmail (UK)
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'ntlworld.com',
  'blueyonder.co.uk',
  // ISP webmail (EU)
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'web.de',
  't-online.de', 'freenet.de', 'libero.it', 'virgilio.it', 'tin.it', 'alice.it',
  // ISP webmail (AU/CA/NZ)
  'telstra.com', 'bigpond.com', 'optusnet.com.au', 'shaw.ca', 'rogers.com',
  'sympatico.ca', 'telus.net', 'xtra.co.nz',
  // Disposable / temporary
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'getnada.com', 'maildrop.cc', 'dispostable.com', 'sharklasers.com', 'grr.la',
  'spam4.me', 'mailnesia.com', 'mohmal.com', 'fakeinbox.com', 'emailondeck.com',
  'moakt.com', 'mailcatch.com', 'mintemail.com',
]);

// Returns true if the email's domain is a known free/personal/disposable provider.
export function isFreeEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return FREE_EMAIL_DOMAINS.has(domain);
}

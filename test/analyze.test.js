import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTracking } from '../api/check.js';

const SCRIPT = '<script src="https://js.hs-scripts.com/5368814.js"></script>';

test('script + HubSpot cookie -> positive, firing confirmed', () => {
  const r = analyzeTracking(SCRIPT, [{ name: '__hstc' }], 'https://warbble.com');
  assert.equal(r.status, 'positive');
  assert.equal(r.portalId, '5368814');
  assert.equal(r.cookiesFound, true);
  assert.ok(r.details.some((d) => /firing confirmed/i.test(d)), 'expected a firing-confirmed detail');
});

test('script but no cookies -> positive (installed, firing not confirmed)', () => {
  const r = analyzeTracking(SCRIPT, [], 'https://warbble.com');
  assert.equal(r.status, 'positive');
  assert.equal(r.portalId, '5368814');
  assert.equal(r.cookiesFound, false);
});

test('no HubSpot script -> negative', () => {
  const r = analyzeTracking('<html><body>hello</body></html>', [], 'https://example.com');
  assert.equal(r.status, 'negative');
  assert.equal(r.scriptFound, false);
});

test('hs-analytics.net script host is also detected', () => {
  const html = '<script src="https://js.hs-analytics.net/analytics/1700000000/5368814.js"></script>';
  const r = analyzeTracking(html, [], 'https://x.com');
  assert.equal(r.status, 'positive');
  assert.equal(r.portalId, '5368814');
});

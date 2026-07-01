import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreeEmail } from '../lib/freeEmailDomains.js';

test('blocks common free/personal providers', () => {
  for (const e of ['a@gmail.com', 'b@yahoo.co.uk', 'c@hotmail.com', 'd@icloud.com', 'e@proton.me', 'f@aol.com']) {
    assert.equal(isFreeEmail(e), true, `${e} should be blocked`);
  }
});

test('blocks disposable providers', () => {
  assert.equal(isFreeEmail('x@mailinator.com'), true);
  assert.equal(isFreeEmail('x@yopmail.com'), true);
});

test('allows business domains', () => {
  for (const e of ['greg@warbble.com', 'sales@hubspot.com', 'jane@acme.co']) {
    assert.equal(isFreeEmail(e), false, `${e} should be allowed`);
  }
});

test('is case-insensitive and trims', () => {
  assert.equal(isFreeEmail('Person@GMAIL.com'), true);
  assert.equal(isFreeEmail('person@gmail.com '), true);
});

test('returns false for empty/invalid input', () => {
  assert.equal(isFreeEmail(''), false);
  assert.equal(isFreeEmail(null), false);
  assert.equal(isFreeEmail('notanemail'), false);
  assert.equal(isFreeEmail(undefined), false);
});

test('uses the domain after the last @ (subaddressing safe)', () => {
  assert.equal(isFreeEmail('weird@name@gmail.com'), true);
  assert.equal(isFreeEmail('weird@name@acme.com'), false);
});

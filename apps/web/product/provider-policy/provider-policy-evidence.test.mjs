import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const evidenceRoot = new URL(
  '../../../../features/004-openclaw-atlas-poc/evidence/provider-policies/',
  import.meta.url,
);
const decisions = new Set(['allow', 'deny', 'pending']);
const uses = ['read', 'request', 'chat', 'prompt', 'durable', 'leaflet'];

function load(filename) {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(filename, evidenceRoot)), 'utf8'),
  );
}

test('Google and Foursquare evidence templates are versioned and complete before activation', () => {
  const documents = [
    load('google-2026-09-13.v1.json'),
    load('foursquare-2026-09-13.v1.json'),
  ];

  for (const document of documents) {
    assert.equal(document.schemaVersion, 1);
    assert.match(document.policyVersion, /^.+-2026-09-13-v1$/u);
    assert.equal(document.status, 'pending_review');
    assert.ok(document.credentialScopes.length > 0);
    assert.equal(document.credential.secretLocation, 'cloudflare_secret');
    assert.ok(
      document.origins.every((origin) => origin.startsWith('https://')),
    );
    assert.ok(document.termsEvidence.length > 0);
    assert.ok(
      document.termsEvidence.every(
        (item) =>
          item.url.startsWith('https://') && item.reviewStatus.length > 0,
      ),
    );
    assert.ok(document.attribution.chat.label.length > 0);
    assert.ok(document.attribution.chat.url.startsWith('https://'));
    assert.equal(document.cache.crossRequest, 'deny');
    assert.ok(document.limits.requests > 0);
    assert.ok(document.limits.costUsd > 0);

    for (const field of Object.values(document.fields)) {
      assert.deepEqual(Object.keys(field).sort(), [...uses].sort());
      for (const use of uses) assert.ok(decisions.has(field[use]));
    }
  }
});

test('Foursquare rating remains registered but fully fail-closed until API agreement evidence exists', () => {
  const foursquare = load('foursquare-2026-09-13.v1.json');

  assert.equal(foursquare.agreementEvidence, null);
  assert.deepEqual(foursquare.fields.rating, {
    read: 'pending',
    request: 'pending',
    chat: 'pending',
    prompt: 'deny',
    durable: 'deny',
    leaflet: 'deny',
  });
  assert.equal(
    Object.values(foursquare.fields.rating).includes('allow'),
    false,
  );
});

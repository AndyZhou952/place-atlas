import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('../features/atlas/atlas-screen.tsx', import.meta.url),
  'utf8',
);
const termsSource = await readFile(
  new URL('./terms/page.tsx', import.meta.url),
  'utf8',
);
const privacySource = await readFile(
  new URL('./privacy/page.tsx', import.meta.url),
  'utf8',
);

void test('the public Atlas shell exposes native semantic links to policy routes', () => {
  assert.match(screenSource, /<footer className="site-footer"/u);
  assert.match(screenSource, /<nav[^>]*aria-label="Legal"/u);
  assert.match(screenSource, /<Link href="\/terms">Terms<\/Link>/u);
  assert.match(screenSource, /<Link href="\/privacy">Privacy<\/Link>/u);
});

void test('Terms publicly explains route estimates, provider attribution, and service limits', () => {
  assert.match(termsSource, /export const metadata/u);
  assert.match(termsSource, /Route estimates/u);
  assert.match(termsSource, /Google Maps Platform/u);
  assert.match(termsSource, /not a guarantee/u);
  assert.match(termsSource, /<Link href="\/privacy"/u);
});

void test('Privacy publicly explains request-only location handling and links provider policy', () => {
  assert.match(privacySource, /export const metadata/u);
  assert.match(privacySource, /Location hints/u);
  assert.match(privacySource, /not\s+written to the Atlas database/u);
  assert.match(privacySource, /not sent\s+to\s+the language model/u);
  assert.match(privacySource, /https:\/\/policies\.google\.com\/privacy/u);
  assert.match(privacySource, /<Link href="\/terms"/u);
});

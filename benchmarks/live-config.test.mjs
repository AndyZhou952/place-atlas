import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTestBaseUrl } from './live-config.mjs';

test('live runners require an explicitly chosen deployment', () => {
  assert.throws(() => requireTestBaseUrl(''));
  assert.equal(
    requireTestBaseUrl('https://test-atlas.example/'),
    'https://test-atlas.example',
  );
  for (const value of [
    'http://test-atlas.example',
    'https://user:pass@test-atlas.example',
    'https://test-atlas.example/path',
    'https://test-atlas.example?token=example',
    'https://test-atlas.example/#example',
  ]) {
    assert.throws(() => requireTestBaseUrl(value));
  }
});

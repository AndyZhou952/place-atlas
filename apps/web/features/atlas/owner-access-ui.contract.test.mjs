import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('Owner access is a non-modal, accessible inline form with explicit interaction states', async () => {
  const source = await readFile(
    new URL('./owner-access.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /<section/u);
  assert.doesNotMatch(source, /createPortal|role=["']dialog/u);
  assert.match(source, /autoComplete="current-password"/u);
  assert.match(source, /aria-invalid=/u);
  assert.match(source, /aria-describedby=/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /<output[\s\S]*aria-live="polite"/u);
  assert.match(source, /aria-busy=/u);
  assert.match(source, /Show password/u);
  assert.match(source, /Hide password/u);
  assert.match(
    source,
    /disabled=\{state\.pending !== null\}[\s\S]*onClick=\{owner\.toggle\}/u,
  );
  assert.match(
    source,
    /disabled=\{logoutPending\}[\s\S]*onClick=\{owner\.close\}/u,
  );
  assert.match(
    source,
    /disabled=\{loginPending\}[\s\S]*onClick=\{owner\.close\}/u,
  );
});

void test('the existing Atlas header owns the login entry and renders the inline region without replacing the page', async () => {
  const source = await readFile(
    new URL('./atlas-screen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /useOwnerSession\(\)/u);
  assert.match(source, /<OwnerAccessButton/u);
  assert.match(source, /<OwnerAccessPanel/u);
  assert.match(source, /<MapWorkspace/u);
});

void test('Owner controls and form fields preserve 44px touch targets at desktop and mobile widths', async () => {
  const source = await readFile(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /\.owner-access-trigger[\s\S]*min-height:\s*2\.75rem/u);
  assert.match(
    source,
    /\.owner-password-row \[data-slot='input'\],\s*\.owner-password-row \[data-slot='button'\]\s*\{[^}]*min-height:\s*2\.75rem/u,
  );
  assert.match(source, /\.owner-access-actions[\s\S]*min-height:\s*2\.75rem/u);
  assert.match(
    source,
    /@media \(max-width: 600px\)[\s\S]*\.owner-access-panel/u,
  );
});

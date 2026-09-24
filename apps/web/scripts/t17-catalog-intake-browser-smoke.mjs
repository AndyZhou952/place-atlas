import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightRoot = process.env.T17_PLAYWRIGHT_ROOT;
assert.ok(
  playwrightRoot,
  'Set T17_PLAYWRIGHT_ROOT to a directory whose node_modules contains Playwright.',
);
const require = createRequire(join(playwrightRoot, 'package.json'));
const { chromium } = require('playwright');
const baseUrl = process.env.T17_BASE_URL ?? 'http://127.0.0.1:4317/';
const evidenceDirectory = fileURLToPath(
  new URL(
    '../../../features/005-owner-poc-unified-api/evidence/ui/t17-browser/',
    import.meta.url,
  ),
);
const conversationId = 'a'.repeat(32);
const report = { baseUrl, renderer: 'Playwright Chromium', scenarios: {} };

await mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  await capturePreview('desktop-preview', { width: 1440, height: 1100 });
  await capturePreview('mobile-preview', {
    width: 390,
    height: 844,
    isMobile: true,
  });
  await captureLoading();
  await captureErrorAndRetry();
  await captureSuccess('verified-success', 'committed_verified');
  await captureSuccess('needs-review-success', 'committed_needs_review');
  await captureConflictAndReconfirm();
} finally {
  await browser.close();
}

await writeFile(
  join(evidenceDirectory, 't17-browser-smoke-report.json'),
  `${JSON.stringify(report, undefined, 2)}\n`,
  'utf8',
);

async function capturePreview(name, viewport) {
  const fixture = await openFixture(viewport, { confirm: ['verified'] });
  try {
    await buildPreviewWithKeyboard(fixture.page, fixture.panel);
    await assertPreview(fixture.page, fixture.panel);
    report.scenarios[name] = await inspectPanel(fixture.page, fixture.panel);
    await captureCollectionViewport(
      fixture.page,
      `t17-${name}.png`,
      fixture.panel.getByText('Review the proposal'),
    );
    await captureCollectionViewport(
      fixture.page,
      `t17-${name}-actions.png`,
      fixture.panel.getByRole('button', { name: 'Confirm and save' }),
    );
  } finally {
    await fixture.context.close();
  }
}

async function captureLoading() {
  let releaseConfirm;
  const confirmGate = new Promise((resolve) => {
    releaseConfirm = resolve;
  });
  const fixture = await openFixture(
    { width: 1440, height: 1100 },
    { confirm: ['verified'], confirmGate },
  );
  try {
    await buildPreviewWithKeyboard(fixture.page, fixture.panel);
    const confirm = fixture.panel.getByRole('button', {
      name: 'Confirm and save',
    });
    const click = confirm.click();
    await fixture.panel
      .getByText('Confirming and saving…', { exact: true })
      .first()
      .waitFor();
    const loadingConfirm = fixture.panel.getByRole('button', {
      name: 'Confirming and saving…',
    });
    assert.equal(await fixture.panel.getAttribute('aria-busy'), 'true');
    assert.equal(await loadingConfirm.isDisabled(), true);
    assert.equal(
      await fixture.panel.getByRole('button', { name: 'Cancel' }).isDisabled(),
      true,
    );
    report.scenarios['confirm-loading'] = await inspectPanel(
      fixture.page,
      fixture.panel,
    );
    await captureCollectionViewport(
      fixture.page,
      't17-confirm-loading.png',
      loadingConfirm,
    );
    releaseConfirm();
    await click;
    await fixture.panel
      .getByText(/available on the verified map and Nearby/u)
      .waitFor();
  } finally {
    await fixture.context.close();
  }
}

async function captureErrorAndRetry() {
  const fixture = await openFixture(
    { width: 1440, height: 900 },
    { confirm: ['error', 'verified'] },
  );
  try {
    await buildPreviewWithKeyboard(fixture.page, fixture.panel);
    await fixture.panel
      .getByRole('button', { name: 'Confirm and save' })
      .click();
    const alert = fixture.panel.getByRole('alert');
    await alert.getByText('Fixture provider unavailable.').waitFor();
    assert.equal(await focusedText(fixture.page), 'Add needs attention');
    const retry = alert.getByRole('button', { name: 'Retry' });
    assert.ok((await retry.boundingBox()).height >= 44);
    report.scenarios['retryable-error'] = await inspectPanel(
      fixture.page,
      fixture.panel,
      { expectedFocus: 'Add needs attention' },
    );
    await captureCollectionViewport(
      fixture.page,
      't17-retryable-error.png',
      alert,
    );
    await retry.click();
    await fixture.panel
      .getByText(/available on the verified map and Nearby/u)
      .waitFor();
  } finally {
    await fixture.context.close();
  }
}

async function captureSuccess(name, status) {
  const fixture = await openFixture(
    { width: 1440, height: 900 },
    {
      confirm: [status === 'committed_verified' ? 'verified' : 'needs-review'],
    },
  );
  try {
    await buildPreviewWithKeyboard(fixture.page, fixture.panel);
    await fixture.panel
      .getByRole('button', { name: 'Confirm and save' })
      .click();
    const output = fixture.panel.locator('output[aria-live="polite"]');
    await output.waitFor();
    assert.equal(await focusedText(fixture.page), 'Place saved');
    if (status === 'committed_verified') {
      await output
        .getByText(/available on the verified map and Nearby/u)
        .waitFor();
    } else {
      await output.getByText(/saved to Owner review/u).waitFor();
      await output
        .getByText(/not visible on the public map or Nearby yet/u)
        .waitFor();
    }
    report.scenarios[name] = await inspectPanel(fixture.page, fixture.panel, {
      expectedFocus: 'Place saved',
    });
    await captureCollectionViewport(fixture.page, `t17-${name}.png`, output);
  } finally {
    await fixture.context.close();
  }
}

async function captureConflictAndReconfirm() {
  const fixture = await openFixture(
    { width: 1440, height: 1100 },
    { confirm: ['conflict', 'verified'] },
  );
  try {
    await buildPreviewWithKeyboard(fixture.page, fixture.panel);
    await fixture.panel
      .getByRole('button', { name: 'Confirm and save' })
      .click();
    const alert = fixture.panel.getByRole('alert');
    await alert.getByText('Evidence changed during confirmation.').waitFor();
    await alert.getByText('Preview v5').waitFor();
    await alert.getByText(/4\.25 · 338 reviews/u).waitFor();
    await alert.getByText(/Nothing new was saved/u).waitFor();
    assert.equal(await focusedText(fixture.page), 'Preview changed');
    const reconfirm = alert.getByRole('button', {
      name: 'Review changed preview and confirm again',
    });
    assert.ok((await reconfirm.boundingBox()).height >= 44);
    report.scenarios['confirm-conflict'] = await inspectPanel(
      fixture.page,
      fixture.panel,
      { expectedFocus: 'Preview changed' },
    );
    await captureCollectionViewport(
      fixture.page,
      't17-confirm-conflict.png',
      alert.getByText('Evidence changed during confirmation.'),
    );
    await captureCollectionViewport(
      fixture.page,
      't17-confirm-conflict-action.png',
      reconfirm,
    );
    await reconfirm.click();
    await fixture.panel
      .getByText(/available on the verified map and Nearby/u)
      .waitFor();
    report.scenarios['conflict-reconfirm'] = {
      clicked: true,
      finalText: await fixture.panel
        .getByText(/available on the verified map and Nearby/u)
        .innerText(),
    };
  } finally {
    await fixture.context.close();
  }
}

async function openFixture(viewport, scenario) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const responseIndex = { confirm: 0 };
  await page.route('**/api/auth/owner', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true }),
    }),
  );
  await page.route('**/api/catalog-intake/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const endpoint = pathname.split('/').at(-1);
    if (endpoint === 'discover') {
      return fulfillJson(route, discoverOutput());
    }
    if (endpoint === 'select') {
      return fulfillJson(route, previewOutput(4));
    }
    if (endpoint === 'cancel') {
      return fulfillJson(route, {
        status: 'cancelled',
        sessionId: 'session-browser-fixture',
        sessionVersion: 6,
      });
    }
    assert.equal(endpoint, 'confirm');
    if (scenario.confirmGate) await scenario.confirmGate;
    const responseKind =
      scenario.confirm[responseIndex.confirm++] ?? scenario.confirm.at(-1);
    if (responseKind === 'error') {
      return fulfillJson(
        route,
        {
          code: 'dependency_failure',
          message: 'Fixture provider unavailable.',
          retryable: true,
        },
        503,
      );
    }
    if (responseKind === 'conflict') {
      return fulfillJson(route, {
        status: 'conflict',
        newPreview: fullPreview(5, { score: 4.25, reviewCount: 338 }),
      });
    }
    return fulfillJson(route, {
      status:
        responseKind === 'needs-review'
          ? 'committed_needs_review'
          : 'committed_verified',
      itemId: `item-${responseKind}`,
      receiptRef: `receipt-${responseKind}`,
      replayed: false,
    });
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('.catalog-intake');
  await panel.waitFor();
  await page.waitForFunction(() => {
    const form = document.querySelector('.catalog-intake-search');
    return Boolean(
      form && Object.keys(form).some((key) => key.startsWith('__reactProps')),
    );
  });
  return { context, page, panel };
}

async function buildPreviewWithKeyboard(page, panel) {
  const query = panel.getByLabel('Restaurant name or address');
  await query.focus();
  await page.keyboard.type('Sushi Aozora, Ginza');
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'catalog-intake-query',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    'Find matches',
  );
  await page.keyboard.press('Enter');
  await panel.getByText('Select a match').waitFor();
  await panel.getByRole('button', { name: 'Build preview' }).click();
  await panel.getByText('Preview v4').waitFor();
  assert.equal(await focusedText(page), 'Review the proposal');
}

async function assertPreview(page, panel) {
  for (const value of [
    '4.21 · 321 reviews',
    'Reservation required · 30 days ahead',
    'Agent observed · stale',
    'Possible duplicates',
    'Still unknown: walk-in queue status.',
    'Tabelog evidence may be stale.',
  ]) {
    await panel
      .getByText(new RegExp(escapeRegExp(value), 'u'))
      .first()
      .waitFor();
  }
  const confirm = panel.getByRole('button', { name: 'Confirm and save' });
  assert.ok((await confirm.boundingBox()).height >= 44);
  await page.keyboard.press('Tab');
  const focusStyle = await page.evaluate(() => {
    const element = document.activeElement;
    const style = element ? getComputedStyle(element) : undefined;
    return {
      text: element?.textContent?.trim(),
      outlineStyle: style?.outlineStyle,
      outlineWidth: style?.outlineWidth,
    };
  });
  assert.notEqual(focusStyle.outlineStyle, 'none');
  report.scenarios['keyboard-focus'] = focusStyle;
}

async function inspectPanel(page, panel, extra = {}) {
  const geometry = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      fontFamily: style.fontFamily,
      ariaBusy: element.getAttribute('aria-busy'),
    };
  });
  assert.equal(geometry.noHorizontalOverflow, true);
  const ariaSnapshot =
    typeof panel.ariaSnapshot === 'function'
      ? await panel.ariaSnapshot()
      : await panel.innerText();
  if (extra.expectedFocus) {
    assert.equal(await focusedText(page), extra.expectedFocus);
  }
  return { ...extra, geometry, ariaSnapshot };
}

async function captureCollectionViewport(page, filename, target) {
  await target.scrollIntoViewIfNeeded();
  await page.locator('.collection-panel').screenshot({
    path: join(evidenceDirectory, filename),
  });
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    headers: {
      'content-type': 'application/json',
      'x-atlas-web-conversation-id': conversationId,
    },
    body: JSON.stringify(body),
  });
}

function discoverOutput() {
  return {
    status: 'candidates_ready',
    sessionId: 'session-browser-fixture',
    sessionVersion: 1,
    candidates: [
      {
        ordinal: 1,
        transientName: 'Sushi Aozora',
        transientAddress: '8-3-1 Ginza, Chuo City, Tokyo',
        attribution: {
          label: 'Google Maps',
          url: 'https://maps.google.com/',
        },
      },
    ],
    hasMore: false,
    expiresAt: '2026-09-23T12:30:00.000Z',
  };
}

function previewOutput(version) {
  return {
    status: 'preview_ready',
    sessionId: 'session-browser-fixture',
    sessionVersion: version,
    expiresAt: '2026-09-23T12:30:00.000Z',
    preview: fullPreview(version),
  };
}

function fullPreview(version, tabelog = { score: 4.21, reviewCount: 321 }) {
  return {
    sessionId: 'session-browser-fixture',
    previewVersion: version,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: 'ChIJ-atlas-aoyama',
    },
    ownerFields: { area: 'Ginza' },
    titleProposal: {
      provenance: 'agent_observed',
      value: 'Sushi Aozora',
      sourceUrl: 'https://restaurant.example/name',
      observedAt: '2026-09-23T12:00:00.000Z',
    },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: '8-3-1 Ginza, Chuo City, Tokyo',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '8-3-1 Ginza, Chuo City, Tokyo',
      latitude: 35.671,
      longitude: 139.765,
      provider: 'Fixture durable geocoder',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    tabelog: {
      status: 'known',
      ...tabelog,
      url: 'https://tabelog.com/tokyo/example/',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:02:00.000Z',
      freshness: 'stale',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Reservation required',
      advanceDays: 30,
      bookingWindowLabel: 'Book one month ahead',
      releaseNote: 'Seats release monthly',
      channel: 'Official website',
      url: 'https://restaurant.example/reservations',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:03:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [
      {
        itemId: 'existing-1',
        title: 'Sushi Aozora Annex',
        address: '8-3-2 Ginza, Chuo City, Tokyo',
        match: 'strong',
      },
    ],
    unknownFields: ['walk-in queue status'],
    warnings: [
      { code: 'stale_evidence', message: 'Tabelog evidence may be stale.' },
    ],
    evidenceDigest: 'a'.repeat(64),
    catalogRevision: 'catalog-r1',
    expiresAt: '2026-09-23T12:30:00.000Z',
  };
}

function focusedText(page) {
  return page.evaluate(() => document.activeElement?.textContent?.trim());
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// Explicitly opt in: creates temporary Visits/photos and deletes only those IDs.
// npm package `playwright` must be available, or set PLAYWRIGHT_MODULE to its entry.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (
  process.env.ALLOW_RECORD_SMOKE_WRITES !== 'yes' ||
  !process.env.OWNER_TEST_PASSWORD
) {
  throw new Error('Set ALLOW_RECORD_SMOKE_WRITES=yes and OWNER_TEST_PASSWORD.');
}
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const base = process.env.ATLAS_BASE_URL || 'http://localhost:3000';
const marker = `record-smoke-${randomUUID()}`;
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
const visitIds = new Set();
const headers = () => ({ origin: base, 'x-atlas-mutation-id': randomUUID() });
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const photos = [1, 2].map((n) => ({
  name: `${marker}-${n}.png`,
  mimeType: 'image/png',
  buffer: png,
}));
let item;
try {
  assert.equal(
    (
      await context.request.post(`${base}/api/auth/owner`, {
        headers: { origin: base },
        data: { password: process.env.OWNER_TEST_PASSWORD },
      })
    ).status(),
    200,
  );
  const catalog = await (await context.request.get(`${base}/api/items`)).json();
  const items = Array.isArray(catalog) ? catalog : catalog.items;
  item = items.find((entry) => entry.kind === 'food' && entry.tabelog);
  assert.ok(item, 'Need an existing restaurant with an external rating');
  const initialAssessment = await (
    await context.request.get(`${base}/api/items/${item.id}/personal`)
  ).json();
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('Page error:', error.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/'))
      console.log(
        'Read failed:',
        new URL(request.url()).pathname,
        request.failure()?.errorText,
      );
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400)
      console.log(
        'API status:',
        new URL(response.url()).pathname,
        response.status(),
      );
  });
  page.setDefaultTimeout(45000);
  if (process.env.RECORD_API_BRIDGE === 'yes') {
    // Optional CI fallback: real authenticated endpoints, no mocked responses.
    // Report this mode separately from native browser-network acceptance.
    await page.route('**/api/**', async (route) => {
      const response = await context.request.fetch(route.request());
      await route.fulfill({ response });
    });
    console.log(
      'CI API bridge enabled: requests forwarded to real production endpoints',
    );
  }
  // Map tiles are irrelevant to Record and expensive in constrained CI.
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  page.on('response', async (response) => {
    if (
      response.url() === `${base}/api/journal` &&
      response.request().method() === 'POST' &&
      response.ok()
    ) {
      const body = await response.json();
      const id = body.result?.visit?.id;
      if (id) visitIds.add(id);
    }
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  console.log(
    'Journal loaded',
    JSON.stringify({
      target: item.id,
      options: await page
        .locator('#journal-visit-place option')
        .evaluateAll((options) =>
          options.map((o) => ({ value: o.value, label: o.textContent })),
        ),
      notice: await page.locator('.notice-bar').allTextContents(),
    }),
  );
  await page
    .locator('#journal-visit-place')
    .selectOption(item.id, { timeout: 180000 });
  await page.locator('#journal-visit-rating').fill('');
  await page.locator('#journal-visited-at').fill('2026-09-20');
  await page.locator('#journal-visit-note').fill(marker);
  await page.locator('.visit-composer input[type=file]').setInputFiles(photos);
  await page.getByRole('button', { name: 'Save visit', exact: true }).click();
  await page
    .getByText('Visit saved. You can edit it in the history below.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Visit saved', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(visitIds.size, 1);
  const visitId = [...visitIds][0];
  let row = page.locator('.journal-visit').filter({ hasText: marker });
  await row
    .getByRole('button', { name: `Open ${photos[0].name}`, exact: true })
    .click();
  const viewer = page.getByRole('dialog', { name: 'Visit photo viewer' });
  await viewer
    .getByLabel(`Caption for ${photos[0].name}`, { exact: true })
    .fill(`${marker} caption`);
  const captionSaved = page.waitForResponse(
    (r) =>
      r.url().includes('/api/media/') &&
      r.request().method() === 'PATCH' &&
      r.ok(),
  );
  await viewer
    .getByLabel(`Caption for ${photos[0].name}`, { exact: true })
    .press('Enter');
  await captionSaved;
  await viewer
    .getByRole('button', { name: 'Close photo viewer', exact: true })
    .click();
  await row.getByRole('button', { name: /Edit visit/ }).click();
  await page.locator(`#visit-date-${visitId}`).fill('2026-09-21');
  await page.locator(`#visit-note-${visitId}`).fill(`${marker} edited`);
  await page
    .locator('.journal-visit-form')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page.getByText(`${marker} edited`, { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  row = page.locator('.journal-visit').filter({ hasText: `${marker} edited` });
  await row
    .getByRole('button', { name: `Open ${marker} caption`, exact: true })
    .waitFor();
  assert.match(await row.innerText(), /2026-09-21/);
  const media = await (
    await context.request.get(`${base}/api/media?visitId=${visitId}`)
  ).json();
  assert.equal(media.length, 2);
  assert.ok(media.some((entry) => entry.caption === `${marker} caption`));
  for (const entry of media) {
    const image = await context.request.get(
      new URL(entry.contentUrl, base).href,
    );
    assert.equal(image.status(), 200);
    assert.ok((await image.body()).length > 0);
  }
  console.log(
    'PASS Journal create, two real photos, caption viewer edit, date/note edit and reload',
  );
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByLabel('Search Atlas items').fill(item.title);
  await page
    .locator('.place-list strong')
    .filter({ hasText: item.title })
    .first()
    .click();
  await page
    .locator('.detail-card')
    .getByText(`${marker} edited`, { exact: true })
    .waitFor();
  console.log('PASS the same Visit appears in the restaurant card');
  const freshCatalog = await (
    await context.request.get(`${base}/api/items`)
  ).json();
  const fresh = (
    Array.isArray(freshCatalog) ? freshCatalog : freshCatalog.items
  ).find((entry) => entry.id === item.id);
  assert.deepEqual(fresh.tabelog, item.tabelog);
  assert.deepEqual(fresh.googleRating, item.googleRating);
  const finalAssessment = await (
    await context.request.get(`${base}/api/items/${item.id}/personal`)
  ).json();
  assert.equal(
    finalAssessment.personalRating,
    initialAssessment.personalRating,
  );
  console.log('PASS external and personal scores unchanged');
} finally {
  for (const id of visitIds) {
    const response = await context.request.delete(
      `${base}/api/journal/${encodeURIComponent(id)}`,
      { headers: headers() },
    );
    assert.ok(
      response.ok(),
      `Temporary Visit cleanup failed: ${id} (${response.status()})`,
    );
    const remainingMedia = await (
      await context.request.get(
        `${base}/api/media?visitId=${encodeURIComponent(id)}`,
      )
    ).json();
    assert.deepEqual(remainingMedia, []);
    console.log(`Removed temporary Visit and photos: ${id}`);
  }
  await browser.close();
}

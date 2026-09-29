// Explicitly opt in: creates temporary Visits/photos and deletes only those IDs.
// npm package `playwright` must be available, or set PLAYWRIGHT_MODULE to its entry.
// RECORD_FAIL_SECOND_MEDIA=yes verifies retry after one successful upload batch.
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
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
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
const injectMediaFailure = process.env.RECORD_FAIL_SECOND_MEDIA === 'yes';
const photos = (injectMediaFailure ? [1, 2, 3, 4, 5] : [1, 2]).map((n) => ({
  name: `${marker}-${n}.png`,
  mimeType: 'image/png',
  buffer: png,
}));
let item;
let initialAssessment;
let ratingRestorationRequired = false;
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
  initialAssessment = await (
    await context.request.get(`${base}/api/items/${item.id}/personal`)
  ).json();
  const page = await context.newPage();
  const journalReads = [];
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
  page.on('response', async (response) => {
    if (
      response.url() === `${base}/api/journal` &&
      response.request().method() === 'GET' &&
      response.ok()
    ) {
      journalReads.push({
        status: response.status(),
        ids: (await response.json()).map((entry) => entry.id),
      });
    }
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
  if (injectMediaFailure) {
    let mediaPosts = 0;
    await page.route('**/api/media', async (route) => {
      if (route.request().method() === 'POST' && ++mediaPosts === 2) {
        await route.fulfill({ status: 503, body: 'Injected upload failure' });
        return;
      }
      await route.fallback();
    });
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    try {
      await page
        .locator('#journal-visit-place-search')
        .waitFor({ timeout: 10000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  assert.equal(await page.locator('#journal-visit-place option').count(), 0);
  await page.locator('#journal-visit-place-search').fill(item.title);
  assert.ok(
    await page
      .locator('#journal-visit-place option')
      .evaluateAll(
        (options, id) => options.some((option) => option.value === id),
        item.id,
      ),
    'The typed restaurant name must reveal its saved match',
  );
  await page.locator('#journal-visit-place').selectOption(item.id);
  await page.locator('#journal-visit-rating').fill('');
  await page.locator('#journal-visited-at').fill('2026-09-20');
  await page.locator('#journal-visit-note').fill(marker);
  await page.locator('.visit-composer input[type=file]').setInputFiles(photos);
  await page.getByRole('button', { name: 'Save visit', exact: true }).click();
  if (injectMediaFailure) {
    await page
      .getByRole('alert')
      .getByText(/some media did not upload/)
      .waitFor();
  } else {
    await page.getByRole('status').getByText('Visit saved').waitFor();
  }
  assert.equal(
    await page
      .getByRole('button', { name: 'Visit saved', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(visitIds.size, 1);
  const visitId = [...visitIds][0];
  if (injectMediaFailure) {
    assert.equal(
      await page
        .getByRole('button', { name: 'Visit saved', exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Retry media upload' }).click();
    await page.getByRole('status').getByText('Visit saved').waitFor();
    assert.equal(visitIds.size, 1, 'retry must not create a second Visit');
  }
  await page
    .getByRole('status')
    .getByText('Visit saved')
    .waitFor({ state: 'hidden' });
  assert.equal(
    await page
      .getByRole('button', { name: 'Save visit', exact: true })
      .isEnabled(),
    true,
    'The form must become ready again without another button',
  );
  assert.equal(visitIds.size, 1, 'unlocking must not save another Visit');
  let row = page.locator('.journal-visit').filter({ hasText: marker });
  await row.locator('.media-thumbnail-frame').first().hover();
  const thumbnailDelete = row.getByRole('button', {
    name: `Delete ${photos[0].name}`,
  });
  assert.equal(await thumbnailDelete.isVisible(), true);
  page.once('dialog', (dialog) => dialog.dismiss());
  await thumbnailDelete.click();
  assert.equal(visitIds.size, 1, 'cancelled media removal keeps the Visit');
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
  const mediaScoreSaved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/media/') &&
      response.request().method() === 'PATCH' &&
      response.ok() &&
      response.request().postDataJSON()?.score === 4.2,
  );
  await viewer.getByLabel(`Score for ${photos[0].name}`).fill('4.2');
  await viewer.getByLabel(`Score for ${photos[0].name}`).press('Enter');
  await mediaScoreSaved;
  await viewer
    .getByRole('button', { name: 'Close photo viewer', exact: true })
    .click();
  await row.getByRole('button', { name: /Edit visit/ }).click();
  await page.locator(`#visit-date-${visitId}`).fill('2026-09-21');
  await page.locator(`#visit-note-${visitId}`).fill(`${marker} edited`);
  const visitEditSaved = page.waitForResponse(
    (response) =>
      response.url() === `${base}/api/journal/${visitId}` &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await page
    .locator('.journal-visit-form')
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await visitEditSaved;
  await page.getByText(`${marker} edited`, { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await page.locator('#journal-visit-place-search').waitFor();
  row = page.locator('.journal-visit').filter({ hasText: `${marker} edited` });
  try {
    await row
      .getByRole('button', { name: `Open ${marker} caption`, exact: true })
      .waitFor();
  } catch (error) {
    console.log(
      'Reload diagnostic',
      JSON.stringify({
        journalRows: await page.locator('.journal-visit').count(),
        rowText: await row.allTextContents(),
        notices: await page.locator('.notice-bar').allTextContents(),
        journalReads,
        pageJournalIds: await page.evaluate(async () =>
          (
            await (await fetch('/api/journal', { cache: 'no-store' })).json()
          ).map((entry) => entry.id),
        ),
        requestJournalIds: (
          await (await context.request.get(`${base}/api/journal`)).json()
        ).map((entry) => entry.id),
        media: await (
          await context.request.get(`${base}/api/media?visitId=${visitId}`)
        ).json(),
      }),
    );
    throw error;
  }
  assert.match(await row.innerText(), /2026-09-21/);
  const media = await (
    await context.request.get(`${base}/api/media?visitId=${visitId}`)
  ).json();
  assert.equal(media.length, photos.length);
  assert.ok(media.some((entry) => entry.caption === `${marker} caption`));
  assert.equal(
    media.find((entry) => entry.originalFilename === photos[0].name)?.score,
    4.2,
  );
  assert.equal(
    media.find((entry) => entry.originalFilename === photos[1].name)?.score,
    undefined,
  );
  await row.getByLabel(`Score for ${photos[0].name}`).waitFor();
  assert.equal(
    await row.getByLabel(`Score for ${photos[0].name}`).inputValue(),
    '4.2',
  );
  for (const entry of media) {
    const image = await context.request.get(
      new URL(entry.contentUrl, base).href,
    );
    assert.equal(image.status(), 200);
    assert.ok((await image.body()).length > 0);
  }
  console.log(
    'PASS Journal create, real photos, caption and per-media score edits, date/note edit and reload',
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

  const changedRating = initialAssessment.personalRating === 4.5 ? 3.5 : 4.5;
  ratingRestorationRequired = true;
  await page.locator('.detail-card .personal-rating-inline').click();
  const ratingSaved = page.waitForResponse(
    (response) =>
      response.url() === `${base}/api/items/${item.id}/personal` &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await page
    .getByLabel('マイスコア', { exact: true })
    .fill(String(changedRating));
  await page.getByLabel('マイスコア', { exact: true }).press('Enter');
  await ratingSaved;
  assert.equal(
    (
      await (
        await context.request.get(`${base}/api/items/${item.id}/personal`)
      ).json()
    ).personalRating,
    changedRating,
  );
  const catalogAfterRating = await (
    await context.request.get(`${base}/api/items`)
  ).json();
  const ratedItem = (
    Array.isArray(catalogAfterRating)
      ? catalogAfterRating
      : catalogAfterRating.items
  ).find((entry) => entry.id === item.id);
  assert.deepEqual(ratedItem.tabelog, item.tabelog);
  assert.deepEqual(ratedItem.googleRating, item.googleRating);
  const visitAfterRating = await (
    await context.request.get(`${base}/api/journal/${visitId}`)
  ).json();
  assert.equal(visitAfterRating.displayNote, `${marker} edited`);
  console.log('PASS browser rating edit preserves external scores and Visit');

  await page.locator('.detail-card .personal-rating-inline').click();
  const ratingRestored = page.waitForResponse(
    (response) =>
      response.url() === `${base}/api/items/${item.id}/personal` &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  );
  await page
    .getByLabel('マイスコア', { exact: true })
    .fill(initialAssessment.personalRating?.toString() ?? '');
  await page.getByLabel('マイスコア', { exact: true }).press('Enter');
  await ratingRestored;
  assert.equal(
    (
      await (
        await context.request.get(`${base}/api/items/${item.id}/personal`)
      ).json()
    ).personalRating,
    initialAssessment.personalRating,
  );
  ratingRestorationRequired = false;
} finally {
  if (ratingRestorationRequired && item && initialAssessment) {
    const restored = await context.request.patch(
      `${base}/api/items/${item.id}/personal`,
      {
        headers: headers(),
        data: { overallRating: initialAssessment.personalRating ?? null },
      },
    );
    assert.ok(restored.ok(), 'Personal score restoration failed');
  }
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

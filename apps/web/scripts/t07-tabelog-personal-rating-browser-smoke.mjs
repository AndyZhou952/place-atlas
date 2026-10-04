import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const playwrightRoot = process.env.T07_PLAYWRIGHT_ROOT;
assert.ok(playwrightRoot, 'T07_PLAYWRIGHT_ROOT is required');
const baseUrl = process.env.T07_BASE_URL ?? 'http://127.0.0.1:4319/';
const outputDirectory = resolve(
  process.env.T07_EVIDENCE_DIR ?? '../../artifacts/evidence/ui',
);
const require = createRequire(join(playwrightRoot, 'package.json'));
const { chromium } = require('playwright');

const itemId = 'spicy-curry-roka';
const tabelogUrl = 'https://tabelog.com/tokyo/A1304/A130404/13286023/';
let personalRating;
let mutationRequests = 0;

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await installRoutes(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await assertTabelogOnly(page);

  await page
    .getByRole('button', {
      name: 'マイスコア 未評価。Click to edit',
      exact: true,
    })
    .click();
  const input = page.getByRole('spinbutton', { name: 'マイスコア' });
  await input.fill('3.5');
  await input.press('Enter');
  await assertBothRatings(page);
  assert.equal(mutationRequests, 1);
  const immediateState = await observedRatings(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertBothRatings(page);
  const reloadState = await observedRatings(page);

  const screenshot = join(
    outputDirectory,
    't07-tabelog-and-personal-rating-desktop.png',
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  const report = {
    renderer: 'Playwright Chromium',
    baseUrl,
    viewport: { width: 1440, height: 1000 },
    fixture: {
      title: 'SPICY CURRY 魯珈',
      persistedTabelog: 3.87,
      savedPersonalRating: 3.5,
    },
    mutationRequests,
    immediateState,
    reloadState,
    screenshot: 'evidence/ui/t07-tabelog-and-personal-rating-desktop.png',
    screenshotSha256: createHash('sha256')
      .update(await readFile(screenshot))
      .digest('hex'),
  };
  await writeFile(
    join(outputDirectory, 't07-tabelog-personal-rating-report.json'),
    `${JSON.stringify(report, undefined, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

async function installRoutes(target) {
  await target.route('**/api/auth/owner', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true }),
    }),
  );
  await target.route('**/api/owner/catalog/review-candidates', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await target.route(`**/api/items/${itemId}/personal`, async (route) => {
    if (route.request().method() === 'PATCH') {
      mutationRequests += 1;
      assert.deepEqual(route.request().postDataJSON(), { overallRating: 3.5 });
      assert.match(
        route.request().headers()['x-atlas-mutation-id'],
        /^[A-Za-z0-9._:-]{1,160}$/u,
      );
      personalRating = 3.5;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          mutationId: route.request().headers()['x-atlas-mutation-id'],
          payloadDigest: 'a'.repeat(64),
          replayed: false,
          result: {
            assessment: {
              itemId,
              overallRating: 3.5,
              isFavorite: false,
              manualVisited: false,
              updatedAt: '2026-09-24T09:00:00.000Z',
            },
            item: browserItem(3.5),
          },
        }),
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        itemId,
        favorite: false,
        manualVisited: false,
        effectiveVisited: false,
        ...(personalRating === undefined ? {} : { personalRating }),
      }),
    });
  });
  await target.route('**/api/items', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([publicItem()]),
    }),
  );
  await target.route('**/api/visits*', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await target.route('**/api/journal*', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await target.route('**/api/media*', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await target.route('**/*.tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
}

async function assertTabelogOnly(target) {
  const row = await placeRow(target);
  await row.getByText('食べログ 3.87', { exact: true }).waitFor();
  assert.equal(await row.getByText(/^マイ /u).count(), 0);
  const detail = target.locator('.detail-card');
  await detail.getByText('未評価', { exact: true }).waitFor();
  await detail.getByText('3.87', { exact: true }).waitFor();
}

async function assertBothRatings(target) {
  const row = await placeRow(target);
  await row.getByText('マイ 3.5', { exact: true }).waitFor();
  await row.getByText('食べログ 3.87', { exact: true }).waitFor();
  const detail = target.locator('.detail-card');
  await detail.getByText('マイスコア', { exact: true }).waitFor();
  await detail.getByText('3.5', { exact: true }).waitFor();
  await detail.getByText('食べログ', { exact: true }).waitFor();
  await detail.getByText('3.87', { exact: true }).waitFor();
}

async function placeRow(target) {
  const row = target.locator('.place-row').filter({
    hasText: 'SPICY CURRY 魯珈',
  });
  await row.waitFor();
  return row;
}

async function observedRatings(target) {
  const row = await placeRow(target);
  const detail = target.locator('.detail-card');
  return {
    list: await row.locator('.list-rating-group').innerText(),
    detail: await detail.locator('.rating-strip').innerText(),
  };
}

function publicItem() {
  return {
    id: itemId,
    kind: 'food',
    title: 'SPICY CURRY 魯珈',
    area: '大久保・新宿',
    address: '東京都新宿区百人町1丁目24-8',
    description: 'Added through Atlas Catalog intake.',
    latitude: 35.7008,
    longitude: 139.6972,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-24T08:00:00.000Z',
    tabelog: {
      status: 'known',
      score: 3.87,
      url: tabelogUrl,
      provenance: 'owner_asserted',
      assertedAt: '2026-09-24T08:00:00.000Z',
      freshness: 'fresh',
    },
    reservation: { status: 'unknown' },
    tags: ['curry'],
    sources: [{ label: 'Tabelog', url: tabelogUrl, role: 'tabelog' }],
  };
}

function browserItem(score) {
  return {
    ...publicItem(),
    tabelog: {
      score: 3.87,
      url: tabelogUrl,
      checkedAt: '2026-09-24T08:00:00.000Z',
    },
    reservation: { mode: 'unknown', label: 'Unknown' },
    personalState: 'saved',
    personalRating: score,
    isFavorite: false,
    hasVisited: false,
  };
}

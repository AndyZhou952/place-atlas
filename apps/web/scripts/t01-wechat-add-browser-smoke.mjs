import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { presentWechatCatalogIntake } from '../product/application/conversation/wechat-catalog-intake-presenter.ts';

const playwrightRoot = process.env.T01_PLAYWRIGHT_ROOT;
assert.ok(
  playwrightRoot,
  'Set T01_PLAYWRIGHT_ROOT to a directory whose node_modules contains Playwright.',
);
const require = createRequire(join(playwrightRoot, 'package.json'));
const { chromium } = require('playwright');
const evidenceDirectory = fileURLToPath(
  new URL(
    '../../../features/006-agent-add-experience/evidence/t01-wechat/',
    import.meta.url,
  ),
);
const viewport = { width: 390, height: 844 };
const report = {
  renderer: 'Playwright Chromium',
  viewport,
  productionPresenter:
    'apps/web/product/application/conversation/wechat-catalog-intake-presenter.ts',
  scenarios: {},
};

const scenarios = {
  'three-candidates': {
    fixture: 'three transient Google candidates',
    input: {
      state: 'candidates',
      output: {
        status: 'candidates_ready',
        sessionId: 'render-session',
        sessionVersion: 1,
        candidates: [
          candidate(1, '鮨 青空', '東京都中央区銀座8丁目10-2'),
          candidate(2, '鮨 青空 丸の内店', '東京都千代田区丸の内1丁目9-1'),
          candidate(3, '青空食堂', '東京都港区芝公園4丁目2-8'),
        ],
        hasMore: false,
        expiresAt: '2026-09-24T12:00:00.000Z',
      },
    },
  },
  'complete-preview': {
    fixture: 'known location, Tabelog, and reservation preview',
    input: { state: 'preview', preview: previewFixture() },
  },
  'warning-conflict': {
    fixture: 'conflict with two duplicate and four coded warnings',
    input: {
      state: 'conflict',
      preview: previewFixture({
        suspectedDuplicates: [
          { itemId: 'duplicate-b', title: '鮨 青空（旧档）', match: 'strong' },
          { itemId: 'duplicate-a', title: '銀座 鮨青空', match: 'strong' },
        ],
        warnings: [
          { code: 'stale_evidence', message: 'raw stale message' },
          { code: 'provider_unavailable', message: 'raw provider message' },
          { code: 'needs_review', message: 'raw review message' },
          { code: 'source_conflict', message: 'raw conflict message' },
        ],
      }),
    },
  },
  success: {
    fixture: 'committed needs-review outcome',
    input: { state: 'success', status: 'committed_needs_review' },
  },
  'failed-no-write': {
    fixture: 'failed-no-write outcome',
    input: { state: 'failed_no_write' },
  },
};

await mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, scenario] of Object.entries(scenarios)) {
    const replyText = presentWechatCatalogIntake(scenario.input);
    const context = await browser.newContext({ viewport, isMobile: true });
    const page = await context.newPage();
    await page.setContent(shellHtml());
    await page.locator('[data-reply]').evaluate((element, text) => {
      element.textContent = text;
    }, replyText);
    const metrics = await page.locator('[data-reply]').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      textContent: element.textContent,
    }));
    assert.equal(metrics.textContent, replyText);
    assert.equal(metrics.scrollWidth <= metrics.clientWidth, true);
    const screenshotPath = join(evidenceDirectory, `${name}-390x844.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    report.scenarios[name] = {
      fixture: scenario.fixture,
      replySha256: createHash('sha256').update(replyText).digest('hex'),
      codePoints: Array.from(replyText).length,
      utf16Characters: replyText.length,
      clientWidth: metrics.clientWidth,
      scrollWidth: metrics.scrollWidth,
      clientHeight: metrics.clientHeight,
      scrollHeight: metrics.scrollHeight,
      noHorizontalOverflow: metrics.scrollWidth <= metrics.clientWidth,
      screenshot: `evidence/t01-wechat/${name}-390x844.png`,
    };
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  join(evidenceDirectory, 'report.json'),
  `${JSON.stringify(report, undefined, 2)}\n`,
  'utf8',
);

function candidate(ordinal, transientName, transientAddress) {
  return {
    ordinal,
    transientName,
    transientAddress,
    attribution: { label: 'Google Maps', url: 'https://maps.google.com/' },
  };
}

function previewFixture(overrides = {}) {
  return {
    sessionId: 'render-session',
    previewVersion: 2,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google_places',
      placeId: 'render-place',
    },
    ownerFields: { title: '鮨 青空', area: '銀座' },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: '東京都中央区銀座8丁目10-2 ルアンビル地下1階',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-24T10:00:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '東京都中央区銀座8丁目10-2 ルアンビル地下1階',
      latitude: 35.668,
      longitude: 139.761,
      provider: 'GSI',
      sourceUrl: 'https://maps.gsi.go.jp/',
      license: 'fixture license',
      checkedAt: '2026-09-24T10:00:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.12,
      reviewCount: 421,
      url: 'https://tabelog.com/fixture',
      provenance: 'agent_observed',
      observedAt: '2026-09-24T10:00:00.000Z',
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: '需要预约',
      advanceDays: 30,
      releaseNote: '每月一日开放次月席位',
      channel: '官网',
      url: 'https://restaurant.example/reservation',
      provenance: 'agent_observed',
      observedAt: '2026-09-24T10:00:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [],
    unknownFields: [],
    warnings: [],
    evidenceDigest: 'e'.repeat(64),
    catalogRevision: 'render-revision',
    expiresAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

function shellHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; min-height: 100%; }
      body {
        background: #f3f4f6;
        color: #171717;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif;
        padding: 20px 16px;
      }
      .channel { color: #6b7280; font-size: 13px; margin: 0 0 10px 4px; }
      .row { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
      .avatar {
        align-items: center; background: #c6472d; border-radius: 8px; color: white;
        display: flex; flex: 0 0 36px; font: 600 15px/1 serif; height: 36px;
        justify-content: center; width: 36px;
      }
      [data-reply] {
        background: #fff; border: 1px solid #e2e2df; border-radius: 7px 14px 14px 14px;
        box-shadow: 0 2px 10px rgba(31, 35, 31, 0.05); flex: 1 1 auto;
        font-size: 15px; line-height: 1.48; max-width: calc(100% - 44px);
        overflow-wrap: anywhere; padding: 14px; white-space: pre-wrap; word-break: break-word;
      }
    </style>
  </head>
  <body>
    <p class="channel">微信 ClawBot · Japan Atlas</p>
    <main class="row">
      <div class="avatar" aria-hidden="true">旅</div>
      <div data-reply></div>
    </main>
  </body>
</html>`;
}

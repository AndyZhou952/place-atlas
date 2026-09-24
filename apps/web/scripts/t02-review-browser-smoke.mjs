import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const playwrightRoot = process.env.T02_PLAYWRIGHT_ROOT;
assert.ok(playwrightRoot, 'T02_PLAYWRIGHT_ROOT is required');
const baseUrl = process.env.T02_BASE_URL ?? 'http://127.0.0.1:4318/';
const outputDirectory = resolve(
  process.env.T02_EVIDENCE_DIR ??
    '../../features/006-agent-add-experience/evidence/ui',
);

const require = createRequire(join(playwrightRoot, 'package.json'));
const { chromium } = require('playwright');
await mkdir(outputDirectory, { recursive: true });

const fallbackCandidate = {
  recordType: 'review_candidate',
  id: 'candidate-render-contract',
  kind: 'food',
  title: 'Candidate place',
  description: 'Awaiting owner review',
  verificationStatus: 'needs_review',
  area: { status: 'unknown' },
  location: { status: 'unknown' },
  tabelog: { status: 'unknown' },
  reservation: { status: 'unknown' },
  unknownFields: ['address', 'coordinates'],
  warnings: [{ code: 'needs_review', message: 'Owner review is required.' }],
  personalState: 'candidate',
  isFavorite: false,
  hasVisited: false,
  tags: [],
  updatedAt: '2026-09-24T00:00:00.000Z',
};
const persistedRoutePath = process.env.T02_PERSISTED_ROUTE_FIXTURE;
const persistedPublicPath = process.env.T09_PUBLIC_ROUTE_FIXTURE;
const persistedRouteBytes = persistedRoutePath
  ? await readFile(persistedRoutePath)
  : undefined;
const persistedCandidates = persistedRouteBytes
  ? JSON.parse(persistedRouteBytes.toString('utf8'))
  : undefined;
const candidate = persistedCandidates?.[0] ?? fallbackCandidate;
const routeFixtureSha256 = persistedRouteBytes
  ? createHash('sha256').update(persistedRouteBytes).digest('hex')
  : undefined;
const persistedPublicItems = persistedPublicPath
  ? JSON.parse(await readFile(persistedPublicPath, 'utf8'))
  : undefined;

const scenarios = [
  {
    state: 'signed-out',
    viewportName: 'desktop',
    viewport: { width: 1440, height: 1000 },
    screenshot: true,
  },
  {
    state: 'list',
    viewportName: 'desktop',
    viewport: { width: 1440, height: 1000 },
    screenshot: true,
  },
  ...['loading', 'signed-out', 'error', 'empty', 'list'].map((state) => ({
    state,
    viewportName: 'mobile',
    viewport: { width: 390, height: 844 },
    screenshot: state === 'signed-out' || state === 'list',
  })),
];

const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: scenario.viewport });
    await page.route('**/api/auth/owner', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: scenario.state !== 'signed-out',
        }),
      }),
    );
    if (persistedPublicItems) {
      await page.route('**/api/items', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(persistedPublicItems),
        }),
      );
      await page.route('**/api/items/*/personal', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            favorite: false,
            effectiveVisited: false,
            overallComment: null,
          }),
        }),
      );
    }
    await page.route('**/api/owner/catalog/review-candidates', (route) => {
      if (scenario.state === 'loading') return;
      if (scenario.state === 'error') {
        return route.fulfill({ status: 503, body: 'Unavailable' });
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(scenario.state === 'list' ? [candidate] : []),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    if (persistedPublicItems && scenario.state === 'list') {
      assert.equal(
        await page.getByText(candidate.title, { exact: true }).count(),
        0,
      );
      await page
        .getByText(persistedPublicItems[0].title, { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page.locator(`[data-atlas-marker-id="${candidate.id}"]`).count(),
        0,
      );
      await page
        .locator(`[data-atlas-marker-id="${persistedPublicItems[0].id}"]`)
        .waitFor();
    }
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const workspace = page.locator('#review');
    await workspace
      .getByRole('heading', {
        name: 'Review places before they join your map.',
      })
      .waitFor();
    if (scenario.state === 'loading') {
      await workspace
        .getByText('Checking the Owner review desk…', { exact: true })
        .waitFor();
      assert.equal(
        await workspace.locator('.review-section').getAttribute('aria-busy'),
        'true',
      );
    } else if (scenario.state === 'signed-out') {
      await workspace
        .getByText('Sign in as Owner to see review candidates.', {
          exact: true,
        })
        .waitFor();
      await workspace.getByRole('button', { name: 'Owner login' }).waitFor();
    } else if (scenario.state === 'error') {
      const alert = workspace.getByRole('alert');
      await alert.getByText('Review candidates could not be loaded.').waitFor();
      await alert.getByRole('button', { name: 'Try again' }).waitFor();
    } else if (scenario.state === 'empty') {
      await workspace.getByText('No places need review.').waitFor();
      await workspace.getByRole('button', { name: 'Open Add' }).waitFor();
    } else {
      await workspace.getByText(candidate.title, { exact: true }).waitFor();
      assert.equal(
        await workspace
          .locator(`[data-review-candidate-id="${candidate.id}"]`)
          .count(),
        1,
      );
      const disclosure = workspace.getByText('Evidence details', {
        exact: true,
      });
      await disclosure.click();
      for (const warning of candidate.warnings) {
        await workspace.getByText(warning.message, { exact: true }).waitFor();
      }
    }

    const text = await workspace.innerText();
    for (const retiredLabel of [
      'Queue a creator',
      'New creator import',
      'Collector status',
      'Import jobs',
    ]) {
      assert.equal(text.includes(retiredLabel), false, retiredLabel);
    }

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workspaceClientWidth: document.querySelector('#review')?.clientWidth ?? 0,
      workspaceScrollWidth: document.querySelector('#review')?.scrollWidth ?? 0,
    }));
    assert.ok(layout.scrollWidth <= layout.clientWidth, JSON.stringify(layout));
    assert.ok(
      layout.workspaceScrollWidth <= layout.workspaceClientWidth,
      JSON.stringify(layout),
    );

    const accessibility = await workspace.evaluate((root) => {
      const primaryNames = ['Owner login', 'Try again', 'Open Add'];
      const primaryTargets = [...root.querySelectorAll('button')]
        .filter((button) =>
          primaryNames.includes(button.textContent?.trim() ?? ''),
        )
        .map((button) => {
          const box = button.getBoundingClientRect();
          return {
            name: button.textContent?.trim(),
            width: box.width,
            height: box.height,
          };
        });
      const interactiveTargets = [
        ...root.querySelectorAll('button, summary, a'),
      ].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name:
            element.textContent?.trim() || element.getAttribute('aria-label'),
          width: box.width,
          height: box.height,
        };
      });
      const ids = [...root.querySelectorAll('[id]')].map(
        (element) => element.id,
      );
      const ariaReferences = [
        ...root.querySelectorAll('[aria-labelledby], [aria-describedby]'),
      ].flatMap((element) =>
        ['aria-labelledby', 'aria-describedby'].flatMap((name) =>
          (element.getAttribute(name) ?? '').split(/\s+/u).filter(Boolean),
        ),
      );
      const unnamedButtons = [...root.querySelectorAll('button')].filter(
        (button) =>
          !(button.textContent?.trim() || button.getAttribute('aria-label')),
      ).length;
      return {
        primaryTargets,
        unnamedButtons,
        headingCount: root.querySelectorAll('h2, h3').length,
        liveRegions: root.querySelectorAll('[aria-live]').length,
        interactiveTargets,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        missingAriaReferences: ariaReferences.filter(
          (id) => !root.ownerDocument.getElementById(id),
        ),
      };
    });
    assert.equal(accessibility.unnamedButtons, 0);
    assert.ok(accessibility.headingCount > 0);
    assert.deepEqual(accessibility.duplicateIds, []);
    assert.deepEqual(accessibility.missingAriaReferences, []);
    assert.ok(
      accessibility.interactiveTargets.every(({ name }) => Boolean(name)),
    );
    if (scenario.viewportName === 'mobile') {
      for (const target of accessibility.primaryTargets) {
        assert.ok(target.width >= 44, JSON.stringify(target));
        assert.ok(target.height >= 44, JSON.stringify(target));
      }
      for (const target of accessibility.interactiveTargets) {
        assert.ok(target.width >= 44, JSON.stringify(target));
        assert.ok(target.height >= 44, JSON.stringify(target));
      }
    }

    let screenshot;
    let sha256;
    if (scenario.screenshot) {
      screenshot = join(
        outputDirectory,
        `${persistedRouteBytes ? 't09-review-persisted' : 't02-review'}-${scenario.viewportName}-${scenario.state}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      sha256 = createHash('sha256')
        .update(await readFile(screenshot))
        .digest('hex');
    }
    evidence.push({
      ...scenario,
      screenshot,
      sha256,
      layout,
      accessibility,
      ...(scenario.state === 'list'
        ? { renderedCandidateId: candidate.id, routeFixtureSha256 }
        : {}),
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(evidence, null, 2));
if (process.env.T09_REPORT_PATH) {
  await writeFile(
    process.env.T09_REPORT_PATH,
    `${JSON.stringify(
      {
        candidateId: candidate.id,
        routeFixtureSha256,
        publicCandidateAbsent:
          persistedPublicItems?.every(({ id }) => id !== candidate.id) ?? false,
        evidence,
      },
      null,
      2,
    )}\n`,
  );
}

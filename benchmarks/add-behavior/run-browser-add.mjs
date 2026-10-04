import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserAddPlan, browserAddScenarios } from './browser-fixture.mjs';

export async function runBrowserAdd({
  chromium,
  baseUrl,
  outputDirectory,
  scenarios = browserAddScenarios,
}) {
  const target = new URL(baseUrl);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname),
    'Use a local test server.',
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
      : {}),
  });
  const results = [];
  try {
    for (const width of [1440, 390, 320]) {
      for (const scenario of scenarios) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(15_000);
          const requests = [];
          const plans = browserAddPlan(scenario);
          const indices = {};
          let release;
          const gate = new Promise((resolveGate) => {
            release = resolveGate;
          });
          const pageErrors = [];
          page.on('pageerror', (error) => pageErrors.push(error.message));
          await page.route('**/api/**', async (route) => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            let response = { status: 200, body: [] };
            if (pathname === '/api/auth/owner')
              response.body = { authenticated: true };
            else if (pathname.startsWith('/api/catalog-intake/')) {
              const operation = pathname.split('/').at(-1);
              const plan = plans[operation];
              assert.ok(plan, `Unexpected Add operation: ${operation}`);
              const index = indices[operation] ?? 0;
              indices[operation] = index + 1;
              response = plan[Math.min(index, plan.length - 1)];
              requests.push({ operation, body: request.postDataJSON() });
              if (response.gate) await gate;
            } else
              assert.equal(
                request.method(),
                'GET',
                'Only intercepted Add requests may write.',
              );
            await route.fulfill({
              status: response.status,
              contentType: 'application/json',
              headers: { 'x-atlas-web-conversation-id': 'f'.repeat(32) },
              body:
                response.status === 204 ? '' : JSON.stringify(response.body),
            });
          });
          await page.goto(target.href, { waitUntil: 'domcontentloaded' });
          await page
            .getByRole('button', { name: 'Add a place', exact: true })
            .first()
            .click();
          const panel = page.locator('.catalog-intake');
          await panel.waitFor({ state: 'visible' });
          const query = panel.getByLabel('Restaurant name or address');
          await query.fill('Fixture restaurant');
          await query.press('Enter');
          if (scenario === 'discovery-loading') {
            const pending = panel.getByRole('button', {
              name: 'Finding matches…',
            });
            await pending.waitFor();
            assert.equal(await pending.isDisabled(), true);
            assert.equal(await panel.getAttribute('aria-busy'), 'true');
            release();
          }
          if (scenario === 'empty') {
            await panel.getByText('No clear place match yet.').waitFor();
            await panel
              .getByRole('button', { name: 'Refine the place' })
              .click();
            assert.equal(
              await query.evaluate(
                (element) => element === document.activeElement,
              ),
              true,
            );
          } else {
            await panel
              .getByRole('button', { name: 'Review selected place' })
              .click();
            if (scenario === 'clarification')
              await panel
                .locator('#catalog-intake-clarification')
                .getByText('Which exact branch?', { exact: true })
                .waitFor();
            else if (scenario === 'dependency-error')
              await panel
                .getByText('Fixture provider unavailable.')
                .first()
                .waitFor();
            else {
              await panel.getByText('Preview v2').waitFor();
              const confirm = panel.getByRole('button', {
                name: 'Confirm and save',
                exact: true,
              });
              if (scenario === 'unknown-location')
                assert.equal(await confirm.isDisabled(), true);
              else if (
                [
                  'confirm-loading',
                  'retry',
                  'verified',
                  'needs-review',
                  'conflict',
                ].includes(scenario)
              ) {
                await confirm.click();
                if (scenario === 'confirm-loading') {
                  const pending = panel.getByRole('button', {
                    name: 'Confirming and saving…',
                  });
                  await pending.waitFor();
                  assert.equal(await pending.isDisabled(), true);
                  release();
                }
                if (scenario === 'retry') {
                  await panel
                    .getByRole('button', { name: 'Retry', exact: true })
                    .click();
                  assert.deepEqual(
                    requests.filter((row) => row.operation === 'confirm')[0]
                      .body,
                    requests.filter((row) => row.operation === 'confirm')[1]
                      .body,
                  );
                }
                if (scenario === 'conflict') {
                  await panel.getByText('Preview v3').waitFor();
                  await panel
                    .getByRole('button', {
                      name: 'Review changed preview and confirm again',
                    })
                    .click();
                }
                await panel.locator('.is-success').waitFor();
                await panel.getByText('Save details', { exact: true }).click();
                await panel
                  .getByText('Receipt fixture-receipt', { exact: true })
                  .waitFor();
              }
            }
          }
          const geometry = await panel.evaluate((element) => ({
            width: element.clientWidth,
            scroll: element.scrollWidth,
          }));
          assert.ok(
            geometry.scroll <= geometry.width,
            'Add panel must fit the viewport.',
          );
          assert.deepEqual(pageErrors, []);
          results.push({ scenario, width, passed: true, requests });
          console.log(`PASS ${scenario} ${width}px`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'report.json'),
    JSON.stringify(
      { evidence: 'controlled-browser', productAcceptance: false, results },
      null,
      2,
    ),
  );
  return results;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const playwright = await import(
    process.env.PLAYWRIGHT_MODULE || 'playwright'
  );
  await runBrowserAdd({
    chromium: playwright.chromium,
    baseUrl: process.env.ATLAS_BASE_URL || 'http://localhost:4317/',
    outputDirectory: resolve(
      process.env.ATLAS_BROWSER_OUTPUT || 'benchmarks/runs/add-browser',
    ),
  });
}

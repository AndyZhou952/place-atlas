import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'jpmap-t08-review-'));
const routeFixture = join(temporaryDirectory, 'owner-review-route.json');
const publicFixture = join(temporaryDirectory, 'public-items-route.json');
const reportPath = join(
  process.env.T02_EVIDENCE_DIR ??
    '../../features/006-agent-add-experience/evidence/ui',
  't09-review-persisted-report.json',
);

run(
  process.execPath,
  [
    '--experimental-strip-types',
    'lib/server/application/t17-dual-adapter-e2e.sqlite.contract.test.mjs',
  ],
  {
    T08_REVIEW_ROUTE_OUTPUT: routeFixture,
    T09_PUBLIC_ROUTE_OUTPUT: publicFixture,
  },
);

const candidates = JSON.parse(await readFile(routeFixture, 'utf8'));
assert.ok(
  candidates.length > 0,
  'real Owner Review route emitted no candidates',
);
assert.equal(candidates[0].verificationStatus, 'needs_review');

run(process.execPath, ['scripts/t02-review-browser-smoke.mjs'], {
  T02_PERSISTED_ROUTE_FIXTURE: routeFixture,
  T09_PUBLIC_ROUTE_FIXTURE: publicFixture,
  T09_REPORT_PATH: reportPath,
});

const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.candidateId, candidates[0].id);
assert.match(report.routeFixtureSha256, /^[a-f0-9]{64}$/u);
assert.equal(report.publicCandidateAbsent, true);
for (const viewportName of ['desktop', 'mobile']) {
  const rendered = report.evidence.find(
    (entry) => entry.state === 'list' && entry.viewportName === viewportName,
  );
  assert.equal(rendered.renderedCandidateId, candidates[0].id);
  assert.equal(rendered.routeFixtureSha256, report.routeFixtureSha256);
  assert.match(rendered.sha256, /^[a-f0-9]{64}$/u);
  assert.match(rendered.screenshot, /t09-review-persisted-/u);
}

function run(command, args, extraEnvironment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnvironment },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

// Independent current-source check for the live subset of the rating manifest.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export function scoreLiveRating(dataset, run) {
  assert.equal(run.benchmarkId, dataset.benchmarkId);
  const cases = dataset.cases.filter((entry) => entry.mode === 'live_verified');
  const observations = new Map(
    run.observations.map((entry) => [entry.caseId, entry]),
  );
  assert.equal(observations.size, cases.length, 'Every live case must be run');
  const results = cases.map((entry) => {
    const observed = observations.get(entry.caseId);
    assert.ok(observed, `Missing live case ${entry.caseId}`);
    const rating = observed.tabelog;
    const sourceDay = entry.evidence.observedAt.slice(0, 10);
    const researchDay = rating?.observedAt?.slice(0, 10);
    const passed =
      observed.discoveryHttpStatus === 200 &&
      observed.candidateCount === 1 &&
      observed.researchHttpStatus === 200 &&
      observed.researchStatus === 'preview_ready' &&
      rating?.status === 'known' &&
      rating.provenance === 'agent_observed' &&
      rating.url === entry.evidence.sourceUrl &&
      rating.score === entry.expected.aggregateScore &&
      researchDay === sourceDay &&
      observed.cancelled === true;
    return {
      caseId: entry.caseId,
      passed,
      completion: rating?.status === 'known',
      exactScore: rating?.score === entry.expected.aggregateScore,
      exactSource: rating?.url === entry.evidence.sourceUrl,
      latencyMs: observed.latencyMs,
      ...(passed
        ? {}
        : { stage: observed.researchStatus ?? observed.discoveryStatus }),
    };
  });
  return {
    benchmarkId: dataset.benchmarkId,
    runAt: run.runAt,
    sourceCheckedAt: dataset.checkedAt,
    total: cases.length,
    passed: results.filter((entry) => entry.passed).length,
    cases: results,
  };
}

if (process.argv[1]?.endsWith('/score-live-rating.mjs')) {
  const [datasetPath, runPath] = process.argv.slice(2);
  if (!datasetPath || !runPath) {
    throw new Error('Usage: node score-live-rating.mjs DATASET.json RUN.json');
  }
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  const run = JSON.parse(await readFile(runPath, 'utf8'));
  const report = scoreLiveRating(dataset, run);
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
}

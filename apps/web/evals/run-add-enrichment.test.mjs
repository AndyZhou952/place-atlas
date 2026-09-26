import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildCaseInput,
  runExtractionEvaluation,
  unknownResult,
} from './run-add-enrichment.mjs';

const dataset = JSON.parse(
  await readFile(
    new URL(
      './place-enrichment/place-enrichment-gold.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const config = {
  baseUrl: 'https://model.example/v1',
  apiKey: 'test-secret',
  model: 'test-model',
};

test('model input excludes gold, scenario hints and curation notes', () => {
  const entry = {
    ...dataset.cases[0],
    gold: { SECRET_GOLD_MARKER: true },
    curationNotes: 'SECRET_CURATION_MARKER',
  };
  const input = buildCaseInput(dataset, entry);
  assert.equal(input.caseId, 'case-1');
  assert.deepEqual(Object.keys(input), [
    'caseId',
    'evaluationDate',
    'stalenessDays',
    'selectedBranch',
    'evidence',
  ]);
  assert.doesNotMatch(
    JSON.stringify(input),
    /SECRET_GOLD_MARKER|SECRET_CURATION_MARKER|acceptedEvidenceIds/u,
  );
  input.selectedBranch.canonicalName = 'changed';
  assert.notEqual(entry.place.canonicalName, 'changed');
});

test('real-model harness reports unknown-only completion as failed, with no product acceptance', async () => {
  let calls = 0;
  const report = await runExtractionEvaluation({
    dataset,
    config,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, 'https://model.example/v1/chat/completions');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.gold, undefined);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                caseId: input.caseId,
                result: unknownResult(),
              }),
            },
          },
        ],
        usage: { total_tokens: 100, ignored: 'secret' },
      });
    },
  });
  assert.equal(calls, dataset.cases.length);
  assert.equal(report.cases.length, dataset.cases.length);
  assert.equal(report.automatedChecksPass, false);
  assert.equal(report.productAcceptance, false);
  assert.doesNotMatch(JSON.stringify(report), /test-secret|"ignored"/u);
  assert.ok(
    report.productionOutputCoverage.missingClaimPaths.includes('summary'),
  );
});

test('provider failures preserve every case and redact error bodies', async () => {
  const report = await runExtractionEvaluation({
    dataset,
    config,
    fetcher: async () =>
      new Response('test-secret provider body', { status: 401 }),
  });
  assert.equal(report.cases.length, dataset.cases.length);
  assert.ok(
    report.cases.every(
      (entry) =>
        entry.status === 'failed' && entry.error === 'provider_http_401',
    ),
  );
  assert.doesNotMatch(JSON.stringify(report), /test-secret|provider body/u);
  assert.equal(report.automatedChecksPass, false);
});

test('reasoning effort is explicit and token exhaustion is reported with usage', async () => {
  const report = await runExtractionEvaluation({ dataset, config: { ...config, reasoningEffort: 'none' }, fetcher: async (_url, init) => {
    assert.equal(JSON.parse(init.body).reasoning_effort, 'none');
    return Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { completion_tokens: 4500, completion_tokens_details: { reasoning_tokens: 4500 } } });
  } });
  assert.equal(report.reasoningEffort, 'none');
  assert.ok(report.cases.every((entry) => entry.error === 'output_token_limit' && entry.usage.reasoning_tokens === 4500));
  assert.equal(report.automatedChecksPass, false);
  assert.match(report.datasetSha256, /^[a-f0-9]{64}$/u);
});

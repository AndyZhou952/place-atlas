import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { asksForWalkIn } from '../../product/application/decision/recommend-conversation-service.ts';
import { normalizeRecommendIntent } from '../../product/application/decision/recommend-intent.ts';

export function predictEntryIntent(dataset) {
  return {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map((entry) => {
      const intent = normalizeRecommendIntent(
        [entry.query],
        entry.options,
        entry.modelPrediction,
      );
      return {
        caseId: entry.caseId,
        askWalkIn: asksForWalkIn({ query: entry.query, replies: [] }),
        action: intent.action,
        travelMode: intent.travelMode,
        maxMinutes: intent.maxMinutes,
      };
    }),
  };
}

export function scoreEntryIntent(dataset, predictionFile) {
  if (
    dataset.schemaVersion !== 1 ||
    !Array.isArray(dataset.cases) ||
    dataset.cases.length === 0 ||
    predictionFile.datasetId !== dataset.datasetId ||
    !Array.isArray(predictionFile.predictions)
  )
    throw new Error('Invalid entry-intent dataset or prediction file');
  const caseIds = new Set(dataset.cases.map((entry) => entry.caseId));
  if (caseIds.size !== dataset.cases.length)
    throw new Error('Duplicate entry-intent case');
  const predictions = new Map();
  for (const prediction of predictionFile.predictions) {
    if (!caseIds.has(prediction.caseId) || predictions.has(prediction.caseId))
      throw new Error('Unknown or duplicate entry-intent prediction');
    predictions.set(prediction.caseId, prediction);
  }
  const results = dataset.cases.map((entry) => {
    const prediction = predictions.get(entry.caseId);
    if (!prediction)
      return {
        caseId: entry.caseId,
        passed: false,
        failures: ['missing_prediction'],
      };
    const failures = [];
    for (const field of ['askWalkIn', 'action', 'travelMode', 'maxMinutes']) {
      if (prediction[field] !== entry.expected[field])
        failures.push(`wrong_${field}`);
    }
    return { caseId: entry.caseId, passed: failures.length === 0, failures };
  });
  return {
    datasetId: dataset.datasetId,
    cases: results.length,
    completedPredictions: predictions.size,
    casePassRate:
      results.filter((entry) => entry.passed).length / results.length,
    passes: results.every((entry) => entry.passed),
    results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try {
    const dataset = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const report = scoreEntryIntent(dataset, predictEntryIntent(dataset));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }

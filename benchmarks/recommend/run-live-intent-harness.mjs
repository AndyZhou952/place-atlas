import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRecommendInterpreter } from '../../apps/web/lib/server/application/recommend-interpreter.ts';
import { normalizeRecommendIntent } from '../../apps/web/product/application/decision/recommend-intent.ts';
import { scoreRecommendIntent } from './score-intent.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function runLiveIntentDataset({
  dataset,
  kind,
  settings,
  fetcher = fetch,
  onProgress = () => {},
}) {
  const predictions = [];
  const attempts = [];
  for (const entry of dataset.cases) {
    const started = Date.now();
    const attempt = { caseId: entry.caseId };
    const input =
      kind === 'dialogue'
        ? { query: entry.input.messages[0], replies: [entry.input.messages[2]] }
        : { query: entry.input.message, replies: [] };
    try {
      const interpreter = createRecommendInterpreter(
        settings,
        async (url, init) => {
          const response = await fetcher(url, init);
          if (response.ok) {
            const copy = await response.clone().json();
            attempt.usage = copy.usage;
          }
          return response;
        },
      );
      const raw = await interpreter.interpret(input, dataset.originOptions);
      attempt.modelOutput = raw;
      const messages =
        kind === 'dialogue' ? entry.input.messages : [entry.input.message];
      const result = normalizeRecommendIntent(
        messages,
        dataset.originOptions,
        raw,
      );
      predictions.push({ caseId: entry.caseId, ...result });
      attempt.status = 'completed';
    } catch (error) {
      attempt.status = 'failed';
      attempt.error = error instanceof Error ? error.message : 'unknown_error';
    }
    attempt.latencyMs = Date.now() - started;
    attempts.push(attempt);
    onProgress({ kind, caseId: entry.caseId, status: attempt.status });
  }
  const predictionFile = { datasetId: dataset.datasetId, predictions };
  return {
    predictionFile,
    attempts,
    score: scoreRecommendIntent(dataset, predictionFile),
  };
}

async function main() {
  const outputDirectory = process.argv[2];
  const holdout = process.argv[3] === '--holdout';
  if (process.argv[3] && !holdout)
    throw new Error('Only --holdout is supported as an optional flag.');
  const apiKey = process.env.AGENT_API_KEY;
  const model = process.env.AGENT_MODEL;
  if (!outputDirectory || !apiKey || !model)
    throw new Error(
      'Set AGENT_API_KEY and AGENT_MODEL and pass a fresh ignored benchmarks/runs/ directory.',
    );
  const target = resolve(outputDirectory);
  if (!target.includes('/benchmarks/runs/'))
    throw new Error('Harness output must be under ignored benchmarks/runs/.');
  await mkdir(target, { recursive: false });
  const manifest = {
    kind: 'production-intent-harness-with-synthetic-origin-options',
    model,
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: here,
      encoding: 'utf8',
    }).trim(),
    runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    interpreterSha256: sha256(
      await readFile(
        resolve(
          here,
          '../../apps/web/lib/server/application/recommend-interpreter.ts',
        ),
      ),
    ),
    normalizerSha256: sha256(
      await readFile(
        resolve(
          here,
          '../../apps/web/product/application/decision/recommend-intent.ts',
        ),
      ),
    ),
    startedAt: new Date().toISOString(),
    datasets: [],
  };
  for (const [kind, filename] of [
    ['intent', holdout ? 'intent-holdout.v1.json' : 'intent-gold.v1.json'],
    [
      'dialogue',
      holdout ? 'dialogue-holdout.v1.json' : 'dialogue-gold.v1.json',
    ],
  ]) {
    const raw = await readFile(resolve(here, filename), 'utf8');
    const dataset = JSON.parse(raw);
    const result = await runLiveIntentDataset({
      dataset,
      kind,
      settings: {
        agentApiKey: apiKey,
        agentBaseUrl: 'https://api.deepseek.com',
        agentModel: model,
      },
      onProgress: (progress) => console.error(JSON.stringify(progress)),
    });
    /** @type {Array<[string, unknown]>} */
    const outputs = [
      ['predictions', result.predictionFile],
      ['attempts', result.attempts],
      ['score', result.score],
    ];
    for (const [name, content] of outputs)
      await writeFile(
        resolve(target, `${kind}-${name}.json`),
        JSON.stringify(content, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    manifest.datasets.push({
      kind,
      filename,
      sha256: sha256(raw),
      cases: dataset.cases.length,
      completedPredictions: result.score.completedPredictions,
      casePassRate: result.score.casePassRate,
    });
  }
  manifest.completedAt = new Date().toISOString();
  await writeFile(
    resolve(target, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log(
    JSON.stringify({ outputDirectory: target, datasets: manifest.datasets }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Harness failed');
    process.exitCode = 1;
  });

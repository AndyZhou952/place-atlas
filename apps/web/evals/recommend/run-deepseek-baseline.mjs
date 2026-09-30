import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scoreNearby } from '../nearby/score-nearby.mjs';
import { scoreNearbyLocation } from '../nearby/score-nearby-location.mjs';
import { scoreRecommendIntent } from './score-intent.mjs';
import { scoreRecommendDecision } from './score-decision.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const endpoint = 'https://api.deepseek.com/chat/completions';
const promptVersion = 'recommend-model-only-distance-release-v1';

const policyPrompt = `You are evaluating a restaurant recommendation decision. Use only the supplied saved catalog and tool observations. Return one JSON object with action (recommend, clarify, no_results, unavailable), itemIds (array), warnings (array), routeClaims (array of {itemId, mode, seconds}), and a question when clarifying. Never invent a restaurant ID, route, duration, or availability. A location provider failure is unavailable, not no_results. Ambiguous origin needs clarification. Prefer an unvisited matching cuisine when requested. With no explicit travel mode, use straight-line distance within 2000 meters and warn that travel time is unverified; for an explicit timed walking request, use only verified walking routes within the requested limit. Never claim a walking duration for a distance-only candidate. If walk-in status is requested but unknown, include walk_in_unknown. Select only from catalogIds.`;

const locationPrompt = `Extract a user's origin and food preference from a short message. Use only the supplied official station options; do not invent a station, restaurant, route, or travel time. Return one JSON object: {action:"resolve",originId,cuisine,visited} or {action:"clarify",question}. cuisine must be ramen, sushi, curry, or any. visited must be prefer_unvisited or only_visited. If the message presents two origins as alternatives, ask a clarification instead of choosing one.`;

const intentPrompt = `Interpret a short restaurant recommendation request using only supplied origin options. Return one JSON object with action (recommend, clarify, unsupported), originId (known ID or null), foodTerms and excludedFoodTerms (arrays of normalized food tags), travelMode (none or walk), maxMinutes (integer or null), visited (prefer_unvisited, only_unvisited, only_visited, any), and, when clarifying, a short question and clarification (origin, exact_origin, origin_choice, branch, unresolved_origin, full_address_or_link, travel_mode). For unsupported links use reason untrusted_url. A named saved restaurant or pasted Google Maps shop name alone is an origin hint, not a restaurant to recommend. A broad area alone can yield area recommendations without travel-time claims; an explicit timed walking request from a broad area needs a precise origin. When location is absent, a food-only request needs no clarification, but a 'near me' request does. Never invent a known origin, restaurant, route, travel duration, or catalog ID.`;

const decisionPrompt = `Recommend only from supplied saved verified food catalog and tool observations. Return one JSON object with action (recommend, clarify, no_results, unavailable), recommendations (array up to five), warnings (array of codes), and a short question when clarifying. Each recommendation needs itemId, detailTargetId equal to itemId, a brief evidence-based reason, reasonFacts (array of {kind,value} or {kind,seconds} or {kind,meters}), and routeClaim ({mode,seconds}) only when a fresh walking route observation proves that exact duration. Valid reason kinds are saved, food, area, unvisited, visited, walk, distance, entry_unknown. A broad area needs no route claim. Respect cuisine, exclusions, visited constraints and route limits; do not turn straight-line distance into verified travel time. With no explicit travel mode, use straight-line distance within 2 km and include unverified_travel_time; an explicit timed walking request needs a verified route. A flexible mode permits a distance-only result with the same warning when walking evidence is unavailable. Unknown entry or provider failure must remain unknown. A selected recommendation must open its own saved item detail; never name a new or unverified place.`;

const prompts = {
  policy: policyPrompt,
  location: locationPrompt,
  intent: intentPrompt,
  dialogue: `${intentPrompt} Read the ordered dialogue as one continuing request. Preserve constraints from earlier user turns, use a later user answer to resolve the question, and let a later correction override an earlier origin. Return the same JSON object for the latest user turn.`,
  decision: decisionPrompt,
};

const datasetFiles = {
  intent: 'intent-gold.v1.json',
  dialogue: 'dialogue-gold.v1.json',
  decision: 'decision-gold.v1.json',
  policy: '../nearby/nearby-gold.v1.json',
  location: '../nearby/nearby-location-gold.v1.json',
};

const scorers = {
  policy: scoreNearby,
  location: scoreNearbyLocation,
  intent: scoreRecommendIntent,
  dialogue: scoreRecommendIntent,
  decision: scoreRecommendDecision,
};

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function baselineCaseInput(kind, dataset, entry) {
  if (kind === 'dialogue')
    return {
      conversation: entry.input.messages,
      originOptions: dataset.originOptions,
    };
  if (kind === 'intent')
    return {
      userMessage: entry.input.message,
      originOptions: dataset.originOptions,
    };
  if (kind === 'decision')
    return {
      intent: entry.input.intent,
      origin: entry.input.origin,
      savedCatalog: dataset.catalog.filter((item) =>
        entry.input.catalogIds.includes(item.id),
      ),
      toolObservations: {
        routes: entry.input.routes,
        distances: entry.input.distances,
        ...(entry.input.entryState
          ? { entryState: entry.input.entryState }
          : {}),
        ...(entry.input.providerState
          ? { providerState: entry.input.providerState }
          : {}),
      },
    };
  if (kind === 'policy') {
    return {
      userMessage: entry.input.message,
      savedCatalog: dataset.catalog.filter((item) =>
        entry.input.catalogIds.includes(item.id),
      ),
      toolObservations: Object.fromEntries(
        Object.entries(entry.input).filter(
          ([key]) => !['message', 'catalogIds'].includes(key),
        ),
      ),
    };
  }
  return {
    userMessage: entry.input.message,
    stationOptions: dataset.origins.map(
      ({ id, nameJa, nameEn, lineCodes }) => ({
        id,
        nameJa,
        nameEn,
        lineCodes,
      }),
    ),
  };
}

function validPrediction(kind, value) {
  if (!isRecord(value)) return false;
  if (kind === 'intent' || kind === 'dialogue')
    return (
      ['recommend', 'clarify', 'unsupported'].includes(value.action) &&
      (value.originId === null || typeof value.originId === 'string') &&
      Array.isArray(value.foodTerms) &&
      Array.isArray(value.excludedFoodTerms) &&
      ['none', 'walk'].includes(value.travelMode) &&
      (value.maxMinutes === null || Number.isFinite(value.maxMinutes)) &&
      typeof value.visited === 'string' &&
      (value.action !== 'clarify' || typeof value.question === 'string')
    );
  if (kind === 'decision')
    return (
      ['recommend', 'clarify', 'no_results', 'unavailable'].includes(
        value.action,
      ) &&
      Array.isArray(value.recommendations) &&
      Array.isArray(value.warnings) &&
      (value.action !== 'clarify' || typeof value.question === 'string')
    );
  if (kind === 'location') {
    return (
      ['resolve', 'clarify'].includes(value.action) &&
      (value.action !== 'resolve' ||
        (typeof value.originId === 'string' &&
          typeof value.cuisine === 'string' &&
          typeof value.visited === 'string')) &&
      (value.action !== 'clarify' || typeof value.question === 'string')
    );
  }
  return (
    ['recommend', 'clarify', 'no_results', 'unavailable'].includes(
      value.action,
    ) &&
    Array.isArray(value.itemIds) &&
    value.itemIds.every((id) => typeof id === 'string') &&
    new Set(value.itemIds).size === value.itemIds.length &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string') &&
    Array.isArray(value.routeClaims) &&
    value.routeClaims.every(
      (claim) =>
        isRecord(claim) &&
        typeof claim.itemId === 'string' &&
        claim.mode === 'walk' &&
        Number.isFinite(claim.seconds) &&
        claim.seconds >= 0,
    ) &&
    (value.action !== 'clarify' || typeof value.question === 'string')
  );
}

async function readBoundedResponse(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > 65_536) throw new Error('oversized_model_response');
  const body = await response.text();
  if (body.length > 65_536) throw new Error('oversized_model_response');
  return JSON.parse(body);
}

export async function runBaselineDataset({
  kind,
  dataset,
  apiKey,
  model,
  fetcher = fetch,
  onProgress = () => {},
}) {
  const prompt = prompts[kind];
  if (!prompt) throw new Error('Unknown baseline kind');
  const predictions = [];
  const attempts = [];
  for (const entry of dataset.cases) {
    const started = Date.now();
    const attempt = { caseId: entry.caseId };
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1200,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: JSON.stringify(baselineCaseInput(kind, dataset, entry)),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const body = await readBoundedResponse(response);
      attempt.usage = body.usage;
      attempt.finishReason = body.choices?.[0]?.finish_reason;
      if (attempt.finishReason === 'length')
        throw new Error('output_token_limit');
      const answer = JSON.parse(body.choices?.[0]?.message?.content ?? '');
      attempt.output = answer;
      if (!validPrediction(kind, answer)) throw new Error('invalid_prediction');
      predictions.push({ caseId: entry.caseId, ...answer });
      attempt.status = 'completed';
    } catch (error) {
      attempt.status = 'failed';
      attempt.error =
        error instanceof Error ? error.message : 'unknown_model_error';
    }
    attempt.latencyMs = Date.now() - started;
    attempts.push(attempt);
    onProgress({ kind, caseId: entry.caseId, status: attempt.status });
  }
  const predictionFile = { datasetId: dataset.datasetId, predictions };
  const score = scorers[kind](dataset, predictionFile);
  return { predictionFile, attempts, score, promptHash: hash(prompt) };
}

async function main() {
  const outputDirectory = process.argv[2];
  const apiKey = process.env.AGENT_API_KEY;
  const model = process.env.AGENT_MODEL;
  if (!outputDirectory || !apiKey || !model)
    throw new Error(
      'Usage: AGENT_API_KEY and AGENT_MODEL must be set; pass a fresh ignored evals/runs/ output directory.',
    );
  const target = resolve(outputDirectory);
  if (!target.includes('/evals/runs/'))
    throw new Error('Baseline output must be under ignored evals/runs/.');
  await mkdir(target, { recursive: false });
  const datasets = Object.entries(datasetFiles);
  const manifest = {
    kind: 'model-only-not-production-recommend',
    promptVersion,
    endpoint,
    model,
    temperature: 0,
    maxTokens: 1200,
    reasoningEffort: 'none',
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: here,
      encoding: 'utf8',
    }).trim(),
    runnerSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    startedAt: new Date().toISOString(),
    datasets: [],
  };
  for (const [kind, file] of datasets) {
    const raw = await readFile(resolve(here, file), 'utf8');
    const dataset = JSON.parse(raw);
    const result = await runBaselineDataset({
      kind,
      dataset,
      apiKey,
      model,
      onProgress: (progress) => console.error(JSON.stringify(progress)),
    });
    await writeFile(
      resolve(target, `${kind}-predictions.json`),
      JSON.stringify(result.predictionFile, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      resolve(target, `${kind}-attempts.json`),
      JSON.stringify(result.attempts, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      resolve(target, `${kind}-score.json`),
      JSON.stringify(result.score, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    manifest.datasets.push({
      kind,
      file,
      sha256: hash(raw),
      promptSha256: result.promptHash,
      cases: dataset.cases.length,
      completedPredictions: result.score.completedPredictions,
      casePassRate: result.score.casePassRate,
    });
  }
  manifest.completedAt = new Date().toISOString();
  await writeFile(
    resolve(target, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
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
    console.error(error instanceof Error ? error.message : 'Baseline failed');
    process.exitCode = 1;
  });

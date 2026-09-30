import { readFileSync } from 'node:fs';
import { savedDuplicateIds } from './live-catalog-state.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('./live-add.v1.json', import.meta.url), 'utf8'),
);
const endpointText = process.env.ATLAS_ADD_AGENT_URL;
if (!endpointText)
  throw new Error(
    'Set ATLAS_ADD_AGENT_URL to the deployed Add Agent endpoint.',
  );
const endpoint = new URL(endpointText);
if (
  endpoint.protocol !== 'https:' ||
  endpoint.pathname !== '/api/agent/catalog-intake' ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error('ATLAS_ADD_AGENT_URL must be an HTTPS Add Agent endpoint.');
const token =
  process.env.ATLAS_ADD_AGENT_TOKEN ||
  readFileSync('.wrangler/add-agent-token', 'utf8').trim();
if (!token) throw new Error('Set ATLAS_ADD_AGENT_TOKEN.');

const requestedCase = process.argv[2];
const cases = requestedCase
  ? manifest.cases.filter((sample) => sample.id === requestedCase)
  : manifest.cases;
if (!cases.length) throw new Error('No matching live Add benchmark case.');

async function call(operation, input, conversationId) {
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(conversationId
        ? { 'x-atlas-agent-conversation-id': conversationId }
        : {}),
    },
    body: JSON.stringify({ operation: `catalog.intake.${operation}`, input }),
  });
  const body = await response.json();
  return {
    status: response.status,
    conversationId: response.headers.get('x-atlas-agent-conversation-id'),
    body,
  };
}

function score(sample, preview, expectedDuplicateIds) {
  const checks = {
    title: preview?.titleProposal?.value?.includes(
      sample.expectedTitleIncludes,
    ),
    location:
      preview?.locationEvidence?.status === 'known' &&
      preview.locationEvidence.provenance ===
        (sample.expectedLocationProvenance ?? 'agent_observed') &&
      (!sample.expectedTabelogUrl ||
        preview.locationEvidence.sourceUrl === sample.expectedTabelogUrl) &&
      typeof preview.locationEvidence.latitude === 'number' &&
      typeof preview.locationEvidence.longitude === 'number',
    rating:
      !sample.expectedTabelogUrl ||
      (preview?.tabelog?.status === 'known' &&
        preview.tabelog.url === sample.expectedTabelogUrl &&
        preview.tabelog.provenance === 'agent_observed' &&
        preview.tabelog.score >= 1 &&
        preview.tabelog.score <= 5),
    reservation:
      preview?.reservation?.status === 'known' &&
      preview.reservation.mode === sample.expectedReservationMode,
    releaseClock:
      !sample.expectedReleaseNoteIncludes ||
      preview?.reservation?.releaseNote?.includes(
        sample.expectedReleaseNoteIncludes,
      ),
    category:
      !sample.expectedCategoryIncludes ||
      preview?.profile?.categories?.value?.some((category) =>
        category
          .toLowerCase()
          .includes(sample.expectedCategoryIncludes.toLowerCase()),
      ),
    summary:
      !sample.expectedSummaryPrefix ||
      preview?.profile?.summary?.value?.startsWith(
        sample.expectedSummaryPrefix,
      ),
    summaryDetail:
      !sample.expectedSummaryIncludes ||
      preview?.profile?.summary?.value?.includes(
        sample.expectedSummaryIncludes,
      ),
    dishes:
      !sample.expectedDishesMin ||
      (preview?.profile?.signatureDishes?.value?.length ?? 0) >=
        sample.expectedDishesMin,
    bookingLink:
      !sample.expectedBookingLink ||
      preview?.profile?.bookingLink?.value === sample.expectedBookingLink,
    savedDuplicate:
      JSON.stringify(
        (preview?.suspectedDuplicates ?? [])
          .filter((item) => item.match === 'strong')
          .map((item) => item.itemId)
          .sort((a, b) => a.localeCompare(b)),
      ) ===
      JSON.stringify(
        [...expectedDuplicateIds].sort((a, b) => a.localeCompare(b)),
      ),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    observed: {
      title: preview?.titleProposal?.value,
      location: preview?.locationEvidence?.status,
      tabelog: preview?.tabelog?.status,
      reservation: preview?.reservation?.mode ?? preview?.reservation?.status,
      releaseNote: preview?.reservation?.releaseNote,
      categories: preview?.profile?.categories?.value,
      dishes: preview?.profile?.signatureDishes?.value,
      summary: preview?.profile?.summary?.value,
      bookingLink: preview?.profile?.bookingLink?.value,
      duplicate: preview?.suspectedDuplicates?.map((item) => item.match),
    },
  };
}

let passed = 0;
for (const sample of cases) {
  const started = Date.now();
  let sessionId;
  let sessionVersion;
  let conversationId;
  let result;
  let cleanup = 'not_started';
  try {
    const catalogResponse = await fetch(new URL('/api/items', endpoint), {
      signal: AbortSignal.timeout(15_000),
      headers: { 'cache-control': 'no-cache' },
    });
    if (!catalogResponse.ok) throw new Error('Live catalog unavailable');
    const expectedDuplicateIds = savedDuplicateIds(
      sample,
      await catalogResponse.json(),
    );
    const discovered = await call('discover', {
      query: sample.query,
      requestToken: `live-add-${crypto.randomUUID()}`,
    });
    sessionId = discovered.body.sessionId;
    sessionVersion = discovered.body.sessionVersion;
    conversationId = discovered.conversationId;
    const candidates = discovered.body.candidates ?? [];
    const matches = candidates.filter((candidate) => {
      const name = candidate.transientName?.toLowerCase();
      return sample.candidateNameExact
        ? name === sample.candidateNameExact.toLowerCase()
        : name?.includes(sample.candidateNameIncludes.toLowerCase());
    });
    if (discovered.status !== 200 || matches.length !== 1) {
      result = {
        pass: false,
        stage: 'discover',
        status: discovered.status,
        candidateCount: candidates.length,
        matchingCandidateCount: matches.length,
        candidateNames: candidates.map((candidate) => candidate.transientName),
      };
    } else {
      const selected = await call(
        'select',
        {
          sessionId,
          expectedSessionVersion: sessionVersion,
          ordinal: matches[0].ordinal,
        },
        conversationId,
      );
      sessionVersion = selected.body.sessionVersion ?? sessionVersion;
      result =
        selected.status === 200 && selected.body.status === 'preview_ready'
          ? {
              stage: 'select',
              candidateAddress: matches[0].transientAddress,
              expectedDuplicateIds,
              ...score(sample, selected.body.preview, expectedDuplicateIds),
            }
          : {
              pass: false,
              stage: 'select',
              status: selected.status,
              result: selected.body.status ?? selected.body.code,
            };
    }
  } catch (error) {
    result = { pass: false, stage: 'error', error: String(error) };
  } finally {
    if (sessionId && sessionVersion && conversationId) {
      try {
        const cancelled = await call(
          'cancel',
          { sessionId, expectedSessionVersion: sessionVersion },
          conversationId,
        );
        cleanup = cancelled.body.status ?? cancelled.body.code;
      } catch {
        cleanup = 'failed';
      }
    }
  }
  const pass = result.pass && cleanup === 'cancelled';
  if (pass) passed++;
  console.log(
    JSON.stringify({
      case: sample.id,
      ...result,
      pass,
      cleanup,
      elapsedMs: Date.now() - started,
    }),
  );
}
console.log(JSON.stringify({ suite: 'live-add', passed, total: cases.length }));
if (passed !== cases.length) process.exitCode = 1;

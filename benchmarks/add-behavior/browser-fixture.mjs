export const browserAddScenarios = [
  'preview',
  'empty',
  'clarification',
  'discovery-loading',
  'dependency-error',
  'confirm-loading',
  'retry',
  'verified',
  'needs-review',
  'conflict',
  'unknown-location',
];

export function browserAddPlan(scenario) {
  if (!browserAddScenarios.includes(scenario))
    throw new Error('Unknown Add scenario');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const session = { sessionId: 'fixture-add-session', expiresAt };
  const sourceUrl = 'https://tabelog.com/tokyo/A1317/A131701/13000001/';
  const preview = (version) => ({
    ...session,
    previewVersion: version,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'fixture',
      placeId: 'fixture-branch',
    },
    ownerFields: { area: 'Tokyo' },
    titleProposal: { provenance: 'owner_query', value: 'Fixture restaurant' },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: 'Fixture street, Tokyo',
      sourceUrl,
      license: 'Fixture evidence',
      checkedAt: now,
    },
    locationEvidence:
      scenario === 'unknown-location'
        ? { status: 'unknown' }
        : {
            status: 'known',
            provenance: 'durable_geocoder_observed',
            normalizedAddress: 'Fixture street, Tokyo',
            latitude: 35.68,
            longitude: 139.76,
            provider: 'Fixture geocoder',
            sourceUrl,
            license: 'Fixture evidence',
            checkedAt: now,
          },
    tabelog: {
      status: 'known',
      score: 3.5,
      reviewCount: 12,
      url: sourceUrl,
      provenance: 'agent_observed',
      observedAt: now,
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservable',
      label: '予約可',
      url: sourceUrl,
      provenance: 'agent_observed',
      observedAt: now,
      freshness: 'fresh',
    },
    suspectedDuplicates: [],
    unknownFields: [],
    warnings: [],
    evidenceDigest: 'a'.repeat(64),
    catalogRevision: 'fixture-revision',
  });
  const candidate = {
    ordinal: 1,
    transientName: 'Fixture restaurant',
    transientAddress: 'Fixture street, Tokyo',
    attribution: { label: 'Tabelog', url: sourceUrl },
  };
  const selected = {
    ...session,
    status: 'preview_ready',
    sessionVersion: 2,
    preview: preview(2),
  };
  const discover = {
    ...session,
    status: 'candidates_ready',
    sessionVersion: 1,
    candidates: scenario === 'empty' ? [] : [candidate],
    hasMore: false,
  };
  const failure = {
    status: 503,
    body: {
      code: 'dependency_failure',
      message: 'Fixture provider unavailable.',
      retryable: true,
    },
  };
  const success = {
    status: 200,
    body: {
      status:
        scenario === 'needs-review'
          ? 'committed_needs_review'
          : 'committed_verified',
      itemId: 'fixture-saved-place',
      receiptRef: 'fixture-receipt',
      replayed: false,
    },
  };
  return {
    'google-rating': [{ status: 204, body: null }],
    discover: [
      { status: 200, body: discover, gate: scenario === 'discovery-loading' },
    ],
    select: [
      scenario === 'dependency-error'
        ? failure
        : {
            status: 200,
            body:
              scenario === 'clarification'
                ? {
                    ...session,
                    status: 'clarification_required',
                    sessionVersion: 2,
                    candidates: [candidate],
                    clarification: {
                      code: 'ambiguous_location',
                      prompt: 'Which exact branch?',
                      fields: ['area', 'address'],
                    },
                  }
                : selected,
          },
    ],
    confirm:
      scenario === 'retry'
        ? [failure, success]
        : scenario === 'conflict'
          ? [
              {
                status: 200,
                body: { status: 'conflict', newPreview: preview(3) },
              },
              success,
            ]
          : [{ ...success, gate: scenario === 'confirm-loading' }],
    cancel: [
      {
        status: 200,
        body: { ...session, status: 'cancelled', sessionVersion: 4 },
      },
    ],
  };
}

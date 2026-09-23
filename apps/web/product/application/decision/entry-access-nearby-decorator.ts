import type {
  EntryAccessProvider,
  EntryAccessSnapshot,
  EntryAccessVerificationPolicy,
  EntryAccessSubject,
  QueueAssertion,
  WalkInAssertion,
} from './entry-access.ts';

const maximumFinalCandidates = 5;

export async function enrichFinalNearbyCandidatesWithEntryAccess<
  Candidate extends EntryAccessSubject,
>(
  candidates: readonly Candidate[],
  provider: EntryAccessProvider,
  policy: EntryAccessVerificationPolicy,
): Promise<
  readonly (Candidate & { readonly entryAccess: EntryAccessSnapshot })[]
> {
  return Promise.all(
    candidates.slice(0, maximumFinalCandidates).map(async (candidate) => {
      const [walkInAssertion, queueAssertion] = await Promise.all([
        inspectWalkIn(provider, candidate, policy),
        inspectQueue(provider, candidate, policy),
      ]);
      return {
        ...candidate,
        entryAccess: { walkInAssertion, queueAssertion },
      };
    }),
  );
}

async function inspectWalkIn(
  provider: EntryAccessProvider,
  candidate: EntryAccessSubject,
  policy: EntryAccessVerificationPolicy,
): Promise<WalkInAssertion> {
  try {
    return normalizeWalkIn(await provider.inspectWalkIn(candidate), policy);
  } catch {
    return unknownWalkIn(
      'Live walk-in information is temporarily unavailable.',
    );
  }
}

async function inspectQueue(
  provider: EntryAccessProvider,
  candidate: EntryAccessSubject,
  policy: EntryAccessVerificationPolicy,
): Promise<QueueAssertion> {
  try {
    return normalizeQueue(await provider.inspectQueue(candidate), policy);
  } catch {
    return unknownQueue('Live queue information is temporarily unavailable.');
  }
}

function normalizeWalkIn(
  value: unknown,
  policy: EntryAccessVerificationPolicy,
): WalkInAssertion {
  if (!isRecord(value))
    return unknownWalkIn('Live walk-in information is unavailable.');
  if (value.status === 'unknown') {
    return {
      status: 'unknown',
      warning: stringOr(
        value.warning,
        'Live walk-in information is unavailable.',
      ),
      ...optionalProvenance(value, policy),
    };
  }
  if (
    (value.status === 'confirmed' || value.status === 'reservation_required') &&
    hasTrustedProvenance(value, policy)
  ) {
    return {
      status: value.status,
      sourceUrl: value.sourceUrl,
      checkedAt: value.checkedAt,
      policyVersion: value.policyVersion,
      ...optionalWarning(value),
    };
  }
  return unknownWalkIn('Live walk-in information is unavailable.');
}

function normalizeQueue(
  value: unknown,
  policy: EntryAccessVerificationPolicy,
): QueueAssertion {
  if (!isRecord(value))
    return unknownQueue('Live queue information is unavailable.');
  if (value.status === 'unknown') {
    return {
      status: 'unknown',
      warning: stringOr(
        value.warning,
        'Live queue information is unavailable.',
      ),
      ...optionalProvenance(value, policy),
    };
  }
  if (value.status === 'none_reported' && hasTrustedProvenance(value, policy)) {
    return {
      status: 'none_reported',
      sourceUrl: value.sourceUrl,
      checkedAt: value.checkedAt,
      policyVersion: value.policyVersion,
      ...optionalWarning(value),
    };
  }
  if (
    value.status === 'waiting_reported' &&
    hasTrustedProvenance(value, policy) &&
    (value.waitingMinutes === undefined ||
      (typeof value.waitingMinutes === 'number' &&
        Number.isFinite(value.waitingMinutes) &&
        value.waitingMinutes >= 0))
  ) {
    return {
      status: 'waiting_reported',
      sourceUrl: value.sourceUrl,
      checkedAt: value.checkedAt,
      policyVersion: value.policyVersion,
      ...(typeof value.waitingMinutes === 'number'
        ? { waitingMinutes: value.waitingMinutes }
        : {}),
      ...optionalWarning(value),
    };
  }
  return unknownQueue('Live queue information is unavailable.');
}

function unknownWalkIn(warning: string): WalkInAssertion {
  return { status: 'unknown', warning };
}

function unknownQueue(warning: string): QueueAssertion {
  return { status: 'unknown', warning };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasTrustedProvenance(
  value: Record<string, unknown>,
  policy: EntryAccessVerificationPolicy,
): value is Record<string, unknown> & {
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly policyVersion: string;
} {
  if (
    typeof value.sourceUrl !== 'string' ||
    typeof value.checkedAt !== 'string' ||
    value.policyVersion !== policy.policyVersion
  )
    return false;
  let source: URL;
  try {
    source = new URL(value.sourceUrl);
  } catch {
    return false;
  }
  const checkedAtMs = Date.parse(value.checkedAt);
  const ageMs = policy.clock.now().getTime() - checkedAtMs;
  return (
    source.protocol === 'https:' &&
    source.username === '' &&
    source.password === '' &&
    policy.allowedSourceOrigins.includes(source.origin) &&
    Number.isFinite(checkedAtMs) &&
    ageMs >= 0 &&
    ageMs <= policy.maximumAgeMs
  );
}

function optionalProvenance(
  value: Record<string, unknown>,
  policy: EntryAccessVerificationPolicy,
) {
  return hasTrustedProvenance(value, policy)
    ? {
        sourceUrl: value.sourceUrl,
        checkedAt: value.checkedAt,
        policyVersion: value.policyVersion,
      }
    : {};
}

function optionalWarning(value: Record<string, unknown>) {
  return typeof value.warning === 'string' && value.warning.length > 0
    ? { warning: value.warning }
    : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

import { deriveCatalogIntakeResearchInputDigest } from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import type { CatalogIntakeSelectedSubject } from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import type { HardenedResearchTransport } from './hardened-research-transport.ts';
import {
  normalizeResearchRelayProposal,
  signResearchResult,
  verifyResearchAllowance,
  type ResearchRelayProposal,
} from './research-relay-envelope.ts';
import type { RelayReplayGuardPort } from './research-relay-replay-guard.ts';
import type { ResearchSourcePolicy } from './research-source-policy.ts';

export interface ResearchUrlSearchPort {
  search(input: {
    readonly query: string;
    readonly maxResults: 3;
    readonly signal: AbortSignal;
    readonly deadlineAtMs: number;
  }): Promise<unknown>;
}

export interface ResearchScalarExtractorPort {
  extract(input: {
    readonly canonicalUrl: string;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly deadlineAtMs: number;
    readonly subject?: CatalogIntakeSelectedSubject;
  }): Promise<unknown>;
}

type ResearchExtractionOutcome =
  | { readonly status: 'proposal'; readonly proposal: ResearchRelayProposal }
  | { readonly status: 'no_evidence' }
  | {
      readonly status: 'stop';
      readonly reason:
        | 'page_blocked'
        | 'rate_limited'
        | 'unavailable'
        | 'security_blocked'
        | 'conflict';
    };

type RelayPhaseInput =
  | {
      readonly phase: 'initial';
      readonly subject: CatalogIntakeSelectedSubject;
    }
  | { readonly phase: 'initial'; readonly query: string }
  | {
      readonly phase: 'confirm';
      readonly canonicalUrls: readonly string[];
      readonly subject: CatalogIntakeSelectedSubject;
    };

const unknownProposal: ResearchRelayProposal = {
  tabelog: { status: 'unknown' },
  reservation: { status: 'unknown' },
};

export function createResearchRelayHandler(dependencies: {
  readonly allowanceKeys: Readonly<Record<string, string>>;
  readonly resultKey: { readonly keyVersion: string; readonly secret: string };
  readonly now: () => Date;
  readonly replayGuard: RelayReplayGuardPort;
  readonly searchTool: ResearchUrlSearchPort;
  readonly transport: HardenedResearchTransport;
  readonly extractor: ResearchScalarExtractorPort;
  readonly sourcePolicy: ResearchSourcePolicy;
}) {
  return {
    async handle(signedAllowance: unknown, input: unknown) {
      const startedAt = dependencies.now();
      const verified = await verifyResearchAllowance(signedAllowance, {
        keys: dependencies.allowanceKeys,
        now: startedAt,
      });
      if (!verified) {
        return {
          status: 'rejected' as const,
          reason: 'invalid_allowance' as const,
        };
      }
      const normalizedInput = validatePhaseInput(input);
      if (
        !normalizedInput ||
        normalizedInput.phase !== verified.allowance.phase
      ) {
        return {
          status: 'rejected' as const,
          reason: 'payload_mismatch' as const,
        };
      }
      const payloadDigest = await digestPhaseInput(normalizedInput);
      if (
        !payloadDigest ||
        payloadDigest !== verified.allowance.queryOrUrlsDigest
      ) {
        return {
          status: 'rejected' as const,
          reason: 'payload_mismatch' as const,
        };
      }

      const claim = await dependencies.replayGuard.claim({
        requestId: verified.allowance.requestId,
        allowanceDigest: verified.allowanceDigest,
        expiresAt: verified.allowance.deadline,
        now: startedAt,
      });
      if (claim.kind !== 'claimed') {
        return {
          status: 'rejected' as const,
          reason:
            claim.kind === 'replay'
              ? ('replay' as const)
              : ('invalid_allowance' as const),
        };
      }

      const deadlineAtMs = Date.parse(verified.allowance.deadline);
      const abortController = new AbortController();
      const deadlineTimer = setTimeout(
        () =>
          abortController.abort(
            new DOMException('Deadline exceeded.', 'TimeoutError'),
          ),
        Math.max(0, deadlineAtMs - dependencies.now().getTime()),
      );

      try {
        let unavailable = false;
        let searchQueries = 0;
        let urls: readonly string[];
        if (normalizedInput.phase === 'initial') {
          searchQueries = 1;
          try {
            const searchResult = await dependencies.searchTool.search({
              query:
                'subject' in normalizedInput
                  ? `${normalizedInput.subject.transientName} ${normalizedInput.subject.transientAddress}`
                  : normalizedInput.query,
              maxResults: 3,
              signal: abortController.signal,
              deadlineAtMs,
            });
            const validated = validateSearchResult(searchResult);
            unavailable = !validated;
            urls = validated
              ? validated.flatMap((url) => {
                  const allowed =
                    dependencies.sourcePolicy.authorizeCandidate(url);
                  return allowed ? [allowed] : [];
                })
              : [];
          } catch {
            if (abortController.signal.aborted) {
              return {
                status: 'rejected' as const,
                reason: 'deadline' as const,
              };
            }
            unavailable = true;
            urls = [];
          }
        } else {
          urls = normalizedInput.canonicalUrls.flatMap((url) => {
            const allowed = dependencies.sourcePolicy.authorizeCandidate(url);
            return allowed ? [allowed] : [];
          });
        }

        let pageRequests = 0;
        let maximumRedirectsFollowed = 0;
        let proposal = unknownProposal;
        const conflicts = { tabelog: false, reservation: false };
        for (const url of urls.slice(
          0,
          verified.allowance.maxCounts.pageRequests,
        )) {
          if (unavailable) break;
          if (
            dependencies.now().getTime() >=
            Date.parse(verified.allowance.deadline)
          ) {
            break;
          }
          pageRequests += 1;
          let fetched;
          try {
            fetched = await dependencies.transport.get(url, {
              timeoutMs: verified.allowance.requestTimeoutMs,
              maxRedirects: verified.allowance.maxRedirects,
              deadlineAtMs: Date.parse(verified.allowance.deadline),
              signal: abortController.signal,
            });
          } catch {
            if (abortController.signal.aborted) {
              return {
                status: 'rejected' as const,
                reason: 'deadline' as const,
              };
            }
            unavailable = true;
            break;
          }
          maximumRedirectsFollowed = Math.max(
            maximumRedirectsFollowed,
            fetched.redirectsFollowed,
          );
          if (fetched.status === 'failed') {
            if (fetched.reason === 'deadline') {
              return {
                status: 'rejected' as const,
                reason: 'deadline' as const,
              };
            }
            if (fetched.reason === 'no_evidence') continue;
            unavailable = true;
            break;
          }
          if (
            !dependencies.sourcePolicy.authorizeRedirect(url, fetched.finalUrl)
          ) {
            unavailable = true;
            break;
          }
          let extraction: ResearchExtractionOutcome | undefined;
          try {
            extraction = normalizeExtractionOutcome(
              await dependencies.extractor.extract({
                canonicalUrl: fetched.finalUrl,
                body: fetched.body,
                signal: abortController.signal,
                deadlineAtMs,
                ...('subject' in normalizedInput
                  ? { subject: normalizedInput.subject }
                  : {}),
              }),
            );
          } catch {
            if (abortController.signal.aborted) {
              return {
                status: 'rejected' as const,
                reason: 'deadline' as const,
              };
            }
            unavailable = true;
            break;
          }
          if (!extraction) {
            unavailable = true;
            break;
          }
          if (extraction.status === 'stop') {
            unavailable = true;
            break;
          }
          if (extraction.status === 'no_evidence') continue;
          if (!proposalSourcesMatch(extraction.proposal, fetched.finalUrl)) {
            unavailable = true;
            break;
          }
          if (
            !proposalClaimsAllowed(
              extraction.proposal,
              dependencies.sourcePolicy,
            )
          ) {
            unavailable = true;
            break;
          }
          const extracted = normalizeResearchRelayProposal(extraction.proposal);
          if (!extracted) {
            unavailable = true;
            break;
          }
          proposal = mergeProposal(proposal, extracted, conflicts);
          if (conflicts.tabelog || conflicts.reservation) {
            unavailable = true;
            break;
          }
        }

        const completedAt = dependencies.now();
        const elapsedMs = completedAt.getTime() - startedAt.getTime();
        if (
          elapsedMs < 0 ||
          elapsedMs > verified.allowance.maxDurationMs ||
          completedAt.getTime() >= Date.parse(verified.allowance.deadline)
        ) {
          return { status: 'rejected' as const, reason: 'deadline' as const };
        }
        try {
          return {
            status: 'ok' as const,
            result: await signResearchResult({
              requestId: verified.allowance.requestId,
              allowanceDigest: verified.allowanceDigest,
              outcome: unavailable
                ? { kind: 'unavailable' as const }
                : { kind: 'observed' as const, proposal },
              usage: {
                searchQueries,
                pageRequests,
                elapsedMs,
                maximumRedirectsFollowed,
              },
              expiresAt: verified.allowance.deadline,
              key: dependencies.resultKey,
              now: completedAt,
            }),
          };
        } catch {
          return {
            status: 'rejected' as const,
            reason: 'invalid_result' as const,
          };
        }
      } finally {
        clearTimeout(deadlineTimer);
        if (!abortController.signal.aborted) {
          abortController.abort(
            new DOMException('Phase completed.', 'AbortError'),
          );
        }
      }
    },
  };
}

function normalizeExtractionOutcome(
  value: unknown,
): ResearchExtractionOutcome | undefined {
  if (hasExactKeys(value, ['status']) && value.status === 'no_evidence') {
    return { status: 'no_evidence' };
  }
  if (
    hasExactKeys(value, ['status', 'reason']) &&
    value.status === 'stop' &&
    (value.reason === 'page_blocked' ||
      value.reason === 'rate_limited' ||
      value.reason === 'unavailable' ||
      value.reason === 'security_blocked' ||
      value.reason === 'conflict')
  ) {
    return { status: 'stop', reason: value.reason };
  }
  if (
    hasExactKeys(value, ['status', 'proposal']) &&
    value.status === 'proposal'
  ) {
    const proposal = normalizeResearchRelayProposal(value.proposal);
    return proposal ? { status: 'proposal', proposal } : undefined;
  }
  return undefined;
}

function validatePhaseInput(value: unknown): RelayPhaseInput | undefined {
  if (hasExactKeys(value, ['phase', 'subject']) && value.phase === 'initial') {
    const subject = validateSelectedSubject(value.subject);
    return subject ? { phase: 'initial', subject } : undefined;
  }
  if (hasExactKeys(value, ['phase', 'query']) && value.phase === 'initial') {
    if (
      typeof value.query !== 'string' ||
      value.query.length < 1 ||
      value.query.length > 500 ||
      value.query.normalize('NFC').trim() !== value.query ||
      /\p{Cc}/u.test(value.query)
    )
      return undefined;
    return { phase: 'initial', query: value.query };
  }
  if (
    hasExactKeys(value, ['phase', 'canonicalUrls', 'subject']) &&
    value.phase === 'confirm' &&
    isCanonicalUrlArray(value.canonicalUrls) &&
    value.canonicalUrls.length >= 1 &&
    value.canonicalUrls.length <= 2 &&
    value.canonicalUrls.every(isCanonicalHttpsUrl)
  ) {
    const subject = validateSelectedSubject(value.subject);
    if (!subject) return undefined;
    const canonicalUrls = value.canonicalUrls;
    const sorted = [...new Set(canonicalUrls)].sort(codeUnitOrder);
    if (
      sorted.length !== canonicalUrls.length ||
      sorted.some((url, index) => url !== canonicalUrls[index])
    ) {
      return undefined;
    }
    return { phase: 'confirm', canonicalUrls: sorted, subject };
  }
  return undefined;
}

function isCanonicalUrlArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isCanonicalHttpsUrl);
}

function digestPhaseInput(input: RelayPhaseInput): Promise<string | undefined> {
  if (input.phase === 'initial') {
    return 'subject' in input
      ? deriveCatalogIntakeResearchInputDigest({
          phase: 'initial',
          selectedSubject: input.subject,
        })
      : deriveCatalogIntakeResearchInputDigest({
          phase: 'initial',
          normalizedOwnerQuery: input.query,
        });
  }
  return deriveCatalogIntakeResearchInputDigest({
    phase: 'confirm',
    canonicalUrls: input.canonicalUrls,
    selectedSubject: input.subject,
  });
}

function validateSelectedSubject(
  value: unknown,
): CatalogIntakeSelectedSubject | undefined {
  if (
    !hasExactKeys(value, [
      'ownerQuery',
      'providerNamespace',
      'placeId',
      'transientName',
      'transientAddress',
    ])
  ) {
    return undefined;
  }
  for (const key of [
    'ownerQuery',
    'providerNamespace',
    'placeId',
    'transientName',
    'transientAddress',
  ] as const) {
    const field = value[key];
    if (
      typeof field !== 'string' ||
      field.length < 1 ||
      field.length > 500 ||
      field.normalize('NFC').trim() !== field ||
      /\p{Cc}/u.test(field)
    ) {
      return undefined;
    }
  }
  return value as unknown as CatalogIntakeSelectedSubject;
}

function validateSearchResult(value: unknown): readonly string[] | undefined {
  if (
    !hasExactKeys(value, ['urls']) ||
    !Array.isArray(value.urls) ||
    value.urls.length > 3 ||
    !value.urls.every(isCanonicalHttpsUrl)
  ) {
    return undefined;
  }
  return [...new Set(value.urls)];
}

function isCanonicalHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.hash === '' &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function proposalSourcesMatch(
  proposal: ResearchRelayProposal,
  sourceUrl: string,
): boolean {
  return (
    (proposal.tabelog.status === 'unknown' ||
      proposal.tabelog.url === sourceUrl) &&
    (proposal.reservation.status === 'unknown' ||
      proposal.reservation.url === sourceUrl)
  );
}

function proposalClaimsAllowed(
  proposal: ResearchRelayProposal,
  policy: ResearchSourcePolicy,
): boolean {
  return (
    (proposal.tabelog.status === 'unknown' ||
      policy.authorizeClaim('tabelog', proposal.tabelog.url) ===
        proposal.tabelog.url) &&
    (proposal.reservation.status === 'unknown' ||
      policy.authorizeClaim('reservation', proposal.reservation.url) ===
        proposal.reservation.url)
  );
}

function mergeProposal(
  current: ResearchRelayProposal,
  next: ResearchRelayProposal,
  conflicts: { tabelog: boolean; reservation: boolean },
): ResearchRelayProposal {
  return {
    tabelog: mergeEvidence(current.tabelog, next.tabelog, 'tabelog', conflicts),
    reservation: mergeEvidence(
      current.reservation,
      next.reservation,
      'reservation',
      conflicts,
    ),
  };
}

function mergeEvidence<T extends { readonly status: string }>(
  current: T,
  next: T,
  key: 'tabelog' | 'reservation',
  conflicts: { tabelog: boolean; reservation: boolean },
): T {
  if (conflicts[key] || next.status === 'unknown') return current;
  if (current.status === 'unknown') return next;
  if (JSON.stringify(current) === JSON.stringify(next)) return current;
  conflicts[key] = true;
  return { status: 'unknown' } as T;
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort(codeUnitOrder);
  const expected = [...expectedKeys].sort(codeUnitOrder);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

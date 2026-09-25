import type {
  CatalogIntakeSelectedSubject,
  CatalogIntakeResearchPhase,
  CatalogIntakeStatePort,
  WebResearchInput,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import {
  signResearchAllowance,
  verifyResearchResult,
} from './research-relay-envelope.ts';

type RelayPayload =
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

export interface ResearchRelayRpcPort {
  invoke(input: {
    readonly allowance: unknown;
    readonly payload: RelayPayload;
    readonly signal: AbortSignal;
    readonly deadlineAtMs: number;
    readonly maxAttempts: 1;
    readonly redirect: 'error';
  }): Promise<unknown>;
}

export function createResearchRelayWebResearchPort(dependencies: {
  readonly statePort: Pick<CatalogIntakeStatePort, 'consumeResearchPhase'>;
  readonly allowanceKey: {
    readonly keyVersion: string;
    readonly secret: string;
  };
  readonly resultKeys: Readonly<Record<string, string>>;
  readonly clock: { now(): Date };
  readonly requestIds: { nextId(): string };
  readonly relay: ResearchRelayRpcPort;
}) {
  return {
    async research(input: WebResearchInput) {
      const requestId = dependencies.requestIds.nextId();
      let consumed;
      try {
        consumed = await dependencies.statePort.consumeResearchPhase({
          scope: input.scope,
          sessionId: input.sessionId,
          expectedSessionVersion: input.expectedSessionVersion,
          phase: input.phase,
          queryOrUrlsDigest: input.queryOrUrlsDigest,
          requestId,
          ...('selectedSubject' in input
            ? { selectedIdentity: input.selectedSubject }
            : {}),
        });
      } catch {
        return { kind: 'unavailable' as const };
      }
      if (consumed.kind !== 'consumed') {
        return {
          kind: consumed.kind as Exclude<typeof consumed.kind, 'consumed'>,
        };
      }
      if (
        !allowanceMatches(
          consumed.allowance,
          input.phase,
          input.sessionId,
          input.queryOrUrlsDigest,
          requestId,
        )
      ) {
        return { kind: 'conflict' as const };
      }

      const signedAt = dependencies.clock.now();
      let signedAllowance: Awaited<ReturnType<typeof signResearchAllowance>>;
      try {
        signedAllowance = await signResearchAllowance({
          allowance: consumed.allowance,
          key: dependencies.allowanceKey,
          now: signedAt,
        });
      } catch {
        return { kind: 'unavailable' as const };
      }

      const payload: RelayPayload =
        input.phase === 'initial'
          ? 'selectedSubject' in input
            ? { phase: 'initial', subject: input.selectedSubject }
            : { phase: 'initial', query: input.normalizedOwnerQuery }
          : {
              phase: 'confirm',
              canonicalUrls: input.canonicalUrls,
              subject: input.selectedSubject,
            };
      let response: unknown;
      const deadlineAtMs = Date.parse(consumed.allowance.deadline);
      const abortController = new AbortController();
      const deadlineTimer = setTimeout(
        () =>
          abortController.abort(
            new DOMException('Relay deadline exceeded.', 'TimeoutError'),
          ),
        Math.max(0, deadlineAtMs - dependencies.clock.now().getTime()),
      );
      try {
        response = await dependencies.relay.invoke({
          allowance: signedAllowance,
          payload,
          signal: abortController.signal,
          deadlineAtMs,
          maxAttempts: 1,
          redirect: 'error',
        });
      } catch {
        return {
          kind: abortController.signal.aborted
            ? ('unavailable' as const)
            : ('response_lost' as const),
        };
      } finally {
        clearTimeout(deadlineTimer);
        if (!abortController.signal.aborted) {
          abortController.abort(
            new DOMException('Relay request completed.', 'AbortError'),
          );
        }
      }
      if (!isExactOkResponse(response)) return { kind: 'unavailable' as const };

      const observedAt = dependencies.clock.now();
      const verified = await verifyResearchResult(response.result, {
        keys: dependencies.resultKeys,
        now: observedAt,
        allowance: consumed.allowance,
        allowanceDigest: signedAllowance.allowanceDigest,
      });
      if (!verified) return { kind: 'unavailable' as const };
      if (verified.outcome.kind === 'unavailable') {
        return { kind: 'unavailable' as const };
      }
      const proposal = verified.outcome.proposal;
      return {
        kind: 'observed' as const,
        value: {
          tabelog:
            proposal.tabelog.status === 'known'
              ? {
                  ...proposal.tabelog,
                  provenance: 'agent_observed' as const,
                  observedAt: observedAt.toISOString(),
                  freshness: 'fresh' as const,
                }
              : { status: 'unknown' as const },
          reservation:
            proposal.reservation.status === 'known'
              ? {
                  ...proposal.reservation,
                  provenance: 'agent_observed' as const,
                  observedAt: observedAt.toISOString(),
                  freshness: 'fresh' as const,
                }
              : { status: 'unknown' as const },
        },
      };
    },
  };
}

function allowanceMatches(
  allowance: {
    readonly sessionId: string;
    readonly phase: CatalogIntakeResearchPhase;
    readonly queryOrUrlsDigest: string;
    readonly requestId: string;
  },
  phase: CatalogIntakeResearchPhase,
  sessionId: string,
  queryOrUrlsDigest: string,
  requestId: string,
): boolean {
  return (
    allowance.sessionId === sessionId &&
    allowance.phase === phase &&
    allowance.queryOrUrlsDigest === queryOrUrlsDigest &&
    allowance.requestId === requestId
  );
}

function isExactOkResponse(
  value: unknown,
): value is { readonly status: 'ok'; readonly result: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.status === 'ok' &&
    Object.keys(record).length === 2 &&
    Object.hasOwn(record, 'result')
  );
}

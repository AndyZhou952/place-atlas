import type {
  AtlasApplication,
  AtomicMutationCommit,
} from '../atlas-application.ts';
import type { ApplicationError } from '../result.ts';

const encoder = new TextEncoder();
const mutationLeaseMs = 30_000;

export interface InvocationContext {
  readonly principal: string;
  readonly channel: string;
  readonly scopes: readonly string[];
  readonly requestedAt: string;
}

export interface MutationReceipt<ResultValue = unknown> {
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly result: ResultValue;
  readonly replayed: boolean;
}

export interface MutationEnvelope {
  readonly operation: string;
  readonly input: unknown;
  readonly mutationId: string;
  readonly invocation: InvocationContext;
}

export interface StoredMutationReceipt {
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly result: unknown;
}

export interface MutationAttempt {
  readonly principal: string;
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly attemptToken: string;
  readonly nowMs: number;
  readonly leaseUntilMs: number;
}

export type MutationClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'replay'; readonly receipt: StoredMutationReceipt }
  | { readonly kind: 'conflict' };

export interface MutationReceiptState {
  claim(input: MutationAttempt): Promise<MutationClaim>;
  readFinal(input: {
    readonly principal: string;
    readonly mutationId: string;
    readonly payloadDigest: string;
  }): Promise<
    | { readonly kind: 'replay'; readonly receipt: StoredMutationReceipt }
    | { readonly kind: 'pending' }
    | { readonly kind: 'conflict' }
  >;
  release(input: MutationAttempt): Promise<void>;
}

type InvocationMutationError =
  | ApplicationError
  | {
      readonly kind: 'conflict' | 'in_progress';
      readonly message: string;
    };

export type InvocationMutationResult =
  | { readonly ok: true; readonly value: MutationReceipt }
  | { readonly ok: false; readonly error: InvocationMutationError };

export function createInvocationCoordinator<Definitions extends object>(input: {
  readonly application: AtlasApplication<Definitions>;
  readonly receipts: MutationReceiptState;
  readonly attemptToken?: () => string;
  readonly clock?: { readonly nowMs: () => number };
}) {
  return {
    async mutate(
      envelope: MutationEnvelope,
    ): Promise<InvocationMutationResult> {
      if (!isMutationId(envelope.mutationId)) return invalidMutationId();
      if (!isInvocationContext(envelope.invocation)) return invalidInvocation();

      const normalized = input.application.normalize({
        key: envelope.operation as never,
        input: envelope.input as never,
      });
      if (!normalized.ok) return normalized;

      const payloadDigest = await digestMutationPayload(
        envelope.operation,
        normalized.value.input,
      );
      const nowMs = input.clock?.nowMs() ?? Date.now();
      const attempt: MutationAttempt = {
        principal: envelope.invocation.principal,
        mutationId: envelope.mutationId,
        payloadDigest,
        attemptToken: input.attemptToken?.() ?? crypto.randomUUID(),
        nowMs,
        leaseUntilMs: nowMs + mutationLeaseMs,
      };
      const claim = await input.receipts.claim(attempt);
      if (claim.kind === 'conflict') return mutationConflict();
      if (claim.kind === 'pending') return mutationInProgress();
      if (claim.kind === 'replay') {
        return { ok: true, value: replayReceipt(claim.receipt) };
      }

      const receiptFor = (result: unknown): AtomicMutationCommit => ({
        principal: attempt.principal,
        mutationId: attempt.mutationId,
        payloadDigest: attempt.payloadDigest,
        attemptToken: attempt.attemptToken,
        result,
        committedAtMs: input.clock?.nowMs() ?? Date.now(),
      });
      try {
        const result = await input.application.executePrepared(
          normalized.value,
          {
            atomicMutation: { receiptFor },
          },
        );
        if (!result.ok) {
          await input.receipts.release(attempt);
          return result;
        }
        const finalized = await input.receipts.readFinal({
          principal: attempt.principal,
          mutationId: attempt.mutationId,
          payloadDigest: attempt.payloadDigest,
        });
        if (finalized.kind === 'replay') {
          return {
            ok: true,
            value: { ...finalized.receipt, replayed: false },
          };
        }
        if (finalized.kind === 'conflict') return mutationConflict();
        return mutationNotFinalized();
      } catch {
        return mutationUnavailable();
      }
    },
  };
}

export function canonicalMutationPayload(
  operation: string,
  normalizedInput: unknown,
): string {
  return JSON.stringify(
    sortCanonicalValue({
      version: 'atlas-mutation-v1',
      operation,
      input: normalizedInput,
    }),
  );
}

async function digestMutationPayload(
  operation: string,
  normalizedInput: unknown,
): Promise<string> {
  const digestSafeInput = await replaceBinaryWithDigest(normalizedInput);
  const bytes = encoder.encode(
    canonicalMutationPayload(operation, digestSafeInput),
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function replaceBinaryWithDigest(value: unknown): Promise<unknown> {
  if (value instanceof Uint8Array) {
    const copy = Uint8Array.from(value);
    const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
    return {
      $binarySha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      byteLength: value.byteLength,
    };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => replaceBinaryWithDigest(entry)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [
          key,
          await replaceBinaryWithDigest(entry),
        ]),
      ),
    );
  }
  return value;
}

function sortCanonicalValue(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortCanonicalValue(value[key])]),
  );
}

function isMutationId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/u.test(value);
}

function isInvocationContext(value: InvocationContext): boolean {
  return (
    typeof value.principal === 'string' &&
    Boolean(value.principal) &&
    typeof value.channel === 'string' &&
    Boolean(value.channel) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === 'string') &&
    typeof value.requestedAt === 'string' &&
    !Number.isNaN(Date.parse(value.requestedAt))
  );
}

function replayReceipt(receipt: StoredMutationReceipt): MutationReceipt {
  return { ...receipt, replayed: true };
}

function invalidMutationId(): InvocationMutationResult {
  return {
    ok: false,
    error: {
      kind: 'invalid_input',
      message: 'A valid mutation ID is required.',
    },
  };
}

function invalidInvocation(): InvocationMutationResult {
  return {
    ok: false,
    error: { kind: 'invalid_input', message: 'Invalid invocation context.' },
  };
}

function mutationConflict(): InvocationMutationResult {
  return {
    ok: false,
    error: {
      kind: 'conflict',
      message: 'The mutation conflicts with an earlier request.',
    },
  };
}

function mutationInProgress(): InvocationMutationResult {
  return {
    ok: false,
    error: {
      kind: 'in_progress',
      message: 'The mutation is already in progress.',
    },
  };
}

function mutationNotFinalized(): InvocationMutationResult {
  return {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The mutation did not finalize atomically.',
    },
  };
}

function mutationUnavailable(): InvocationMutationResult {
  return {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The mutation could not be completed.',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

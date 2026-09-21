import { createAgentToolCatalog } from './project-command-router.ts';
import {
  agentSignatureHeaders,
  canonicalAgentRequestBytes,
  canonicalJson,
  sha256Hex,
  verifyAgentHmac,
} from './agent-request-signing.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const maximumClockSkewSeconds = 300;

export interface AgentSignedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface AgentServiceKey {
  readonly keyId: string;
  readonly projectId: 'jpmap';
  readonly secret: string;
  readonly active: boolean;
  readonly owner: AgentActor;
  readonly scopes: readonly string[];
}

export interface AgentActor {
  readonly actorId: string;
  readonly channel: string;
  readonly conversationId: string;
  readonly conversationType: string;
}

export interface AgentServiceKeyStore {
  find(keyId: string): Promise<AgentServiceKey | undefined>;
}

export interface AgentGatewayReceipt {
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly replayed: boolean;
  readonly result: ProjectCommandReply;
}

export type StoredAgentGatewayReceipt = Omit<AgentGatewayReceipt, 'replayed'>;

export type AgentMutationClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'replay';
      readonly receipt: StoredAgentGatewayReceipt;
    }
  | { readonly kind: 'conflict' };

export type AgentMutationSettlement =
  | {
      readonly kind: 'replay';
      readonly receipt: StoredAgentGatewayReceipt;
    }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unavailable' };

export interface AgentMutationIdentity {
  readonly projectId: string;
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly claimId: string;
}

export interface AgentGatewayState {
  consumeNonce(input: {
    readonly projectId: string;
    readonly keyId: string;
    readonly nonce: string;
    readonly nowMs: number;
    readonly retainUntilMs: number;
  }): Promise<boolean>;
  claimMutation(input: AgentMutationIdentity): Promise<AgentMutationClaim>;
  waitForMutation(
    input: Omit<AgentMutationIdentity, 'claimId'>,
  ): Promise<AgentMutationSettlement>;
  commitMutation(input: {
    readonly identity: AgentMutationIdentity;
    readonly receipt: StoredAgentGatewayReceipt;
  }): Promise<StoredAgentGatewayReceipt>;
  releaseMutation(input: AgentMutationIdentity): Promise<void>;
}

export interface AgentAuditEvent {
  readonly projectId: string;
  readonly keyId: string;
  readonly actorId: string;
  readonly channel: string;
  readonly conversationId: string;
  readonly operation: string;
  readonly mutationId: string;
  readonly resultKind: AgentAuditResultKind;
  readonly replayed: boolean;
  readonly durationMs: number;
}

export interface AgentAuditSink {
  record(event: AgentAuditEvent): Promise<void>;
}

export interface AgentServiceResponse {
  readonly status: number;
  readonly body:
    | { readonly ok: true; readonly receipt: AgentGatewayReceipt }
    | { readonly ok: false; readonly error: AgentServiceError };
}

export type AgentServiceErrorKind =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'dependency_failure'
  | 'unexpected_failure';

interface AgentServiceError {
  readonly kind: AgentServiceErrorKind;
  readonly message: string;
}

type AgentAuditResultKind = 'success' | AgentServiceErrorKind;

interface ProjectCommandReply {
  readonly projectId: 'jpmap';
  readonly operation: 'nearby';
  readonly replyText: string;
}

interface ProjectCommandRouter {
  dispatch(command: string): Promise<
    | { readonly ok: true; readonly value: ProjectCommandReply }
    | {
        readonly ok: false;
        readonly error: {
          readonly kind:
            | 'invalid_input'
            | 'not_found'
            | 'dependency_failure'
            | 'unexpected_failure';
          readonly message: string;
        };
      }
  >;
}

interface AgentToolCatalog {
  manifest(
    projectId: 'jpmap',
    phase: 'read',
  ): ReturnType<ReturnType<typeof createAgentToolCatalog>['manifest']>;
}

interface AgentServiceGatewayDependencies {
  readonly router: ProjectCommandRouter;
  readonly toolCatalog: AgentToolCatalog;
  readonly keys: AgentServiceKeyStore;
  readonly state: AgentGatewayState;
  readonly audit: AgentAuditSink;
  readonly clock: { readonly nowMs: () => number };
}

interface AgentRequestBody {
  readonly version: '1';
  readonly projectId: string;
  readonly tool: string;
  readonly mutationId: string;
  readonly actor: AgentActor;
  readonly input: Readonly<Record<string, unknown>>;
}

export function createAgentServiceGateway(
  dependencies: AgentServiceGatewayDependencies,
) {
  return {
    async handle(request: AgentSignedRequest): Promise<AgentServiceResponse> {
      const startedAt = dependencies.clock.nowMs();
      let auditContext:
        | {
            readonly body: AgentRequestBody;
            readonly key: AgentServiceKey;
          }
        | undefined;
      let activeClaim: AgentMutationIdentity | undefined;
      try {
        const authenticated = await authenticateRequest(
          request,
          dependencies,
          startedAt,
        );
        if (!authenticated.ok) {
          await recordAuthenticationAudit(
            dependencies,
            authenticated.auditContext,
            'unauthorized',
            startedAt,
          );
          return authenticated.response;
        }

        const parsed = parseRequestBody(request.body);
        if (!parsed.ok) {
          await recordAuthenticationAudit(
            dependencies,
            {
              projectId: authenticated.key.projectId,
              keyId: authenticated.key.keyId,
            },
            'invalid_input',
            startedAt,
          );
          return parsed.response;
        }
        const body = parsed.value;
        const key = authenticated.key;
        auditContext = { body, key };
        if (body.projectId !== key.projectId) {
          await recordAudit(
            dependencies,
            body,
            key,
            'unauthorized',
            false,
            startedAt,
          );
          return errorResponse('unauthorized');
        }

        const manifest = dependencies.toolCatalog.manifest('jpmap', 'read');
        const tool = manifest.tools.find((entry) => entry.name === body.tool);
        if (!tool || tool.effect !== 'read') {
          await recordAudit(
            dependencies,
            body,
            key,
            'forbidden',
            false,
            startedAt,
          );
          return errorResponse('forbidden');
        }
        if (!key.scopes.includes(tool.requiredScope)) {
          await recordAudit(
            dependencies,
            body,
            key,
            'forbidden',
            false,
            startedAt,
          );
          return errorResponse('forbidden');
        }
        if (!sameActor(body.actor, key.owner)) {
          await recordAudit(
            dependencies,
            body,
            key,
            'forbidden',
            false,
            startedAt,
          );
          return errorResponse('forbidden');
        }

        const locationHint = validateNearbyToolInput(body.input);
        if (!locationHint) {
          await recordAudit(
            dependencies,
            body,
            key,
            'invalid_input',
            false,
            startedAt,
          );
          return errorResponse('invalid_input');
        }

        const payloadDigest = await sha256Hex(
          encoder.encode(canonicalJson(body)),
        );
        const mutationIdentity: AgentMutationIdentity = {
          projectId: body.projectId,
          mutationId: body.mutationId,
          payloadDigest,
          claimId: authenticated.nonce,
        };
        const claim = await dependencies.state.claimMutation(mutationIdentity);
        if (claim.kind === 'conflict') {
          await recordAudit(
            dependencies,
            body,
            key,
            'conflict',
            false,
            startedAt,
          );
          return errorResponse('conflict');
        }
        if (claim.kind === 'replay') {
          const receipt = { ...claim.receipt, replayed: true };
          await recordAudit(
            dependencies,
            body,
            key,
            'success',
            true,
            startedAt,
          );
          return { status: 200, body: { ok: true, receipt } };
        }
        if (claim.kind === 'pending') {
          const settlement = await dependencies.state.waitForMutation({
            projectId: body.projectId,
            mutationId: body.mutationId,
            payloadDigest,
          });
          if (settlement.kind === 'conflict') {
            await recordAudit(
              dependencies,
              body,
              key,
              'conflict',
              false,
              startedAt,
            );
            return errorResponse('conflict');
          }
          if (settlement.kind === 'unavailable') {
            await recordAudit(
              dependencies,
              body,
              key,
              'dependency_failure',
              false,
              startedAt,
            );
            return errorResponse('dependency_failure');
          }
          const receipt = { ...settlement.receipt, replayed: true };
          await recordAudit(
            dependencies,
            body,
            key,
            'success',
            true,
            startedAt,
          );
          return { status: 200, body: { ok: true, receipt } };
        }
        activeClaim = mutationIdentity;

        const routed = await dependencies.router.dispatch(
          `/jpmap nearby ${locationHint}`,
        );
        if (!routed.ok) {
          const response = errorResponse(routed.error.kind);
          await dependencies.state.releaseMutation(mutationIdentity);
          activeClaim = undefined;
          await recordAudit(
            dependencies,
            body,
            key,
            routed.error.kind,
            false,
            startedAt,
          );
          return response;
        }

        const proposedReceipt = {
          mutationId: body.mutationId,
          payloadDigest,
          result: routed.value,
        };
        const storedReceipt = await dependencies.state.commitMutation({
          identity: mutationIdentity,
          receipt: proposedReceipt,
        });
        activeClaim = undefined;
        const receipt = { ...storedReceipt, replayed: false };
        await recordAudit(dependencies, body, key, 'success', false, startedAt);
        return { status: 200, body: { ok: true, receipt } };
      } catch {
        if (activeClaim) {
          try {
            await dependencies.state.releaseMutation(activeClaim);
          } catch {
            // Recovery errors must not expose internal state.
          }
        }
        if (auditContext) {
          try {
            await recordAudit(
              dependencies,
              auditContext.body,
              auditContext.key,
              'unexpected_failure',
              false,
              startedAt,
            );
          } catch {
            // The audit store is itself an external dependency.
          }
        }
        return errorResponse('unexpected_failure');
      }
    },
  };
}

export class InMemoryAgentGatewayState implements AgentGatewayState {
  readonly #nonces = new Map<string, number>();
  readonly #mutations = new Map<string, InMemoryMutation>();

  async consumeNonce(input: {
    readonly projectId: string;
    readonly keyId: string;
    readonly nonce: string;
    readonly nowMs: number;
    readonly retainUntilMs: number;
  }): Promise<boolean> {
    const key = `${input.projectId}\u0000${input.keyId}\u0000${input.nonce}`;
    const existing = this.#nonces.get(key);
    if (existing !== undefined && existing > input.nowMs) return false;
    this.#nonces.set(key, input.retainUntilMs);
    return true;
  }

  async claimMutation(
    input: AgentMutationIdentity,
  ): Promise<AgentMutationClaim> {
    const key = mutationKey(input.projectId, input.mutationId);
    const existing = this.#mutations.get(key);
    if (!existing) {
      let settle: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      this.#mutations.set(key, {
        payloadDigest: input.payloadDigest,
        claimId: input.claimId,
        settled,
        settle,
      });
      return { kind: 'claimed' };
    }
    if (existing.payloadDigest !== input.payloadDigest) {
      return { kind: 'conflict' };
    }
    return existing.receipt
      ? { kind: 'replay', receipt: existing.receipt }
      : { kind: 'pending' };
  }

  async waitForMutation(
    input: Omit<AgentMutationIdentity, 'claimId'>,
  ): Promise<AgentMutationSettlement> {
    const key = mutationKey(input.projectId, input.mutationId);
    const existing = this.#mutations.get(key);
    if (!existing) return { kind: 'unavailable' };
    if (existing.payloadDigest !== input.payloadDigest) {
      return { kind: 'conflict' };
    }
    if (!existing.receipt) await existing.settled;
    const settled = this.#mutations.get(key);
    if (!settled) return { kind: 'unavailable' };
    if (settled.payloadDigest !== input.payloadDigest) {
      return { kind: 'conflict' };
    }
    return settled.receipt
      ? { kind: 'replay', receipt: settled.receipt }
      : { kind: 'unavailable' };
  }

  async commitMutation(input: {
    readonly identity: AgentMutationIdentity;
    readonly receipt: StoredAgentGatewayReceipt;
  }): Promise<StoredAgentGatewayReceipt> {
    const key = mutationKey(
      input.identity.projectId,
      input.identity.mutationId,
    );
    const existing = this.#mutations.get(key);
    if (
      !existing ||
      existing.payloadDigest !== input.identity.payloadDigest ||
      existing.claimId !== input.identity.claimId
    ) {
      throw new Error('Agent mutation claim was lost.');
    }
    if (existing.receipt) return existing.receipt;
    const completed = { ...existing, receipt: input.receipt };
    this.#mutations.set(key, completed);
    completed.settle();
    return input.receipt;
  }

  async releaseMutation(input: AgentMutationIdentity): Promise<void> {
    const key = mutationKey(input.projectId, input.mutationId);
    const existing = this.#mutations.get(key);
    if (
      !existing ||
      existing.receipt ||
      existing.payloadDigest !== input.payloadDigest ||
      existing.claimId !== input.claimId
    ) {
      return;
    }
    this.#mutations.delete(key);
    existing.settle();
  }
}

interface InMemoryMutation {
  readonly payloadDigest: string;
  readonly claimId: string;
  readonly receipt?: StoredAgentGatewayReceipt;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

function mutationKey(projectId: string, mutationId: string): string {
  return `${projectId}\u0000${mutationId}`;
}

async function authenticateRequest(
  request: AgentSignedRequest,
  dependencies: AgentServiceGatewayDependencies,
  nowMs: number,
): Promise<
  | { readonly ok: true; readonly key: AgentServiceKey; readonly nonce: string }
  | {
      readonly ok: false;
      readonly response: AgentServiceResponse;
      readonly auditContext: AuthenticationAuditContext;
    }
> {
  const keyId = request.headers[agentSignatureHeaders.keyId];
  const timestamp = request.headers[agentSignatureHeaders.timestamp];
  const nonce = request.headers[agentSignatureHeaders.nonce];
  const signature = request.headers[agentSignatureHeaders.signature];
  if (
    !keyId ||
    !timestamp ||
    !nonce ||
    !signature ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(keyId) ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(nonce) ||
    !/^\d{1,12}$/u.test(timestamp)
  ) {
    return authenticationFailure('unknown', keyId ?? 'unknown');
  }

  const key = await dependencies.keys.find(keyId);
  if (!key || !key.active || key.keyId !== keyId) {
    return authenticationFailure(key?.projectId ?? 'unknown', keyId);
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > maximumClockSkewSeconds) {
    return authenticationFailure(key.projectId, keyId);
  }

  const bodyDigest = await sha256Hex(request.body);
  const validSignature = await verifyAgentHmac(
    key.secret,
    canonicalAgentRequestBytes({
      method: request.method,
      url: request.url,
      bodyDigest,
      timestamp,
      nonce,
      keyId,
    }),
    signature,
  );
  if (!validSignature) {
    return authenticationFailure(key.projectId, keyId);
  }

  const consumed = await dependencies.state.consumeNonce({
    projectId: key.projectId,
    keyId,
    nonce,
    nowMs,
    retainUntilMs: nowMs + (maximumClockSkewSeconds + 1) * 1000,
  });
  return consumed
    ? { ok: true, key, nonce }
    : authenticationFailure(key.projectId, keyId);
}

interface AuthenticationAuditContext {
  readonly projectId: string;
  readonly keyId: string;
}

function authenticationFailure(
  projectId: string,
  keyId: string,
): {
  readonly ok: false;
  readonly response: AgentServiceResponse;
  readonly auditContext: AuthenticationAuditContext;
} {
  return {
    ok: false,
    response: errorResponse('unauthorized'),
    auditContext: { projectId, keyId: auditSafeKeyId(keyId) },
  };
}

function auditSafeKeyId(value: string): string {
  return /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : 'unknown';
}

function parseRequestBody(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly value: AgentRequestBody }
  | { readonly ok: false; readonly response: AgentServiceResponse } {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    return { ok: false, response: errorResponse('invalid_input') };
  }
  if (!isRecord(value) || !hasOnlyKeys(value, requestBodyKeys)) {
    return { ok: false, response: errorResponse('invalid_input') };
  }
  if (
    value.version !== '1' ||
    typeof value.projectId !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(value.projectId) ||
    typeof value.tool !== 'string' ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(value.tool) ||
    typeof value.mutationId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,160}$/u.test(value.mutationId) ||
    !isActor(value.actor) ||
    !isRecord(value.input)
  ) {
    return { ok: false, response: errorResponse('invalid_input') };
  }
  return {
    ok: true,
    value: {
      version: '1',
      projectId: value.projectId,
      tool: value.tool,
      mutationId: value.mutationId,
      actor: value.actor,
      input: value.input,
    },
  };
}

const requestBodyKeys = [
  'version',
  'projectId',
  'tool',
  'mutationId',
  'actor',
  'input',
] as const;

function isActor(value: unknown): value is AgentActor {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'actorId',
      'channel',
      'conversationId',
      'conversationType',
    ]) &&
    isBoundedText(value.actorId) &&
    isBoundedText(value.channel) &&
    isBoundedText(value.conversationId) &&
    isBoundedText(value.conversationType)
  );
}

function sameActor(left: AgentActor, right: AgentActor): boolean {
  return (
    left.actorId === right.actorId &&
    left.channel === right.channel &&
    left.conversationId === right.conversationId &&
    left.conversationType === right.conversationType
  );
}

function validateNearbyToolInput(
  input: Readonly<Record<string, unknown>>,
): string | undefined {
  if (
    !hasOnlyKeys(input, ['locationHint']) ||
    typeof input.locationHint !== 'string'
  ) {
    return undefined;
  }
  const locationHint = input.locationHint.trim();
  if (
    !locationHint ||
    locationHint.length > 1_000 ||
    /[\r\n]/u.test(locationHint)
  ) {
    return undefined;
  }
  return locationHint;
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    hasNoControlCharacters(value)
  );
}

function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit === 127) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function errorResponse(kind: AgentServiceErrorKind): AgentServiceResponse {
  const messages: Record<AgentServiceErrorKind, string> = {
    invalid_input: 'The agent request is invalid.',
    unauthorized: 'The agent request could not be authenticated.',
    forbidden: 'The requested agent operation is not allowed.',
    not_found: 'The requested Atlas resource was not found.',
    conflict: 'The agent request conflicts with an earlier request.',
    dependency_failure: 'Japan Atlas is temporarily unavailable.',
    unexpected_failure: 'The agent request could not be completed.',
  };
  const statuses: Record<AgentServiceErrorKind, number> = {
    invalid_input: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    dependency_failure: 503,
    unexpected_failure: 500,
  };
  return {
    status: statuses[kind],
    body: { ok: false, error: { kind, message: messages[kind] } },
  };
}

async function recordAudit(
  dependencies: AgentServiceGatewayDependencies,
  body: AgentRequestBody,
  key: AgentServiceKey,
  resultKind: AgentAuditResultKind,
  replayed: boolean,
  startedAt: number,
): Promise<void> {
  await dependencies.audit.record({
    projectId: key.projectId,
    keyId: key.keyId,
    actorId: body.actor.actorId,
    channel: body.actor.channel,
    conversationId: body.actor.conversationId,
    operation: body.tool === 'jpmap_nearby' ? 'agent.nearby' : body.tool,
    mutationId: body.mutationId,
    resultKind,
    replayed,
    durationMs: Math.max(0, dependencies.clock.nowMs() - startedAt),
  });
}

async function recordAuthenticationAudit(
  dependencies: AgentServiceGatewayDependencies,
  context: AuthenticationAuditContext,
  resultKind: AgentServiceErrorKind,
  startedAt: number,
): Promise<void> {
  await dependencies.audit.record({
    projectId: context.projectId,
    keyId: context.keyId,
    actorId: 'unknown',
    channel: 'unknown',
    conversationId: 'unknown',
    operation: 'unknown',
    mutationId: 'unknown',
    resultKind,
    replayed: false,
    durationMs: Math.max(0, dependencies.clock.nowMs() - startedAt),
  });
}

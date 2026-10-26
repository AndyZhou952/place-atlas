// HTTP adapter for the Add harness. Contract (unchanged): POST {input} to
// /api/catalog-intake/{discover,select,confirm,cancel} with the Owner session, or POST
// {operation, input} to /api/agent/catalog-intake with the Add Agent Bearer token. The
// conversation header returned by discover must be echoed on later steps.
import { addAgentConversationId, ownerWebConversationId } from '../../auth.ts';
import type { Env } from '../../env.ts';
import { HttpError } from '../../http.ts';
import { createAddHarness } from './compose.ts';
import {
  type AddErrorCode,
  type CatalogIntakeOperation,
  executeCatalogIntake,
} from './workflow.ts';

export const WEB_CONVERSATION_HEADER = 'x-atlas-web-conversation-id';
export const AGENT_CONVERSATION_HEADER = 'x-atlas-agent-conversation-id';
const OPERATIONS = new Set<CatalogIntakeOperation>(['discover', 'select', 'confirm', 'cancel']);
/** The external Add Agent's operation names on the wire (unchanged from 0.1). */
const AGENT_OPERATIONS: Readonly<Record<string, CatalogIntakeOperation>> = {
  'catalog.intake.discover': 'discover',
  'catalog.intake.select': 'select',
  'catalog.intake.confirm': 'confirm',
  'catalog.intake.cancel': 'cancel',
};
const MAX_BODY_BYTES = 64 * 1024;

const STATUS: Readonly<Record<AddErrorCode, number>> = {
  invalid_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  expired: 410,
  dependency_failure: 503,
  rate_limited: 429,
  unexpected_failure: 500,
};

function reply(value: unknown, status: number, header?: string, conversationId?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (header && conversationId) headers.set(header, conversationId);
  return new Response(JSON.stringify(value), { status, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? ''))
    throw new HttpError(400, 'The Add request body is invalid.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'The Add request is too large.');
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'input'))
      return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'The Add request body is invalid.');
}

async function run(
  env: Env,
  request: Request,
  operation: CatalogIntakeOperation,
  input: unknown,
  channel: 'web' | 'external_agent',
  serverConversationId: string,
): Promise<Response> {
  const header = channel === 'web' ? WEB_CONVERSATION_HEADER : AGENT_CONVERSATION_HEADER;
  // Later steps must name the conversation discover returned.
  if (operation !== 'discover' && request.headers.get(header) !== serverConversationId)
    return reply(
      { code: 'invalid_input', message: 'The catalog intake conversation is invalid.' },
      400,
    );
  try {
    const result = await executeCatalogIntake(createAddHarness(env), operation, input, {
      ownerId: 'owner',
      channel,
      conversationId: serverConversationId,
    });
    if (result.ok) return reply(result.value, 200, header, serverConversationId);
    const code = Object.hasOwn(STATUS, result.error.code)
      ? result.error.code
      : 'unexpected_failure';
    return reply(
      {
        code,
        message: result.error.message,
        ...(typeof result.error.retryable === 'boolean'
          ? { retryable: result.error.retryable }
          : {}),
      },
      STATUS[code],
      header,
      serverConversationId,
    );
  } catch {
    // Never log request input, credentials or arbitrary exception text.
    const reference = crypto.randomUUID();
    console.error('catalog_intake_request_failed', operation, reference);
    const response = reply(
      {
        code: 'unexpected_failure',
        message: 'The Add service encountered a server error. Please retry.',
        retryable: true,
      },
      500,
      header,
      serverConversationId,
    );
    response.headers.set('x-atlas-request-id', reference);
    return response;
  }
}

/** Owner web Add (cookie session). */
export async function ownerAddResponse(
  request: Request,
  env: Env,
  operation: string,
): Promise<Response> {
  if (!OPERATIONS.has(operation as CatalogIntakeOperation)) throw new HttpError(404, 'Not found.');
  const conversationId = await ownerWebConversationId(request, env);
  const { input } = await readBody(request);
  return run(env, request, operation as CatalogIntakeOperation, input, 'web', conversationId);
}

/** External Add Agent (Bearer token). It may not assert Owner-only fields on select. */
export async function agentAddResponse(request: Request, env: Env): Promise<Response> {
  const conversationId = await addAgentConversationId(request, env);
  const body = await readBody(request);
  const { input } = body;
  const operation =
    typeof body.operation === 'string' && Object.hasOwn(AGENT_OPERATIONS, body.operation)
      ? AGENT_OPERATIONS[body.operation]
      : undefined;
  if (
    Object.keys(body).some((key) => key !== 'input' && key !== 'operation') ||
    !operation ||
    (operation === 'select' &&
      input &&
      typeof input === 'object' &&
      ['ownerFields', 'tabelog', 'reservation'].some((key) => Object.hasOwn(input, key)))
  )
    throw new HttpError(400, 'The Add Agent request body is invalid.');
  return run(env, request, operation, input, 'external_agent', conversationId);
}

export const AGENT_CAPABILITIES = {
  service: 'Place Atlas',
  scope: 'Restaurants in Japan',
  externalAgentIntakeAuthentication: {
    type: 'bearer_token',
    endpoint: '/api/agent/catalog-intake',
    scope: 'catalog_intake_only',
    conversationHeader: AGENT_CONVERSATION_HEADER,
    instruction:
      'Send {operation,input} with the dedicated Add Agent token. Echo the conversation header from discover on select, confirm and cancel. Confirm only after reviewing the current preview and version.',
  },
  operations: [
    { operation: 'catalog.intake.discover', input: { query: 'string', requestToken: 'string' } },
    {
      operation: 'catalog.intake.select',
      input: {
        sessionId: 'string',
        expectedSessionVersion: 'number',
        ordinal: 'number',
        requestResearch: 'boolean?',
      },
    },
    {
      operation: 'catalog.intake.confirm',
      input: { sessionId: 'string', expectedPreviewVersion: 'number' },
    },
    {
      operation: 'catalog.intake.cancel',
      input: { sessionId: 'string', expectedSessionVersion: 'number' },
    },
  ],
} as const;

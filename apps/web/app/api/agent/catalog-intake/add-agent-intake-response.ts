import {
  authorizeAddAgent,
  type AddAgentSecrets,
} from '../../../../lib/server/auth/add-agent-token.ts';

import {
  catalogIntakeResponse,
  type CatalogIntakeHttpOperation,
} from '../../catalog-intake/catalog-intake-response.ts';

const maximumBodyBytes = 64 * 1024;
const conversationHeader = 'x-atlas-agent-conversation-id';
const operations = new Set<CatalogIntakeHttpOperation>([
  'catalog.intake.discover',
  'catalog.intake.select',
  'catalog.intake.confirm',
  'catalog.intake.cancel',
]);

export async function addAgentIntakeResponse(options: {
  readonly request: Request;
  readonly getApplication: () => unknown;
  readonly secrets: AddAgentSecrets;
}): Promise<Response> {
  const auth = await authorizeAddAgent(options.request, options.secrets);
  if (!auth.ok) return auth.response;

  const parsed = await readBody(options.request);
  if (!parsed.ok) return failure(parsed.status, parsed.message);
  return catalogIntakeResponse({
    getApplication: options.getApplication,
    request: options.request,
    operation: parsed.operation,
    parsedBody: { input: parsed.input },
    channel: 'external_agent',
    conversationHeader,
    serverConversationId: auth.conversationId,
  });
}

async function readBody(request: Request): Promise<
  | {
      readonly ok: true;
      readonly operation: CatalogIntakeHttpOperation;
      readonly input: unknown;
    }
  | { readonly ok: false; readonly status: 400 | 413; readonly message: string }
> {
  if (
    !/^application\/json(?:\s*;|$)/iu.test(
      request.headers.get('content-type') ?? '',
    )
  ) {
    return invalidBody();
  }
  const reader = request.body?.getReader();
  if (!reader) return invalidBody();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBodyBytes) {
        await reader.cancel();
        return {
          ok: false,
          status: 413,
          message: 'The Add Agent request is too large.',
        };
      }
      chunks.push(value);
    }
  } catch {
    return invalidBody();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Object.hasOwn(body, 'input') ||
      !Object.hasOwn(body, 'operation') ||
      Object.keys(body).some((key) => key !== 'input' && key !== 'operation')
    ) {
      return invalidBody();
    }
    const candidate = body as {
      readonly operation: unknown;
      readonly input: unknown;
    };
    if (
      typeof candidate.operation !== 'string' ||
      !operations.has(candidate.operation as CatalogIntakeHttpOperation)
    ) {
      return invalidBody();
    }
    const agentInput = candidate.input;
    if (
      candidate.operation === 'catalog.intake.select' &&
      isRecord(agentInput) &&
      ['ownerFields', 'tabelog', 'reservation'].some((key) =>
        Object.hasOwn(agentInput, key),
      )
    ) {
      return invalidBody();
    }
    return {
      ok: true,
      operation: candidate.operation as CatalogIntakeHttpOperation,
      input: candidate.input,
    };
  } catch {
    return invalidBody();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidBody() {
  return {
    ok: false as const,
    status: 400 as const,
    message: 'The Add Agent request body is invalid.',
  };
}

function failure(status: 400 | 413, message: string): Response {
  return new Response(JSON.stringify({ code: 'invalid_input', message }), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    },
  });
}

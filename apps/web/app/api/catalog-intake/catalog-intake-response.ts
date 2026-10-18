import type { ApplicationExecutionContext } from '../../../product/application/atlas-application.ts';
import type {
  AddError,
  AddErrorCode,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import type { Result } from '../../../product/application/result.ts';

export type CatalogIntakeHttpOperation =
  | 'catalog.intake.discover'
  | 'catalog.intake.select'
  | 'catalog.intake.confirm'
  | 'catalog.intake.cancel';

type IntakeExecute = (
  operation: {
    readonly key: CatalogIntakeHttpOperation;
    readonly input: unknown;
  },
  context: ApplicationExecutionContext,
) => Promise<Result<unknown, AddError>>;

export async function catalogIntakeResponse(options: {
  readonly application?: unknown;
  readonly getApplication?: () => unknown;
  readonly request: Request;
  readonly operation: CatalogIntakeHttpOperation;
  readonly serverConversationId?: string;
  readonly channel?: 'web' | 'external_agent';
  readonly conversationHeader?: string;
  readonly parsedBody?: { readonly input: unknown };
}): Promise<Response> {
  const conversationHeader =
    options.conversationHeader ?? webConversationHeader;
  const conversationName =
    options.channel === 'external_agent' ? 'Agent' : 'Web';
  const suppliedConversation = options.request.headers.get(conversationHeader);
  const serverConversationId = isConversationId(options.serverConversationId)
    ? options.serverConversationId
    : undefined;
  if (!serverConversationId) {
    return errorResponse(
      'unexpected_failure',
      `The ${conversationName} catalog intake conversation is unavailable.`,
      500,
      false,
    );
  }
  const conversationId =
    options.operation === 'catalog.intake.discover'
      ? serverConversationId
      : suppliedConversation === serverConversationId
        ? serverConversationId
        : undefined;
  if (!conversationId) {
    return errorResponse(
      'invalid_input',
      `The ${conversationName} catalog intake conversation is invalid.`,
      400,
    );
  }

  const input = options.parsedBody
    ? { ok: true as const, value: options.parsedBody.input }
    : await readInput(options.request);
  if (!input.ok) {
    return errorResponse(
      'invalid_input',
      'The catalog intake request body is invalid.',
      400,
      undefined,
      conversationId,
      conversationHeader,
    );
  }
  let result: Result<unknown, AddError>;
  try {
    const execute = readExecute(
      options.getApplication ? options.getApplication() : options.application,
    );
    if (!execute) throw new Error('unavailable_application');
    result = await execute(
      { key: options.operation, input: input.value },
      {
        invocation: {
          ownerId: 'owner',
          channel: options.channel ?? 'web',
          conversationId,
        },
      },
    );
  } catch {
    // Never log request input, credentials, or arbitrary exception text.
    const reference = crypto.randomUUID();
    console.error(
      'catalog_intake_request_failed',
      options.operation,
      reference,
    );
    const response = errorResponse(
      'unexpected_failure',
      'The Add service encountered a server error. Please retry.',
      500,
      true,
      conversationId,
      conversationHeader,
    );
    response.headers.set('x-atlas-request-id', reference);
    return response;
  }
  if (result.ok) {
    return jsonResponse(result.value, 200, conversationId, conversationHeader);
  }
  const code = isAddErrorCode(result.error.code)
    ? result.error.code
    : 'unexpected_failure';
  const message =
    typeof result.error.message === 'string'
      ? result.error.message
      : 'The catalog intake operation could not be completed.';
  return errorResponse(
    code,
    message,
    errorStatus[code],
    typeof result.error.retryable === 'boolean'
      ? result.error.retryable
      : undefined,
    conversationId,
    conversationHeader,
  );
}

const webConversationHeader = 'x-atlas-web-conversation-id';
const errorStatus: Readonly<Record<AddErrorCode, number>> = {
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

async function readInput(
  request: Request,
): Promise<
  { readonly ok: true; readonly value: unknown } | { readonly ok: false }
> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) && Object.hasOwn(value, 'input')
      ? { ok: true, value: value.input }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function readExecute(application: unknown): IntakeExecute | undefined {
  if (!isRecord(application) || typeof application.execute !== 'function') {
    return undefined;
  }
  return application.execute.bind(application) as IntakeExecute;
}

function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAddErrorCode(value: unknown): value is AddErrorCode {
  return typeof value === 'string' && Object.hasOwn(errorStatus, value);
}

function errorResponse(
  code: AddErrorCode,
  message: string,
  status: number,
  retryable?: boolean,
  conversationId?: string,
  conversationHeader = webConversationHeader,
): Response {
  return jsonResponse(
    { code, message, ...(retryable === undefined ? {} : { retryable }) },
    status,
    conversationId,
    conversationHeader,
  );
}

function jsonResponse(
  value: unknown,
  status: number,
  conversationId?: string,
  conversationHeader = webConversationHeader,
): Response {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
  if (conversationId) headers.set(conversationHeader, conversationId);
  return new Response(JSON.stringify(value), { status, headers });
}

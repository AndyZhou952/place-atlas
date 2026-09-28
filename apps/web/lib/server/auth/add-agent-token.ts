const encoder = new TextEncoder();
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/u;

export interface AddAgentSecrets {
  readonly ATLAS_ADD_AGENT_TOKEN?: string;
  readonly ATLAS_OWNER_SESSION_SECRET?: string;
}

export async function authorizeAddAgent(
  request: Request,
  secrets: AddAgentSecrets,
): Promise<
  | { readonly ok: true; readonly conversationId: string }
  | { readonly ok: false; readonly response: Response }
> {
  const configured = secrets.ATLAS_ADD_AGENT_TOKEN;
  const signingSecret = secrets.ATLAS_OWNER_SESSION_SECRET;
  if (
    !configured ||
    !tokenPattern.test(configured) ||
    !signingSecret ||
    signingSecret.length < 32
  ) {
    return { ok: false, response: rejected(503) };
  }

  const authorization = request.headers.get('authorization');
  const candidate = /^Bearer ([A-Za-z0-9_-]{32,128})$/u.exec(
    authorization ?? '',
  )?.[1];
  if (!candidate || request.headers.has('cookie')) {
    return { ok: false, response: rejected(401) };
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const expected = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(configured),
  );
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      expected,
      encoder.encode(candidate),
    ))
  ) {
    return { ok: false, response: rejected(401) };
  }
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`atlas:add-agent-conversation:v1:${candidate}`),
  );
  return {
    ok: true,
    conversationId: Array.from(new Uint8Array(signature).slice(0, 16), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  };
}

function rejected(status: 401 | 503): Response {
  return new Response(
    JSON.stringify({
      code: status === 401 ? 'unauthorized' : 'dependency_failure',
      message:
        status === 401
          ? 'Add Agent authentication is required.'
          : 'Add Agent authentication is unavailable.',
    }),
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
    },
  );
}

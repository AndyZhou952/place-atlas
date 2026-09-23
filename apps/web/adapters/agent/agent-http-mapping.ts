import type {
  AgentServiceResponse,
  AgentSignedRequest,
} from '../../product/application/conversation/agent-service-gateway.ts';

interface AgentServiceGateway {
  handle(request: AgentSignedRequest): Promise<AgentServiceResponse>;
}

export function createAgentHttpHandler(gateway: AgentServiceGateway) {
  return async (request: Request): Promise<Response> => {
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/api/agent/v1/tools' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    ) {
      return jsonResponse(400, {
        ok: false,
        error: {
          kind: 'invalid_input',
          message: 'The agent request is invalid.',
        },
      });
    }

    const headers: Record<string, string | undefined> = {};
    for (const name of [
      'x-atlas-key-id',
      'x-atlas-timestamp',
      'x-atlas-nonce',
      'x-atlas-signature',
    ]) {
      headers[name] = request.headers.get(name) ?? undefined;
    }
    const response = await gateway.handle({
      method: request.method,
      url: request.url,
      headers,
      body: new Uint8Array(await request.arrayBuffer()),
    });
    return jsonResponse(response.status, response.body);
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

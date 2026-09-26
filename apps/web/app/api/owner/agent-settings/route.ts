import { getOwnerAgentSettingsService as service } from '../../../../lib/server/application/owner-agent-settings-service.ts';
import { AgentConnectionError } from '../../../../lib/server/agent-settings.ts';
import {
  withOwnerReadAuth,
  withOwnerWriteAuth,
} from '../../../../lib/server/auth/owner-auth.ts';

export const dynamic = 'force-dynamic';
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = withOwnerReadAuth(async () => {
  try {
    return reply(await service().status());
  } catch {
    return reply(
      {
        error:
          'Settings are unavailable. Check the database migration and server encryption secret.',
      },
      503,
    );
  }
});

export const PUT = withOwnerWriteAuth(async (request: Request) => {
  try {
    if (!request.headers.get('content-type')?.includes('application/json'))
      return reply({ error: 'Send JSON settings.' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Provide settings.' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return reply({ error: 'Settings are too large.' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    return reply(await service().save(input));
  } catch (error) {
    if (error instanceof AgentConnectionError)
      return reply({ error: error.message }, 502);
    // Do not reflect provider keys, malformed input or storage diagnostics.
    return reply(
      {
        error:
          'Connection check or save failed. Check the supported base URL, model, key and provider credit, then retry. A new provider needs a new key; server credential encryption must be configured.',
      },
      400,
    );
  }
});

export const DELETE = withOwnerWriteAuth(async () => {
  try {
    return reply(await service().remove());
  } catch {
    return reply(
      { error: 'Could not remove saved settings. Please try again.' },
      503,
    );
  }
});

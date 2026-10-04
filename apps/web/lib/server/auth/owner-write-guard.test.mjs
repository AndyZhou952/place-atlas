import assert from 'node:assert/strict';
import test from 'node:test';

import { protectOwnerWrite } from './owner-write-guard.ts';

void test('an auth rejection returns before the protected write handler runs', async () => {
  let writes = 0;
  const protectedWrite = protectOwnerWrite(
    {
      async authorizeWrite() {
        return new Response('Owner login is required.', { status: 401 });
      },
    },
    async () => {
      writes += 1;
      return new Response('written');
    },
  );

  const response = await protectedWrite(
    new Request('https://atlas.example/api/journal', { method: 'POST' }),
  );

  assert.equal(response.status, 401);
  assert.equal(writes, 0);
});

void test('an authenticated request reaches the write handler with its route context', async () => {
  const context = { params: Promise.resolve({ id: 'visit-1' }) };
  const protectedWrite = protectOwnerWrite(
    {
      async authorizeWrite() {
        return undefined;
      },
    },
    async (_request, receivedContext) => {
      assert.equal(receivedContext, context);
      return Response.json({ written: true });
    },
  );

  const response = await protectedWrite(
    new Request('https://atlas.example/api/journal/visit-1', {
      method: 'PATCH',
    }),
    context,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { written: true });
});

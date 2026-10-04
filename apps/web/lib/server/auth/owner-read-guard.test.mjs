import assert from 'node:assert/strict';
import test from 'node:test';

import { protectOwnerRead } from './owner-read-guard.ts';

void test('an anonymous private GET is rejected before Application or D1 runs', async () => {
  let reads = 0;
  const protectedRead = protectOwnerRead(
    {
      async authorizeRead() {
        return new Response('Owner login is required.', { status: 401 });
      },
    },
    async () => {
      reads += 1;
      return Response.json([{ title: 'private candidate' }]);
    },
  );

  const response = await protectedRead(
    new Request('https://atlas.example/api/owner/catalog/review-candidates'),
  );

  assert.equal(response.status, 401);
  assert.equal(reads, 0);
  assert.doesNotMatch(await response.text(), /private candidate/u);
});

void test('an authenticated private GET reaches its handler', async () => {
  const protectedRead = protectOwnerRead(
    {
      async authorizeRead() {
        return undefined;
      },
    },
    async () => Response.json({ allowed: true }),
  );
  const response = await protectedRead(
    new Request('https://atlas.example/api/media'),
  );
  assert.deepEqual(await response.json(), { allowed: true });
});

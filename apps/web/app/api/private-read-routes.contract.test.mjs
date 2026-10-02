import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routePaths = [
  './nearby/route.ts',
  './media/route.ts',
  './google-rating-references/route.ts',
];

void test('non-public v1 GET routes are owner guarded before application composition', async () => {
  for (const routePath of routePaths) {
    const source = await readFile(new URL(routePath, import.meta.url), 'utf8');
    assert.match(source, /export const GET = withOwnerReadAuth/u, routePath);
    assert.doesNotMatch(source, /export async function GET/u, routePath);
    assert.ok(
      source.indexOf('withOwnerReadAuth(async function GET') <
        source.indexOf(
          'getServerAtlasApplication()',
          source.indexOf('export const GET'),
        ),
      `${routePath} must authorize before composing the application`,
    );
  }
});

void test('Google rating read is owner guarded before the provider service runs', async () => {
  const source = await readFile(
    new URL('./items/[id]/google-rating/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /export const GET = withOwnerReadAuth/u);
  assert.ok(
    source.indexOf('withOwnerReadAuth(async function GET') <
      source.indexOf('getSavedPlaceGoogleRating(id)'),
  );
});

void test('preview Google rating read is owner guarded and scoped to an owner conversation', async () => {
  const source = await readFile(
    new URL('./catalog-intake/google-rating/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /export const GET = withOwnerReadAuth/u);
  assert.match(source, /getOwnerWebConversationId\(request\)/u);
  assert.ok(
    source.indexOf('withOwnerReadAuth(async function GET') <
      source.indexOf('getPreviewGoogleRating(sessionId, conversationId)'),
  );
  assert.match(source, /private, no-store/u);
});

void test('saving a Google reference is owner guarded and uses the mutation coordinator', async () => {
  const source = await readFile(
    new URL('./items/[id]/google-rating-reference/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /export const POST = withOwnerWriteAuth/u);
  assert.ok(
    source.indexOf('withOwnerWriteAuth(async function POST') <
      source.indexOf('getServerInvocationCoordinator()'),
  );
  assert.match(source, /ownerMutationResponse/u);
  assert.match(source, /private, no-store/u);
  assert.doesNotMatch(
    source,
    /getSavedPlaceGoogleRating|createGooglePlaceRatingClient/u,
  );
});

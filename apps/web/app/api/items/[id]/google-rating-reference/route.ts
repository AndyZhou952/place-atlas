import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { ownerMutationResponse } from '../../../owner-mutation-response';
export const dynamic = 'force-dynamic';
export const POST = withOwnerWriteAuth(async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new Response('A valid reference is required.', { status: 400 });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return new Response('A valid reference is required.', { status: 400 });
  const response = await ownerMutationResponse({
    coordinator: getServerInvocationCoordinator(),
    request,
    operation: 'catalog.save_google_rating_reference',
    operationInput: { ...input, itemId: id },
    errors: {
      invalidInput: 'The rating, source, date and saved place must match.',
      notFound: 'Place not found.',
      dependencyFailure: 'The Google reference could not be saved.',
    },
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});

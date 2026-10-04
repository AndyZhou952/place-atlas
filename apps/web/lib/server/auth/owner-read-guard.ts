import type { OwnerAuth } from './owner-session.ts';

type OwnerReadAuthorizer = Pick<OwnerAuth, 'authorizeRead'>;

export function protectOwnerRead<Arguments extends readonly unknown[]>(
  authorizer: OwnerReadAuthorizer,
  handler: (
    request: Request,
    ...arguments_: Arguments
  ) => Promise<Response> | Response,
): (request: Request, ...arguments_: Arguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const rejected = await authorizer.authorizeRead(request);
    if (rejected) return rejected;
    return handler(request, ...arguments_);
  };
}

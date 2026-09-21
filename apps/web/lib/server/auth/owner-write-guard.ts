import type { OwnerAuth } from './owner-session.ts';

type OwnerWriteAuthorizer = Pick<OwnerAuth, 'authorizeWrite'>;

export function protectOwnerWrite<Arguments extends readonly unknown[]>(
  authorizer: OwnerWriteAuthorizer,
  handler: (
    request: Request,
    ...arguments_: Arguments
  ) => Promise<Response> | Response,
): (request: Request, ...arguments_: Arguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const rejected = await authorizer.authorizeWrite(request);
    if (rejected) return rejected;
    return handler(request, ...arguments_);
  };
}

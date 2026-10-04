export const applicationErrorKinds = [
  'invalid_input',
  'not_found',
  'conflict',
  'dependency_failure',
  'unexpected_failure',
] as const;

export type ApplicationErrorKind = (typeof applicationErrorKinds)[number];

export interface ApplicationError {
  readonly kind: ApplicationErrorKind;
  readonly message: string;
}

export type Result<T, Error extends ApplicationError = ApplicationError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export function success<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function failure(
  kind: ApplicationErrorKind,
  message: string,
): Result<never> {
  return { ok: false, error: { kind, message } };
}

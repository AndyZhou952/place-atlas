import { env } from 'cloudflare:workers';

import {
  createOwnerAuth,
  deriveOwnerWebConversationId,
  type OwnerAuthSecrets,
} from './owner-session.ts';
import { protectOwnerRead } from './owner-read-guard.ts';
import { protectOwnerWrite } from './owner-write-guard.ts';

type OwnerWriteHandler<Arguments extends readonly unknown[]> = (
  request: Request,
  ...arguments_: Arguments
) => Promise<Response> | Response;

export function ownerAuthStatusResponse(request: Request): Promise<Response> {
  return currentOwnerAuth().status(request);
}

export function ownerLoginResponse(request: Request): Promise<Response> {
  return currentOwnerAuth().login(request);
}

export function ownerLogoutResponse(request: Request): Promise<Response> {
  return currentOwnerAuth().logout(request);
}

export function authorizeOwnerRead(
  request: Request,
): Promise<Response | undefined> {
  return currentOwnerAuth().authorizeRead(request);
}

export function withOwnerReadAuth<Arguments extends readonly unknown[]>(
  handler: OwnerWriteHandler<Arguments>,
): OwnerWriteHandler<Arguments> {
  return async (request, ...arguments_) =>
    protectOwnerRead(currentOwnerAuth(), handler)(request, ...arguments_);
}

export function withOwnerWriteAuth<Arguments extends readonly unknown[]>(
  handler: OwnerWriteHandler<Arguments>,
): OwnerWriteHandler<Arguments> {
  return async (request, ...arguments_) =>
    protectOwnerWrite(currentOwnerAuth(), handler)(request, ...arguments_);
}

export function getOwnerWebConversationId(
  request: Request,
): Promise<string | undefined> {
  return deriveOwnerWebConversationId(request, currentOwnerSecrets());
}

function currentOwnerAuth() {
  return createOwnerAuth(currentOwnerSecrets());
}

function currentOwnerSecrets(): OwnerAuthSecrets {
  const bindings = env as unknown as OwnerAuthSecrets;
  return {
    ATLAS_OWNER_PASSWORD: bindings.ATLAS_OWNER_PASSWORD,
    ATLAS_OWNER_SESSION_SECRET: bindings.ATLAS_OWNER_SESSION_SECRET,
  };
}

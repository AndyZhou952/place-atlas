import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  type CatalogIntakeResearchAllowance,
  type OwnerReservationAssertion,
  type OwnerTabelogAssertion,
  validateOwnerReservation,
  validateOwnerTabelog,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';

const allowanceDomain = 'atlas-research-allowance:v1';
const allowanceAudience = 'atlas-research-relay';
const resultDomain = 'atlas-research-result:v2';
const resultAudience = 'atlas-owner-poc';

export interface ResearchRelayUsage {
  readonly searchQueries: number;
  readonly pageRequests: number;
  readonly elapsedMs: number;
  readonly maximumRedirectsFollowed: number;
}

export interface ResearchRelayProposal {
  readonly tabelog:
    | { readonly status: 'unknown' }
    | ({ readonly status: 'known' } & OwnerTabelogAssertion);
  readonly reservation:
    | { readonly status: 'unknown' }
    | ({ readonly status: 'known' } & OwnerReservationAssertion);
}

export type ResearchRelayResultOutcome =
  | {
      readonly kind: 'observed';
      readonly proposal: ResearchRelayProposal;
    }
  | { readonly kind: 'unavailable' };

interface SigningKey {
  readonly keyVersion: string;
  readonly secret: string;
}

export async function signResearchAllowance(input: {
  readonly allowance: CatalogIntakeResearchAllowance;
  readonly key: SigningKey;
  readonly now: Date;
}) {
  assertSigningKey(input.key);
  const allowance = validateAllowance(input.allowance);
  if (!allowance || Date.parse(allowance.deadline) <= input.now.getTime()) {
    throw new TypeError('Invalid research allowance.');
  }
  if (
    Date.parse(allowance.deadline) - input.now.getTime() >
    allowance.maxDurationMs
  ) {
    throw new TypeError('Invalid research allowance.');
  }
  const allowanceDigest = sha256(canonicalJson(allowance));
  const unsigned = {
    domain: allowanceDomain,
    audience: allowanceAudience,
    version: 1 as const,
    keyVersion: input.key.keyVersion,
    issuedAt: input.now.toISOString(),
    expiresAt: allowance.deadline,
    allowance,
    allowanceDigest,
  };
  return { ...unsigned, signature: sign(unsigned, input.key.secret) };
}

export async function verifyResearchAllowance(
  value: unknown,
  input: {
    readonly keys: Readonly<Record<string, string>>;
    readonly now: Date;
  },
): Promise<
  | {
      readonly allowance: CatalogIntakeResearchAllowance;
      readonly allowanceDigest: string;
    }
  | undefined
> {
  if (
    !isExactRecord(value, [
      'domain',
      'audience',
      'version',
      'keyVersion',
      'issuedAt',
      'expiresAt',
      'allowance',
      'allowanceDigest',
      'signature',
    ]) ||
    value.domain !== allowanceDomain ||
    value.audience !== allowanceAudience ||
    value.version !== 1 ||
    typeof value.keyVersion !== 'string' ||
    !isCanonicalActiveWindow(value.issuedAt, value.expiresAt, input.now) ||
    typeof value.allowanceDigest !== 'string' ||
    !isSha256(value.allowanceDigest) ||
    typeof value.signature !== 'string'
  ) {
    return undefined;
  }
  const secret = input.keys[value.keyVersion];
  if (!validSecret(secret)) return undefined;
  const allowance = validateAllowance(value.allowance);
  if (
    !allowance ||
    allowance.deadline !== value.expiresAt ||
    Date.parse(value.expiresAt as string) -
      Date.parse(value.issuedAt as string) >
      allowance.maxDurationMs ||
    sha256(canonicalJson(allowance)) !== value.allowanceDigest
  ) {
    return undefined;
  }
  const { signature, ...unsigned } = value;
  if (!verifySignature(unsigned, signature, secret)) return undefined;
  return { allowance, allowanceDigest: value.allowanceDigest };
}

export async function signResearchResult(input: {
  readonly requestId: string;
  readonly allowanceDigest: string;
  readonly outcome: ResearchRelayResultOutcome;
  readonly usage: ResearchRelayUsage;
  readonly expiresAt: string;
  readonly key: SigningKey;
  readonly now: Date;
}) {
  assertSigningKey(input.key);
  const outcome = normalizeResearchRelayResultOutcome(input.outcome);
  const usage = validateUsage(input.usage);
  if (
    !isBoundedText(input.requestId, 1, 200) ||
    !isSha256(input.allowanceDigest) ||
    !outcome ||
    !usage ||
    !isCanonicalTimestamp(input.expiresAt) ||
    Date.parse(input.expiresAt) <= input.now.getTime()
  ) {
    throw new TypeError('Invalid research result.');
  }
  const unsigned = {
    domain: resultDomain,
    audience: resultAudience,
    version: 2 as const,
    keyVersion: input.key.keyVersion,
    issuedAt: input.now.toISOString(),
    expiresAt: input.expiresAt,
    requestId: input.requestId,
    allowanceDigest: input.allowanceDigest,
    outcome,
    usage,
  };
  return { ...unsigned, signature: sign(unsigned, input.key.secret) };
}

export async function verifyResearchResult(
  value: unknown,
  input: {
    readonly keys: Readonly<Record<string, string>>;
    readonly now: Date;
    readonly allowance: CatalogIntakeResearchAllowance;
    readonly allowanceDigest: string;
  },
): Promise<
  | {
      readonly outcome: ResearchRelayResultOutcome;
      readonly usage: ResearchRelayUsage;
    }
  | undefined
> {
  if (
    !isExactRecord(value, [
      'domain',
      'audience',
      'version',
      'keyVersion',
      'issuedAt',
      'expiresAt',
      'requestId',
      'allowanceDigest',
      'outcome',
      'usage',
      'signature',
    ]) ||
    value.domain !== resultDomain ||
    value.audience !== resultAudience ||
    value.version !== 2 ||
    typeof value.keyVersion !== 'string' ||
    !isCanonicalActiveWindow(value.issuedAt, value.expiresAt, input.now) ||
    value.expiresAt !== input.allowance.deadline ||
    value.requestId !== input.allowance.requestId ||
    value.allowanceDigest !== input.allowanceDigest ||
    typeof value.signature !== 'string'
  ) {
    return undefined;
  }
  const secret = input.keys[value.keyVersion];
  if (!validSecret(secret)) return undefined;
  const outcome = normalizeResearchRelayResultOutcome(value.outcome);
  const usage = validateUsage(value.usage);
  if (
    !outcome ||
    !usage ||
    usage.searchQueries > input.allowance.maxCounts.searchQueries ||
    usage.pageRequests > input.allowance.maxCounts.pageRequests ||
    usage.elapsedMs > input.allowance.maxDurationMs ||
    usage.maximumRedirectsFollowed > input.allowance.maxRedirects
  ) {
    return undefined;
  }
  const { signature, ...unsigned } = value;
  if (!verifySignature(unsigned, signature, secret)) return undefined;
  return { outcome, usage };
}

export function normalizeResearchRelayResultOutcome(
  value: unknown,
): ResearchRelayResultOutcome | undefined {
  if (isExactRecord(value, ['kind']) && value.kind === 'unavailable') {
    return { kind: 'unavailable' };
  }
  if (isExactRecord(value, ['kind', 'proposal']) && value.kind === 'observed') {
    const proposal = normalizeResearchRelayProposal(value.proposal);
    return proposal ? { kind: 'observed', proposal } : undefined;
  }
  return undefined;
}

function validateAllowance(
  value: unknown,
): CatalogIntakeResearchAllowance | undefined {
  if (
    !isExactRecord(value, [
      'sessionId',
      'phase',
      'queryOrUrlsDigest',
      'maxCounts',
      'maxDurationMs',
      'requestTimeoutMs',
      'maxRedirects',
      'deadline',
      'requestId',
    ]) ||
    !isBoundedText(value.sessionId, 1, 200) ||
    (value.phase !== 'initial' && value.phase !== 'confirm') ||
    typeof value.queryOrUrlsDigest !== 'string' ||
    !isSha256(value.queryOrUrlsDigest) ||
    !isExactRecord(value.maxCounts, ['searchQueries', 'pageRequests']) ||
    !isNonNegativeInteger(value.maxCounts.searchQueries) ||
    !isNonNegativeInteger(value.maxCounts.pageRequests) ||
    !isNonNegativeInteger(value.maxDurationMs) ||
    value.requestTimeoutMs !== 15_000 ||
    value.maxRedirects !== 3 ||
    !isCanonicalTimestamp(value.deadline) ||
    !isBoundedText(value.requestId, 1, 200)
  ) {
    return undefined;
  }
  const expected =
    value.phase === 'initial'
      ? { searchQueries: 1, pageRequests: 3, maxDurationMs: 35_000 }
      : { searchQueries: 0, pageRequests: 2, maxDurationMs: 25_000 };
  if (
    value.maxCounts.searchQueries !== expected.searchQueries ||
    value.maxCounts.pageRequests !== expected.pageRequests ||
    value.maxDurationMs !== expected.maxDurationMs
  ) {
    return undefined;
  }
  return value as unknown as CatalogIntakeResearchAllowance;
}

export function normalizeResearchRelayProposal(
  value: unknown,
): ResearchRelayProposal | undefined {
  if (!isExactRecord(value, ['tabelog', 'reservation'])) return undefined;
  const tabelog = validateWireTabelog(value.tabelog);
  const reservation = validateWireReservation(value.reservation);
  return tabelog && reservation ? { tabelog, reservation } : undefined;
}

function validateWireTabelog(
  value: unknown,
): ResearchRelayProposal['tabelog'] | undefined {
  if (isExactRecord(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (!isRecord(value) || value.status !== 'known') return undefined;
  const { status: _status, ...assertionValue } = value;
  const assertion = validateOwnerTabelog(assertionValue);
  return assertion && assertion !== 'unknown'
    ? { status: 'known', ...assertion }
    : undefined;
}

function validateWireReservation(
  value: unknown,
): ResearchRelayProposal['reservation'] | undefined {
  if (isExactRecord(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (!isRecord(value) || value.status !== 'known') return undefined;
  const { status: _status, ...assertionValue } = value;
  const assertion = validateOwnerReservation(assertionValue);
  return assertion && assertion !== 'unknown'
    ? { status: 'known', ...assertion }
    : undefined;
}

function validateUsage(value: unknown): ResearchRelayUsage | undefined {
  if (
    !isExactRecord(value, [
      'searchQueries',
      'pageRequests',
      'elapsedMs',
      'maximumRedirectsFollowed',
    ]) ||
    !isNonNegativeInteger(value.searchQueries) ||
    !isNonNegativeInteger(value.pageRequests) ||
    !isNonNegativeInteger(value.elapsedMs) ||
    !isNonNegativeInteger(value.maximumRedirectsFollowed)
  ) {
    return undefined;
  }
  return value as unknown as ResearchRelayUsage;
}

function sign(value: unknown, secret: string): string {
  return createHmac('sha256', secret)
    .update(canonicalJson(value))
    .digest('hex');
}

function verifySignature(
  value: unknown,
  signature: string,
  secret: string,
): boolean {
  if (!isSha256(signature)) return false;
  const actual = Buffer.from(signature, 'hex');
  const expected = Buffer.from(sign(value, secret), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSigningKey(key: SigningKey): void {
  if (!isBoundedText(key.keyVersion, 1, 80) || !validSecret(key.secret)) {
    throw new TypeError('Research Relay signing key is unavailable.');
  }
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 32;
}

function isCanonicalActiveWindow(
  issuedAt: unknown,
  expiresAt: unknown,
  now: Date,
): issuedAt is string {
  return (
    isCanonicalTimestamp(issuedAt) &&
    isCanonicalTimestamp(expiresAt) &&
    Date.parse(issuedAt) <= now.getTime() &&
    Date.parse(expiresAt) > now.getTime() &&
    Date.parse(issuedAt) < Date.parse(expiresAt)
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimum &&
    value.length <= maximum &&
    !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

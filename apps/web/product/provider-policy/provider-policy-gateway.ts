export type ProviderFieldUse =
  | 'request'
  | 'chat'
  | 'prompt'
  | 'durable'
  | 'leaflet';

export type PolicyDecision = 'allow' | 'deny' | 'pending';

export type ProviderJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ProviderJsonValue[]
  | ProviderJsonObject;

export interface ProviderJsonObject {
  readonly [key: string]: ProviderJsonValue;
}

export interface ProviderFieldPolicy {
  readonly read: PolicyDecision;
  readonly request: PolicyDecision;
  readonly chat: PolicyDecision;
  readonly prompt: PolicyDecision;
  readonly durable: PolicyDecision;
  readonly leaflet: PolicyDecision;
}

export interface ProviderPolicy {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly providerId: string;
  readonly status: 'active' | 'disabled' | 'pending_review';
  readonly credentialScopes: readonly string[];
  readonly origins: readonly string[];
  readonly fields: Readonly<Record<string, ProviderFieldPolicy>>;
  readonly attribution: Readonly<
    Partial<
      Record<
        'chat' | 'leaflet',
        { readonly label: string; readonly url: string }
      >
    >
  >;
  readonly cache: {
    readonly crossRequest: PolicyDecision;
    readonly maximumTtlSeconds: number;
  };
  readonly limits: {
    readonly requests: number;
    readonly costUsd: number;
  };
}

export interface ProviderRequest {
  readonly providerId: string;
  readonly credentialScope: string;
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: ProviderJsonObject;
  readonly fields: readonly {
    readonly name: string;
    readonly use: ProviderFieldUse;
    readonly whenDenied?: 'reject' | 'unknown';
  }[];
  readonly cache: {
    readonly mode: 'request_only' | 'cross_request';
    readonly ttlSeconds?: number;
  };
  readonly estimatedCostUsd: number;
}

export interface ProviderTransportRequest {
  readonly providerId: string;
  readonly credentialScope: string;
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: ProviderJsonObject;
  readonly fields: readonly string[];
  readonly resolvedAddresses: readonly string[];
}

export interface ProviderTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface ProviderUsagePort {
  reserve(reservation: {
    readonly providerId: string;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: number;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

export interface ProviderAddressClassifier {
  normalizePublicUnicast(address: string): string | undefined;
}

export interface ProviderPolicyGatewayDependencies {
  readonly policies: readonly ProviderPolicy[];
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
  readonly addressClassifier: ProviderAddressClassifier;
  readonly usage: ProviderUsagePort;
  readonly transport: (
    request: ProviderTransportRequest,
  ) => Promise<ProviderTransportResponse>;
}

export type ProviderPolicyResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly providerId: string;
        readonly policyVersion: string;
        readonly sourceUrl: string;
        readonly fields: Readonly<Record<string, unknown>>;
        readonly attribution?: { readonly label: string; readonly url: string };
        readonly cache: { readonly mode: 'request_only' | 'cross_request' };
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly kind:
          | 'invalid_request'
          | 'policy_denied'
          | 'dependency_failure'
          | 'quota_exceeded'
          | 'cost_exceeded';
        readonly message: string;
      };
    };

export interface ProviderPolicyGateway {
  invoke(request: ProviderRequest): Promise<ProviderPolicyResult>;
}

export function createProviderPolicyGateway(
  dependencies: ProviderPolicyGatewayDependencies,
): ProviderPolicyGateway {
  return {
    async invoke(request) {
      if (!isValidProviderRequest(request)) {
        return invalid('Provider request is invalid.');
      }
      const policy = dependencies.policies.find(
        (candidate) => candidate.providerId === request.providerId,
      );
      if (!policy || policy.status !== 'active') {
        return denied('Provider policy is not active.');
      }
      if (!policy.credentialScopes.includes(request.credentialScope)) {
        return denied('Provider credential scope is not allowed.');
      }

      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return invalid('Provider request URL is invalid.');
      }
      if (!isAllowedDestination(policy, url)) {
        return denied('Provider destination is not allowed.');
      }

      const approvedFields: (typeof request.fields)[number][] = [];
      const unknownFields: (typeof request.fields)[number][] = [];
      for (const field of request.fields) {
        const fieldPolicy = policy.fields[field.name];
        if (!fieldPolicy) {
          return denied('Provider field use is not allowed.');
        }
        if (
          fieldPolicy.read === 'allow' &&
          fieldPolicy[field.use] === 'allow'
        ) {
          approvedFields.push(field);
        } else if (field.use === 'chat' && field.whenDenied === 'unknown') {
          unknownFields.push(field);
        } else {
          return denied('Provider field use is not allowed.');
        }
      }

      if (
        request.cache.mode === 'cross_request' &&
        (policy.cache.crossRequest !== 'allow' ||
          typeof request.cache.ttlSeconds !== 'number' ||
          request.cache.ttlSeconds > policy.cache.maximumTtlSeconds)
      ) {
        return denied('Provider cache policy does not allow this request.');
      }

      const attribution = request.fields.some((field) => field.use === 'chat')
        ? policy.attribution.chat
        : undefined;
      if (
        request.fields.some((field) => field.use === 'chat') &&
        !attribution
      ) {
        return denied('Required provider attribution is unavailable.');
      }

      try {
        for (let redirectCount = 0; ; redirectCount += 1) {
          const resolvedAddresses = await dependencies.resolve(url.hostname);
          const addresses: string[] = [];
          for (const resolvedAddress of resolvedAddresses) {
            const address =
              dependencies.addressClassifier.normalizePublicUnicast(
                resolvedAddress,
              );
            if (!address) {
              return denied('Provider destination is not public.');
            }
            addresses.push(address);
          }
          if (addresses.length === 0) {
            return denied('Provider destination is not public.');
          }
          const reservation = await dependencies.usage.reserve({
            providerId: policy.providerId,
            requests: 1,
            costUsd: request.estimatedCostUsd,
            hardRequestLimit: policy.limits.requests,
            hardCostLimitUsd: policy.limits.costUsd,
          });
          if (reservation === 'quota_exceeded') {
            return quotaDenied();
          }
          if (reservation === 'cost_exceeded') {
            return costDenied();
          }
          const response = await dependencies.transport({
            providerId: policy.providerId,
            credentialScope: request.credentialScope,
            url: url.href,
            method: request.method,
            ...(request.body ? { body: request.body } : {}),
            fields: approvedFields.map(({ name }) => name),
            resolvedAddresses: addresses,
          });

          if (isRedirect(response.status)) {
            if (redirectCount >= 5) return dependencyFailure();
            if (
              request.method === 'POST' &&
              [301, 302, 303].includes(response.status)
            ) {
              return denied('Provider redirect cannot change request method.');
            }
            const location = readHeader(response.headers, 'location');
            if (!location) return dependencyFailure();
            try {
              url = new URL(location, url);
            } catch {
              return dependencyFailure();
            }
            if (!isAllowedDestination(policy, url)) {
              return denied('Provider destination is not allowed.');
            }
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            return dependencyFailure();
          }

          return {
            ok: true,
            value: {
              providerId: policy.providerId,
              policyVersion: policy.policyVersion,
              sourceUrl: url.href,
              fields: Object.fromEntries([
                ...approvedFields.map(({ name }) => [
                  name,
                  response.body[name],
                ]),
                ...unknownFields.map(({ name }) => [
                  name,
                  { status: 'unknown', reason: 'not_permitted' },
                ]),
              ]),
              ...(attribution ? { attribution } : {}),
              cache: { mode: request.cache.mode },
            },
          };
        }
      } catch {
        return dependencyFailure();
      }
    },
  };
}

function isAllowedDestination(policy: ProviderPolicy, url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    !isMetadataHostname(url.hostname) &&
    policy.origins.includes(url.origin)
  );
}

function isMetadataHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata.aws.internal' ||
    normalized === 'instance-data.ec2.internal'
  );
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function readHeader(
  headers: Readonly<Record<string, string>>,
  expectedName: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName,
  );
  return entry?.[1];
}

function isValidProviderRequest(request: ProviderRequest): boolean {
  if (
    typeof request.providerId !== 'string' ||
    request.providerId.length === 0 ||
    typeof request.credentialScope !== 'string' ||
    request.credentialScope.length === 0 ||
    typeof request.url !== 'string' ||
    (request.method !== 'GET' && request.method !== 'POST') ||
    (request.method === 'GET' && request.body !== undefined) ||
    (request.method === 'POST' &&
      (request.body === undefined || !isSafeProviderBody(request.body))) ||
    !Number.isFinite(request.estimatedCostUsd) ||
    request.estimatedCostUsd < 0 ||
    !Array.isArray(request.fields) ||
    request.fields.length === 0 ||
    !request.cache ||
    (request.cache.mode !== 'request_only' &&
      request.cache.mode !== 'cross_request')
  ) {
    return false;
  }
  if (
    request.cache.mode === 'request_only' &&
    request.cache.ttlSeconds !== undefined
  ) {
    return false;
  }
  if (
    request.cache.mode === 'cross_request' &&
    (typeof request.cache.ttlSeconds !== 'number' ||
      !Number.isInteger(request.cache.ttlSeconds) ||
      request.cache.ttlSeconds <= 0)
  ) {
    return false;
  }

  const names = new Set<string>();
  const validUses: readonly ProviderFieldUse[] = [
    'request',
    'chat',
    'prompt',
    'durable',
    'leaflet',
  ];
  for (const field of request.fields) {
    if (
      typeof field.name !== 'string' ||
      field.name.length === 0 ||
      !validUses.includes(field.use) ||
      (field.whenDenied !== undefined &&
        field.whenDenied !== 'reject' &&
        field.whenDenied !== 'unknown') ||
      names.has(field.name)
    ) {
      return false;
    }
    names.add(field.name);
  }
  return true;
}

function isSafeProviderBody(value: unknown): value is ProviderJsonObject {
  return isJsonObject(value) && isSafeJsonValue(value, new WeakSet<object>());
}

function isSafeJsonValue(value: unknown, seen: WeakSet<object>): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    const valid = value.every((entry) => isSafeJsonValue(entry, seen));
    seen.delete(value);
    return valid;
  }
  if (!isJsonObject(value)) return false;

  const forbiddenKeys = new Set([
    'apikey',
    'authorization',
    'credential',
    'credentials',
    'key',
    'password',
    'secret',
    'token',
  ]);
  const valid = Object.entries(value).every(
    ([key, entry]) =>
      !forbiddenKeys.has(key.toLowerCase().replace(/[-_.]/gu, '')) &&
      isSafeJsonValue(entry, seen),
  );
  seen.delete(value);
  return valid;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): ProviderPolicyResult {
  return { ok: false, error: { kind: 'invalid_request', message } };
}

function denied(message: string): ProviderPolicyResult {
  return { ok: false, error: { kind: 'policy_denied', message } };
}

function dependencyFailure(): ProviderPolicyResult {
  return {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Provider request is temporarily unavailable.',
    },
  };
}

function quotaDenied(): ProviderPolicyResult {
  return {
    ok: false,
    error: {
      kind: 'quota_exceeded',
      message: 'Provider request budget is unavailable.',
    },
  };
}

function costDenied(): ProviderPolicyResult {
  return {
    ok: false,
    error: {
      kind: 'cost_exceeded',
      message: 'Provider cost budget is unavailable.',
    },
  };
}

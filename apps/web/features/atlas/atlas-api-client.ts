import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  NewImportJob,
  NewVisit,
  PlaceAssessmentPatch,
  VisitCreateResult,
  VisitMediaRecord,
  VisitMutationResult,
  VisitRecord,
  VisitUpdate,
} from './model';
import {
  chunkMediaSelection,
  maxMediaFilesPerSelection,
} from './media-constraints.ts';
import {
  browserOperationHttpCatalog,
  browserOperationPath,
  type BrowserOperationKey,
} from './atlas-browser-operation-catalog.ts';
import {
  loadPublicCatalog,
  loadPublicMedia,
  loadPublicVisits,
} from './public-read-client.ts';
import { publishOwnerLoginRequired } from './owner-session-client.ts';
import type { NearbyRecommendResult } from '../../product/application/decision/agent-nearby-operation.ts';
import type {
  AddErrorCode,
  CatalogIntakeCancelInput,
  CatalogIntakeCancelOutput,
  CatalogIntakeConfirmInput,
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverInput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakeSelectInput,
  CatalogIntakeSelectOutput,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';

export interface BrowserTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
}

interface BrowserOperationMap {
  readonly 'catalog.list': {
    readonly input: { readonly profile: 'full_merged_catalog' };
    readonly output: readonly AtlasItem[];
  };
  readonly 'assessment.update': {
    readonly input: {
      readonly itemId: string;
      readonly patch: Omit<PlaceAssessmentPatch, 'hasVisited'> & {
        readonly manualVisited?: boolean;
      };
    };
    readonly output: AtlasItem;
  };
  readonly 'catalog.update_item': {
    readonly input: AtlasItemEdit & { readonly id: string };
    readonly output: AtlasItem;
  };
  readonly 'catalog.delete_item': {
    readonly input: { readonly id: string };
    readonly output: { readonly id: string; readonly deleted: true };
  };
  readonly 'import.list': {
    readonly input: Readonly<Record<string, never>>;
    readonly output: readonly ImportJob[];
  };
  readonly 'import.queue': {
    readonly input: NewImportJob;
    readonly output: ImportJob;
  };
  readonly 'visit.list': {
    readonly input: Readonly<Record<string, never>>;
    readonly output: readonly VisitRecord[];
  };
  readonly 'visit.create': {
    readonly input: NewVisit;
    readonly output: VisitCreateResult;
  };
  readonly 'visit.update': {
    readonly input: VisitUpdate & { readonly id: string };
    readonly output: VisitMutationResult;
  };
  readonly 'visit.delete': {
    readonly input: { readonly id: string };
    readonly output: VisitMutationResult;
  };
  readonly 'media.list': {
    readonly input: {
      readonly visitId?: string;
      readonly itemId?: string;
    };
    readonly output: readonly VisitMediaRecord[];
  };
  readonly 'media.attach': {
    readonly input: {
      readonly visitId: string;
      readonly files: readonly File[];
      readonly uploadIds: readonly string[];
      readonly captions?: readonly string[];
      readonly onBatchCompleted?: (media: readonly VisitMediaRecord[]) => void;
    };
    readonly output: readonly VisitMediaRecord[];
  };
  readonly 'media.caption': {
    readonly input: {
      readonly id: string;
      readonly caption?: string | null;
    };
    readonly output: VisitMediaRecord;
  };
  readonly 'media.delete': {
    readonly input: { readonly id: string };
    readonly output: { readonly deleted: true };
  };
  readonly 'decision.nearby': {
    readonly input: {
      readonly latitude: number;
      readonly longitude: number;
      readonly limit: number;
      readonly profile?: 'verified_catalog' | 'full_merged_catalog';
    };
    readonly output: readonly {
      readonly id: string;
      readonly title: string;
      readonly kind: AtlasItem['kind'];
      readonly area: string;
      readonly distanceKm: number;
    }[];
  };
  readonly 'nearby.recommend': {
    readonly input: { readonly locationHint: string };
    readonly output: NearbyRecommendResult;
  };
  readonly 'catalog.intake.discover': {
    readonly input: CatalogIntakeDiscoverInput;
    readonly output: CatalogIntakeDiscoverOutput;
  };
  readonly 'catalog.intake.select': {
    readonly input: CatalogIntakeSelectInput;
    readonly output: CatalogIntakeSelectOutput;
  };
  readonly 'catalog.intake.confirm': {
    readonly input: CatalogIntakeConfirmInput;
    readonly output: CatalogIntakeConfirmOutput;
  };
  readonly 'catalog.intake.cancel': {
    readonly input: CatalogIntakeCancelInput;
    readonly output: CatalogIntakeCancelOutput;
  };
}

type BrowserOperationInput<Key extends BrowserOperationKey> =
  BrowserOperationMap[Key]['input'];
type BrowserOperationOutput<Key extends BrowserOperationKey> =
  BrowserOperationMap[Key]['output'];

export interface BrowserAtlasApplication {
  execute<Key extends BrowserOperationKey>(operation: {
    readonly key: Key;
    readonly input: BrowserOperationInput<Key>;
    readonly mutationId?: string;
  }): Promise<BrowserOperationOutput<Key>>;
}

export interface WebConversationStore {
  read(): string | undefined;
  write(value: string): void;
}

export class CatalogIntakeRequestError extends Error {
  readonly code: AddErrorCode;
  readonly retryable?: boolean;

  constructor(code: AddErrorCode, message: string, retryable?: boolean) {
    super(message);
    Object.defineProperty(this, 'name', {
      configurable: true,
      value: 'CatalogIntakeRequestError',
    });
    this.code = code;
    if (retryable !== undefined) this.retryable = retryable;
  }
}

type BrowserOperationHandlers = {
  readonly [Key in BrowserOperationKey]: (
    input: BrowserOperationInput<Key>,
    mutationId?: string,
  ) => Promise<BrowserOperationOutput<Key>>;
};

const fetchBrowserTransport: BrowserTransport = {
  request: (url, init) => fetch(url, init),
};

export function createBrowserAtlasApplication(
  transport: BrowserTransport = fetchBrowserTransport,
  conversationStore: WebConversationStore = defaultBrowserConversationStore(),
): BrowserAtlasApplication {
  const handlers: BrowserOperationHandlers = {
    'catalog.list': () => loadPublicCatalog(transport),
    'assessment.update': ({ itemId, patch }, mutationId) => {
      const { manualVisited, ...rest } = patch;
      return requestMutationJson<{
        readonly item: AtlasItem;
      }>(
        transport,
        browserOperationPath('assessment.update', { id: itemId }),
        mutationId,
        {
          method: browserOperationHttpCatalog['assessment.update'].method,
          body: JSON.stringify({
            ...rest,
            ...(manualVisited === undefined
              ? {}
              : { hasVisited: manualVisited }),
          }),
        },
      ).then(({ item }) => item);
    },
    'catalog.update_item': ({ id, ...edit }) =>
      requestJson(
        transport,
        browserOperationPath('catalog.update_item', { id }),
        {
          method: browserOperationHttpCatalog['catalog.update_item'].method,
          body: JSON.stringify(edit),
        },
      ),
    'catalog.delete_item': ({ id }) =>
      requestJson(
        transport,
        browserOperationPath('catalog.delete_item', { id }),
        {
          method: browserOperationHttpCatalog['catalog.delete_item'].method,
        },
      ),
    'import.list': () =>
      requestJson(transport, browserOperationPath('import.list')),
    'import.queue': (input) =>
      requestJson(transport, browserOperationPath('import.queue'), {
        method: browserOperationHttpCatalog['import.queue'].method,
        body: JSON.stringify(input),
      }),
    'visit.list': () => loadPublicVisits(transport),
    'visit.create': (input, mutationId) =>
      requestMutationJson(
        transport,
        browserOperationPath('visit.create'),
        mutationId,
        {
          method: browserOperationHttpCatalog['visit.create'].method,
          body: JSON.stringify(input),
        },
      ),
    'visit.update': ({ id, ...input }, mutationId) =>
      requestMutationJson(
        transport,
        browserOperationPath('visit.update', { id }),
        mutationId,
        {
          method: browserOperationHttpCatalog['visit.update'].method,
          body: JSON.stringify(input),
        },
      ),
    'visit.delete': ({ id }, mutationId) =>
      requestMutationJson(
        transport,
        browserOperationPath('visit.delete', { id }),
        mutationId,
        {
          method: browserOperationHttpCatalog['visit.delete'].method,
        },
      ),
    'media.list': (input) => loadPublicMedia(transport, input),
    'media.attach': (
      { visitId, files, uploadIds, captions = [], onBatchCompleted },
      mutationId,
    ) =>
      uploadVisitMediaInBatches(
        transport,
        visitId,
        files,
        uploadIds,
        captions,
        mutationId,
        onBatchCompleted,
      ),
    'media.caption': ({ id, caption }, mutationId) =>
      requestMutationJson(
        transport,
        browserOperationPath('media.caption', { id }),
        mutationId,
        {
          method: browserOperationHttpCatalog['media.caption'].method,
          body: JSON.stringify({ caption: caption || null }),
        },
      ),
    'media.delete': ({ id }, mutationId) =>
      requestMutationJson(
        transport,
        browserOperationPath('media.delete', { id }),
        mutationId,
        {
          method: browserOperationHttpCatalog['media.delete'].method,
        },
      ),
    'decision.nearby': ({ latitude, longitude, limit, profile }) => {
      const search = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        limit: String(limit),
      });
      if (profile) search.set('profile', profile);
      return requestJson(
        transport,
        `${browserOperationPath('decision.nearby')}?${search.toString()}`,
      );
    },
    'nearby.recommend': ({ locationHint }) => {
      const search = new URLSearchParams({ locationHint });
      return requestJson(
        transport,
        `${browserOperationPath('nearby.recommend')}?${search.toString()}`,
      );
    },
    'catalog.intake.discover': (input) =>
      requestCatalogIntakeJson(
        transport,
        conversationStore,
        'catalog.intake.discover',
        input,
      ),
    'catalog.intake.select': (input) =>
      requestCatalogIntakeJson(
        transport,
        conversationStore,
        'catalog.intake.select',
        input,
      ),
    'catalog.intake.confirm': (input) =>
      requestCatalogIntakeJson(
        transport,
        conversationStore,
        'catalog.intake.confirm',
        input,
      ),
    'catalog.intake.cancel': (input) =>
      requestCatalogIntakeJson(
        transport,
        conversationStore,
        'catalog.intake.cancel',
        input,
      ),
  };

  return {
    execute: (operation) =>
      handlers[operation.key](operation.input, operation.mutationId),
  };
}

async function requestMutationJson<T>(
  transport: BrowserTransport,
  url: string,
  mutationId: string | undefined,
  init: RequestInit,
): Promise<T> {
  const stableMutationId = mutationId ?? crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set('x-atlas-mutation-id', stableMutationId);
  const receipt = await requestJson<{
    readonly mutationId: string;
    readonly payloadDigest: string;
    readonly result: T;
    readonly replayed: boolean;
  }>(transport, url, { ...init, headers });
  if (
    receipt.mutationId !== stableMutationId ||
    !/^[a-f0-9]{64}$/u.test(receipt.payloadDigest) ||
    typeof receipt.replayed !== 'boolean'
  ) {
    throw new Error('The mutation receipt was invalid.');
  }
  return receipt.result;
}

export const browserAtlasApplication = createBrowserAtlasApplication();

const conversationHeader = 'x-atlas-web-conversation-id';
const conversationStorageKey = 'atlas.catalog-intake.conversation-v1';

function defaultBrowserConversationStore(): WebConversationStore {
  return {
    read() {
      try {
        const value =
          typeof window === 'undefined'
            ? undefined
            : (window.sessionStorage.getItem(conversationStorageKey) ??
              undefined);
        return isConversationId(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    write(value) {
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(conversationStorageKey, value);
        }
      } catch {
        // A blocked sessionStorage must not widen the API or leak identity.
      }
    },
  };
}

async function requestCatalogIntakeJson<
  Key extends
    | 'catalog.intake.discover'
    | 'catalog.intake.select'
    | 'catalog.intake.confirm'
    | 'catalog.intake.cancel',
>(
  transport: BrowserTransport,
  conversationStore: WebConversationStore,
  key: Key,
  input: BrowserOperationInput<Key>,
): Promise<BrowserOperationOutput<Key>> {
  const headers = new Headers({ 'content-type': 'application/json' });
  const existingConversation = conversationStore.read();
  if (isConversationId(existingConversation)) {
    headers.set(conversationHeader, existingConversation);
  }
  const response = await transport.request(browserOperationPath(key), {
    method: browserOperationHttpCatalog[key].method,
    headers,
    body: JSON.stringify({ input }),
  });
  const responseConversation = response.headers.get(conversationHeader);
  if (response.ok && !isConversationId(responseConversation)) {
    throw new CatalogIntakeRequestError(
      'unexpected_failure',
      'The catalog intake conversation response was invalid.',
      false,
    );
  }
  if (isConversationId(responseConversation)) {
    conversationStore.write(responseConversation);
  }
  if (!response.ok) {
    if (response.status === 401) publishOwnerLoginRequired();
    const error = await readCatalogIntakeError(response);
    throw new CatalogIntakeRequestError(
      error.code,
      error.message,
      error.retryable,
    );
  }
  return (await response.json()) as BrowserOperationOutput<Key>;
}

async function readCatalogIntakeError(response: Response): Promise<{
  readonly code: AddErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
}> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  if (
    isRecord(value) &&
    isAddErrorCode(value.code) &&
    typeof value.message === 'string' &&
    (value.retryable === undefined || typeof value.retryable === 'boolean')
  ) {
    return {
      code: value.code,
      message: value.message,
      ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
    };
  }
  return {
    code: 'unexpected_failure',
    message: 'The catalog intake request could not be completed.',
    retryable: response.status >= 500,
  };
}

function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAddErrorCode(value: unknown): value is AddErrorCode {
  return (
    typeof value === 'string' &&
    [
      'invalid_input',
      'unauthorized',
      'forbidden',
      'not_found',
      'conflict',
      'expired',
      'dependency_failure',
      'rate_limited',
      'unexpected_failure',
    ].includes(value)
  );
}

async function requestJson<T>(
  transport: BrowserTransport,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  const response = await transport.request(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 401 && isUnsafeMethod(init?.method)) {
      publishOwnerLoginRequired();
    }
    throw new Error(message || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function isUnsafeMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
    method?.toUpperCase() ?? '',
  );
}

async function uploadVisitMediaInBatches(
  transport: BrowserTransport,
  visitId: string,
  files: readonly File[],
  uploadIds: readonly string[],
  captions: readonly string[],
  mutationId: string | undefined,
  onBatchCompleted?: (media: readonly VisitMediaRecord[]) => void,
): Promise<VisitMediaRecord[]> {
  if (files.length > maxMediaFilesPerSelection) {
    throw new TypeError(
      `Select no more than ${maxMediaFilesPerSelection} photos at once. You can add another batch afterward.`,
    );
  }
  if (uploadIds.length !== files.length) {
    throw new TypeError('A stable ID is required for every image.');
  }

  const uploaded: VisitMediaRecord[] = [];
  let offset = 0;
  for (const chunk of chunkMediaSelection(files)) {
    const body = new FormData();
    body.set('visitId', visitId);
    chunk.forEach((file, index) => {
      body.append('files', file);
      body.append('ids', uploadIds[offset + index]);
      body.append('captions', captions[offset + index] ?? '');
    });
    const completed = await requestMutationJson<VisitMediaRecord[]>(
      transport,
      browserOperationPath('media.attach'),
      `${mutationId ?? crypto.randomUUID()}:${offset}`,
      {
        method: browserOperationHttpCatalog['media.attach'].method,
        body,
      },
    );
    uploaded.push(...completed);
    onBatchCompleted?.(completed);
    offset += chunk.length;
  }
  return uploaded;
}

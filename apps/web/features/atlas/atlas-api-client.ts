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

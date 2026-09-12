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
  }): Promise<BrowserOperationOutput<Key>>;
}

type BrowserOperationHandlers = {
  readonly [Key in BrowserOperationKey]: (
    input: BrowserOperationInput<Key>,
  ) => Promise<BrowserOperationOutput<Key>>;
};

const fetchBrowserTransport: BrowserTransport = {
  request: (url, init) => fetch(url, init),
};

export function createBrowserAtlasApplication(
  transport: BrowserTransport = fetchBrowserTransport,
): BrowserAtlasApplication {
  const handlers: BrowserOperationHandlers = {
    'catalog.list': () =>
      requestJson(transport, browserOperationPath('catalog.list')),
    'assessment.update': ({ itemId, patch }) => {
      const { manualVisited, ...rest } = patch;
      return requestJson(
        transport,
        browserOperationPath('assessment.update', { id: itemId }),
        {
          method: browserOperationHttpCatalog['assessment.update'].method,
          body: JSON.stringify({
            ...rest,
            ...(manualVisited === undefined
              ? {}
              : { hasVisited: manualVisited }),
          }),
        },
      );
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
    'visit.list': () =>
      requestJson(transport, browserOperationPath('visit.list')),
    'visit.create': (input) =>
      requestJson(transport, browserOperationPath('visit.create'), {
        method: browserOperationHttpCatalog['visit.create'].method,
        body: JSON.stringify(input),
      }),
    'visit.update': ({ id, ...input }) =>
      requestJson(transport, browserOperationPath('visit.update', { id }), {
        method: browserOperationHttpCatalog['visit.update'].method,
        body: JSON.stringify(input),
      }),
    'visit.delete': ({ id }) =>
      requestJson(transport, browserOperationPath('visit.delete', { id }), {
        method: browserOperationHttpCatalog['visit.delete'].method,
      }),
    'media.list': (input) => {
      const search = new URLSearchParams();
      if (input.visitId) search.set('visitId', input.visitId);
      if (input.itemId) search.set('itemId', input.itemId);
      const query = search.size ? `?${search.toString()}` : '';
      return requestJson(
        transport,
        `${browserOperationPath('media.list')}${query}`,
      );
    },
    'media.attach': ({ visitId, files, captions = [], onBatchCompleted }) =>
      uploadVisitMediaInBatches(
        transport,
        visitId,
        files,
        captions,
        onBatchCompleted,
      ),
    'media.caption': ({ id, caption }) =>
      requestJson(transport, browserOperationPath('media.caption', { id }), {
        method: browserOperationHttpCatalog['media.caption'].method,
        body: JSON.stringify({ caption: caption || null }),
      }),
    'media.delete': ({ id }) =>
      requestJson(transport, browserOperationPath('media.delete', { id }), {
        method: browserOperationHttpCatalog['media.delete'].method,
      }),
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
    execute: (operation) => handlers[operation.key](operation.input),
  };
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
    throw new Error(message || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

async function uploadVisitMediaInBatches(
  transport: BrowserTransport,
  visitId: string,
  files: readonly File[],
  captions: readonly string[],
  onBatchCompleted?: (media: readonly VisitMediaRecord[]) => void,
): Promise<VisitMediaRecord[]> {
  if (files.length > maxMediaFilesPerSelection) {
    throw new TypeError(
      `Select no more than ${maxMediaFilesPerSelection} photos at once. You can add another batch afterward.`,
    );
  }

  const uploaded: VisitMediaRecord[] = [];
  let offset = 0;
  for (const chunk of chunkMediaSelection(files)) {
    const body = new FormData();
    body.set('visitId', visitId);
    chunk.forEach((file, index) => {
      body.append('files', file);
      body.append('captions', captions[offset + index] ?? '');
    });
    const completed = await requestJson<VisitMediaRecord[]>(
      transport,
      browserOperationPath('media.attach'),
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

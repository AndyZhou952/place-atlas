export type BrowserHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface AgentCapability {
  readonly name: string;
  readonly pathSuffix?: string;
  readonly contentType?: string;
  readonly contract?: Readonly<Record<string, unknown>>;
}

interface BrowserOperationHttpDescriptor {
  readonly key: string;
  readonly method: BrowserHttpMethod;
  readonly path: string;
  readonly bodyKind: 'none' | 'json' | 'multipart';
  readonly capability?: AgentCapability;
}

function defineBrowserOperationHttpCatalog<
  const Catalog extends Readonly<
    Record<string, BrowserOperationHttpDescriptor>
  >,
>(catalog: Catalog): Catalog {
  return catalog;
}

export const browserOperationHttpCatalog = defineBrowserOperationHttpCatalog({
  'catalog.list': {
    key: 'catalog.list',
    method: 'GET',
    path: '/api/items',
    bodyKind: 'none',
    capability: { name: 'list_atlas_items' },
  },
  'catalog.review_candidates.list': {
    key: 'catalog.review_candidates.list',
    method: 'GET',
    path: '/api/owner/catalog/review-candidates',
    bodyKind: 'none',
  },
  'decision.nearby': {
    key: 'decision.nearby',
    method: 'GET',
    path: '/api/nearby',
    bodyKind: 'none',
    capability: {
      name: 'find_nearby',
      pathSuffix: '?lat={lat}&lon={lon}',
    },
  },
  'nearby.recommend': {
    key: 'nearby.recommend',
    method: 'GET',
    path: '/api/nearby',
    bodyKind: 'none',
  },
  'catalog.intake.discover': {
    key: 'catalog.intake.discover',
    method: 'POST',
    path: '/api/catalog-intake/discover',
    bodyKind: 'json',
    capability: {
      name: 'discover_restaurant',
      contract: { required: ['query', 'requestToken'], savesRestaurant: false },
    },
  },
  'catalog.intake.select': {
    key: 'catalog.intake.select',
    method: 'POST',
    path: '/api/catalog-intake/select',
    bodyKind: 'json',
    capability: {
      name: 'preview_restaurant',
      contract: {
        required: ['sessionId', 'expectedSessionVersion', 'ordinal'],
        optional: ['ownerFields', 'tabelog', 'reservation'],
        savesRestaurant: false,
      },
    },
  },
  'catalog.intake.confirm': {
    key: 'catalog.intake.confirm',
    method: 'POST',
    path: '/api/catalog-intake/confirm',
    bodyKind: 'json',
    capability: {
      name: 'confirm_restaurant',
      contract: {
        required: ['sessionId', 'expectedPreviewVersion'],
        requiresExplicitOwnerConfirmation: true,
        returns: [
          'status',
          'itemId on commit/reuse',
          'receiptRef on commit/reuse',
        ],
        successStatuses: [
          'committed_verified',
          'committed_needs_review',
          'reused_existing',
        ],
        mapVisibleStatus: 'committed_verified',
        mayReturnConflictOrFailedNoWrite: true,
      },
    },
  },
  'catalog.intake.cancel': {
    key: 'catalog.intake.cancel',
    method: 'POST',
    path: '/api/catalog-intake/cancel',
    bodyKind: 'json',
    capability: {
      name: 'cancel_restaurant',
      contract: {
        required: ['sessionId', 'expectedSessionVersion'],
        savesRestaurant: false,
      },
    },
  },
  'catalog.update_item': {
    key: 'catalog.update_item',
    method: 'PATCH',
    path: '/api/items/{id}',
    bodyKind: 'json',
    capability: { name: 'update_atlas_item' },
  },
  'assessment.update': {
    key: 'assessment.update',
    method: 'PATCH',
    path: '/api/items/{id}/personal',
    bodyKind: 'json',
    capability: { name: 'update_place_assessment' },
  },
  'catalog.delete_item': {
    key: 'catalog.delete_item',
    method: 'DELETE',
    path: '/api/items/{id}',
    bodyKind: 'none',
    capability: { name: 'delete_atlas_item' },
  },
  'visit.create': {
    key: 'visit.create',
    method: 'POST',
    path: '/api/journal',
    bodyKind: 'json',
    capability: { name: 'create_visit' },
  },
  'media.list': {
    key: 'media.list',
    method: 'GET',
    path: '/api/media',
    bodyKind: 'none',
  },
  'media.attach': {
    key: 'media.attach',
    method: 'POST',
    path: '/api/media',
    bodyKind: 'multipart',
    capability: {
      name: 'upload_visit_media',
      contentType: 'multipart/form-data',
      contract: {
        required: ['visitId', 'files'],
        optional: ['captions'],
        maxFilesPerRequest: 4,
        perVisitLimit: null,
        retryGuidance:
          'Use bounded batches. A future intake-session adapter will supply idempotent message IDs.',
      },
    },
  },
  'media.caption': {
    key: 'media.caption',
    method: 'PATCH',
    path: '/api/media/{id}',
    bodyKind: 'json',
    capability: { name: 'update_visit_media_caption' },
  },
  'media.delete': {
    key: 'media.delete',
    method: 'DELETE',
    path: '/api/media/{id}',
    bodyKind: 'none',
    capability: { name: 'delete_visit_media' },
  },
  'visit.list': {
    key: 'visit.list',
    method: 'GET',
    path: '/api/journal',
    bodyKind: 'none',
  },
  'visit.update': {
    key: 'visit.update',
    method: 'PATCH',
    path: '/api/journal/{id}',
    bodyKind: 'json',
  },
  'visit.delete': {
    key: 'visit.delete',
    method: 'DELETE',
    path: '/api/journal/{id}',
    bodyKind: 'none',
  },
});

export type BrowserOperationKey = keyof typeof browserOperationHttpCatalog;

export function browserOperationPath(
  key: BrowserOperationKey,
  parameters: Readonly<Record<string, string>> = {},
): string {
  return browserOperationHttpCatalog[key].path.replace(
    /\{([^}]+)\}/gu,
    (_match, name: string) => {
      const value = parameters[name];
      if (value === undefined) {
        throw new TypeError(`Missing ${name} path parameter for ${key}`);
      }
      return encodeURIComponent(value);
    },
  );
}

export function createAgentCapabilitiesDocument() {
  const operations = Object.values(browserOperationHttpCatalog).flatMap(
    (descriptor: BrowserOperationHttpDescriptor) => {
      const capability = descriptor.capability;
      if (!capability) return [];
      return [
        {
          name: capability.name,
          method: descriptor.method,
          ...(capability.contentType
            ? { contentType: capability.contentType }
            : {}),
          path: `${descriptor.path}${capability.pathSuffix ?? ''}`,
          ...(capability.contract ? { contract: capability.contract } : {}),
        },
      ];
    },
  );
  return {
    service: 'Japan Atlas',
    version: '0.6',
    intakeAuthentication: {
      type: 'owner_session_cookie',
      loginPath: '/api/auth/owner',
      sameOriginRequired: true,
      conversationHeader: 'x-atlas-web-conversation-id',
      conversationInstruction:
        'Read the conversation header returned by discover and echo it on select, confirm, and cancel using the same owner session.',
      note: 'Model provider keys are not application credentials. External agent token authentication is not implemented.',
    },
    operations,
  } as const;
}

import type { AtlasItem, VisitMediaRecord, VisitRecord } from './model';

interface PendingItemMutation {
  readonly mutationId: string;
  readonly patch: Partial<AtlasItem>;
}

interface ActiveLoads {
  readonly items?: string;
  readonly visits?: string;
  readonly media?: string;
}

export interface AtlasViewModelState {
  readonly items: AtlasItem[];
  readonly visits: VisitRecord[];
  readonly media: VisitMediaRecord[];
  readonly itemBases: Readonly<Record<string, AtlasItem>>;
  readonly pendingItemMutations: Readonly<
    Record<string, readonly PendingItemMutation[]>
  >;
  readonly activeLoads: ActiveLoads;
}

export type AtlasViewModelStateAction =
  | { readonly type: 'items.load.started'; readonly loadId: string }
  | {
      readonly type: 'items.loaded';
      readonly loadId: string;
      readonly items: readonly AtlasItem[];
    }
  | { readonly type: 'visits.load.started'; readonly loadId: string }
  | {
      readonly type: 'visits.loaded';
      readonly loadId: string;
      readonly visits: readonly VisitRecord[];
    }
  | { readonly type: 'media.load.started'; readonly loadId: string }
  | {
      readonly type: 'media.loaded';
      readonly loadId: string;
      readonly media: readonly VisitMediaRecord[];
    }
  | { readonly type: 'item.received'; readonly item: AtlasItem }
  | { readonly type: 'item.removed'; readonly itemId: string }
  | { readonly type: 'visit.prepended'; readonly visit: VisitRecord }
  | {
      readonly type: 'visit.received';
      readonly optimisticId: string;
      readonly visit: VisitRecord;
    }
  | {
      readonly type: 'item.mutation.started';
      readonly itemId: string;
      readonly mutationId: string;
      readonly patch: Partial<AtlasItem>;
    }
  | {
      readonly type: 'item.mutation.succeeded';
      readonly itemId: string;
      readonly mutationId: string;
      readonly item: AtlasItem;
    }
  | {
      readonly type: 'item.mutation.failed';
      readonly itemId: string;
      readonly mutationId: string;
    }
  | { readonly type: 'visit.removed'; readonly visitId: string }
  | {
      readonly type: 'visit.restored';
      readonly visit: VisitRecord;
      readonly media: readonly VisitMediaRecord[];
    }
  | {
      readonly type: 'media.appended';
      readonly media: readonly VisitMediaRecord[];
    }
  | { readonly type: 'media.received'; readonly media: VisitMediaRecord }
  | { readonly type: 'media.removed'; readonly mediaId: string }
  | { readonly type: 'media.restored'; readonly media: VisitMediaRecord };

export function createAtlasViewModelState(
  initial: {
    readonly items?: readonly AtlasItem[];
    readonly visits?: readonly VisitRecord[];
    readonly media?: readonly VisitMediaRecord[];
  } = {},
): AtlasViewModelState {
  return {
    items: [...(initial.items ?? [])],
    visits: [...(initial.visits ?? [])],
    media: [...(initial.media ?? [])],
    itemBases: {},
    pendingItemMutations: {},
    activeLoads: {},
  };
}

export function reduceAtlasViewModelState(
  state: AtlasViewModelState,
  action: AtlasViewModelStateAction,
): AtlasViewModelState {
  switch (action.type) {
    case 'items.load.started':
      return startLoad(state, 'items', action.loadId);
    case 'items.loaded': {
      if (state.activeLoads.items !== action.loadId) return state;
      const itemBases = { ...state.itemBases };
      const items = action.items.map((item) => {
        const pending = state.pendingItemMutations[item.id] ?? [];
        if (!pending.length) return item;
        itemBases[item.id] = item;
        return applyItemMutations(item, pending);
      });
      return {
        ...state,
        items,
        itemBases,
        activeLoads: clearLoad(state.activeLoads, 'items'),
      };
    }
    case 'visits.load.started':
      return startLoad(state, 'visits', action.loadId);
    case 'visits.loaded':
      return state.activeLoads.visits === action.loadId
        ? {
            ...state,
            visits: [...action.visits],
            activeLoads: clearLoad(state.activeLoads, 'visits'),
          }
        : state;
    case 'media.load.started':
      return startLoad(state, 'media', action.loadId);
    case 'media.loaded':
      return state.activeLoads.media === action.loadId
        ? {
            ...state,
            media: [...action.media],
            activeLoads: clearLoad(state.activeLoads, 'media'),
          }
        : state;
    case 'item.received': {
      const pending = state.pendingItemMutations[action.item.id] ?? [];
      return projectItem(
        invalidateLoad(state, 'items'),
        action.item.id,
        action.item,
        pending,
      );
    }
    case 'item.removed': {
      const itemBases = { ...state.itemBases };
      const pendingItemMutations = { ...state.pendingItemMutations };
      delete itemBases[action.itemId];
      delete pendingItemMutations[action.itemId];
      return {
        ...invalidateLoads(state, ['items', 'visits', 'media']),
        items: state.items.filter((item) => item.id !== action.itemId),
        visits: state.visits.filter((visit) => visit.itemId !== action.itemId),
        media: state.media.filter((entry) => entry.itemId !== action.itemId),
        itemBases,
        pendingItemMutations,
      };
    }
    case 'visit.prepended':
      return {
        ...invalidateLoad(state, 'visits'),
        visits: [action.visit, ...state.visits],
      };
    case 'visit.received':
      return {
        ...invalidateLoad(state, 'visits'),
        visits: sortVisits(
          state.visits.map((visit) =>
            visit.id === action.optimisticId ? action.visit : visit,
          ),
        ),
      };
    case 'item.mutation.started': {
      const current = findItem(state.items, action.itemId);
      if (!current) return state;
      const base = state.itemBases[action.itemId] ?? current;
      const pending = [
        ...(state.pendingItemMutations[action.itemId] ?? []),
        { mutationId: action.mutationId, patch: action.patch },
      ];
      return projectItem(
        invalidateLoad(state, 'items'),
        action.itemId,
        base,
        pending,
      );
    }
    case 'item.mutation.succeeded':
      return settleItemMutation(state, action, action.item);
    case 'item.mutation.failed':
      return settleItemMutation(state, action);
    case 'visit.removed':
      return {
        ...invalidateLoads(state, ['visits', 'media']),
        visits: state.visits.filter((visit) => visit.id !== action.visitId),
        media: state.media.filter((entry) => entry.visitId !== action.visitId),
      };
    case 'visit.restored':
      return {
        ...invalidateLoads(state, ['visits', 'media']),
        visits: sortVisits([action.visit, ...state.visits]),
        media: [...action.media, ...state.media],
      };
    case 'media.appended':
      return {
        ...invalidateLoad(state, 'media'),
        media: [
          ...state.media.filter(
            (entry) =>
              !action.media.some((received) => received.id === entry.id),
          ),
          ...action.media,
        ],
      };
    case 'media.received':
      return {
        ...invalidateLoad(state, 'media'),
        media: state.media.map((entry) =>
          entry.id === action.media.id ? action.media : entry,
        ),
      };
    case 'media.removed':
      return {
        ...invalidateLoad(state, 'media'),
        media: state.media.filter((entry) => entry.id !== action.mediaId),
      };
    case 'media.restored':
      return {
        ...invalidateLoad(state, 'media'),
        media: [...state.media, action.media],
      };
  }
}

type LoadKey = keyof ActiveLoads;

function startLoad(
  state: AtlasViewModelState,
  key: LoadKey,
  loadId: string,
): AtlasViewModelState {
  return { ...state, activeLoads: { ...state.activeLoads, [key]: loadId } };
}

function clearLoad(activeLoads: ActiveLoads, key: LoadKey): ActiveLoads {
  const next = { ...activeLoads };
  delete next[key];
  return next;
}

function invalidateLoad(
  state: AtlasViewModelState,
  key: LoadKey,
): AtlasViewModelState {
  return {
    ...state,
    activeLoads: clearLoad(state.activeLoads, key),
  };
}

function invalidateLoads(
  state: AtlasViewModelState,
  keys: readonly LoadKey[],
): AtlasViewModelState {
  return keys.reduce(invalidateLoad, state);
}

function settleItemMutation(
  state: AtlasViewModelState,
  action: {
    readonly itemId: string;
    readonly mutationId: string;
  },
  authoritativeItem?: AtlasItem,
): AtlasViewModelState {
  const currentBase =
    state.itemBases[action.itemId] ?? findItem(state.items, action.itemId);
  const base = authoritativeItem
    ? mergePersonalProjection(currentBase, authoritativeItem)
    : currentBase;
  if (!base) return state;
  const pending = (state.pendingItemMutations[action.itemId] ?? []).filter(
    (mutation) => mutation.mutationId !== action.mutationId,
  );
  return projectItem(state, action.itemId, base, pending);
}

function mergePersonalProjection(
  catalogBase: AtlasItem | undefined,
  authoritativeItem: AtlasItem,
): AtlasItem {
  if (!catalogBase) return authoritativeItem;

  return {
    ...catalogBase,
    ...('personalRating' in authoritativeItem
      ? { personalRating: authoritativeItem.personalRating }
      : {}),
    ...('isFavorite' in authoritativeItem
      ? { isFavorite: authoritativeItem.isFavorite }
      : {}),
    ...('hasVisited' in authoritativeItem
      ? { hasVisited: authoritativeItem.hasVisited }
      : {}),
    ...('overallComment' in authoritativeItem
      ? { overallComment: authoritativeItem.overallComment }
      : {}),
  };
}

function projectItem(
  state: AtlasViewModelState,
  itemId: string,
  base: AtlasItem,
  pending: readonly PendingItemMutation[],
): AtlasViewModelState {
  const projected = applyItemMutations(base, pending);
  const itemBases = { ...state.itemBases };
  const pendingItemMutations = { ...state.pendingItemMutations };
  if (pending.length) {
    itemBases[itemId] = base;
    pendingItemMutations[itemId] = pending;
  } else {
    delete itemBases[itemId];
    delete pendingItemMutations[itemId];
  }
  return {
    ...state,
    items: state.items.map((item) => (item.id === itemId ? projected : item)),
    itemBases,
    pendingItemMutations,
  };
}

function applyItemMutations(
  item: AtlasItem,
  pending: readonly PendingItemMutation[],
): AtlasItem {
  return pending.reduce(
    (projected, mutation) => ({ ...projected, ...mutation.patch }),
    item,
  );
}

function findItem(
  items: readonly AtlasItem[],
  id: string,
): AtlasItem | undefined {
  return items.find((item) => item.id === id);
}

function sortVisits(visits: readonly VisitRecord[]): VisitRecord[] {
  return [...visits].sort(
    (left, right) =>
      right.visitedAt.localeCompare(left.visitedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

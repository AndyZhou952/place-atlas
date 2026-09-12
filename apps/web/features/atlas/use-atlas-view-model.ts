'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { browserAtlasApplication } from './atlas-api-client';
import { matchesPersonalStatus } from './personal-filter';
import { matchesAtlasQuery } from './search';
import type {
  AtlasItem,
  AtlasItemEdit,
  AtlasKindFilter,
  AtlasPersonalFilter,
  AtlasSummary,
  AtlasView,
  NewImportJob,
  NewVisit,
  PlaceAssessmentPatch,
  VisitRecord,
  VisitUpdate,
} from './model';
import { useAtlasWebMcp } from './use-atlas-webmcp';
import {
  createAtlasViewModelState,
  reduceAtlasViewModelState,
} from './atlas-view-model-state';
import { verifiedAtlasItems } from './verified-items';

const DEFAULT_ITEM_ID = 'koffee-mameya-kakeru';

export function useAtlasViewModel() {
  const [view, setView] = useState<AtlasView>('map');
  const [state, dispatch] = useReducer(
    reduceAtlasViewModelState,
    createAtlasViewModelState({ items: verifiedAtlasItems }),
  );
  const { importJobs, items, media, visits } = state;
  const [kind, setKind] = useState<AtlasKindFilter>('all');
  const [personalFilter, setPersonalFilter] =
    useState<AtlasPersonalFilter>('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(DEFAULT_ITEM_ID);
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [locationStatus, setLocationStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [journalBusy, setJournalBusy] = useState(false);
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pendingMediaVisitIds, setPendingMediaVisitIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [notice, setNotice] = useState('');

  const setItemPending = useCallback((id: string, pending: boolean) => {
    setPendingItemIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const loadIds = {
      items: crypto.randomUUID(),
      importJobs: crypto.randomUUID(),
      visits: crypto.randomUUID(),
      media: crypto.randomUUID(),
    };
    dispatch({ type: 'items.load.started', loadId: loadIds.items });
    dispatch({
      type: 'import-jobs.load.started',
      loadId: loadIds.importJobs,
    });
    dispatch({ type: 'visits.load.started', loadId: loadIds.visits });
    dispatch({ type: 'media.load.started', loadId: loadIds.media });
    void Promise.all([
      browserAtlasApplication
        .execute({
          key: 'catalog.list',
          input: { profile: 'full_merged_catalog' },
        })
        .then((loadedItems) =>
          dispatch({
            type: 'items.loaded',
            loadId: loadIds.items,
            items: loadedItems,
          }),
        ),
      browserAtlasApplication
        .execute({ key: 'import.list', input: {} })
        .then((loadedJobs) =>
          dispatch({
            type: 'import-jobs.loaded',
            loadId: loadIds.importJobs,
            importJobs: loadedJobs,
          }),
        ),
      browserAtlasApplication
        .execute({ key: 'visit.list', input: {} })
        .then((loadedVisits) =>
          dispatch({
            type: 'visits.loaded',
            loadId: loadIds.visits,
            visits: loadedVisits,
          }),
        ),
      browserAtlasApplication
        .execute({ key: 'media.list', input: {} })
        .then((loadedMedia) =>
          dispatch({
            type: 'media.loaded',
            loadId: loadIds.media,
            media: loadedMedia,
          }),
        ),
    ]).catch(() => {
      setNotice(
        'Local preview is using verified source data; cloud records reconnect after publish.',
      );
    });
  }, []);

  const setMediaVisitPending = useCallback(
    (visitId: string, pending: boolean) => {
      setPendingMediaVisitIds((current) => {
        const next = new Set(current);
        if (pending) next.add(visitId);
        else next.delete(visitId);
        return next;
      });
    },
    [],
  );

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (item.verificationStatus !== 'verified') return false;
      const matchesKind = kind === 'all' || item.kind === kind;
      const matchesPersonal = matchesPersonalStatus(
        item,
        personalFilter,
        favoriteOnly,
      );
      return matchesKind && matchesPersonal && matchesAtlasQuery(item, query);
    });

    return [...filtered].sort((left, right) => {
      const leftDistance = distances[left.id];
      const rightDistance = distances[right.id];
      if (leftDistance === undefined && rightDistance === undefined) return 0;
      if (leftDistance === undefined) return 1;
      if (rightDistance === undefined) return -1;
      return leftDistance - rightDistance;
    });
  }, [distances, favoriteOnly, items, kind, personalFilter, query]);

  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];

  const summary: AtlasSummary = {
    saved: items.filter((item) => item.personalState !== 'candidate').length,
    needsReview: items.filter(
      (item) => item.verificationStatus === 'needs_review',
    ).length,
    timeSensitive: items.filter(
      (item) => item.kind === 'event' || item.reservation.mode === 'advance',
    ).length,
  };

  const selectItem = useCallback((id: string) => {
    setSelectedId(id);
    setView('map');
  }, []);

  const saveItemEdit = useCallback(
    async (id: string, edit: AtlasItemEdit) => {
      setItemPending(id, true);
      setNotice('');
      try {
        const updated = await browserAtlasApplication.execute({
          key: 'catalog.update_item',
          input: { id, ...edit },
        });
        dispatch({ type: 'item.received', item: updated });
        setNotice('Changes saved. The Agent API will read the same record.');
        return updated;
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : 'Could not save changes.',
        );
        throw error;
      } finally {
        setItemPending(id, false);
      }
    },
    [setItemPending],
  );

  const queueImport = useCallback(async (input: NewImportJob) => {
    setBusy(true);
    setNotice('');
    try {
      const job = await browserAtlasApplication.execute({
        key: 'import.queue',
        input,
      });
      dispatch({ type: 'import-job.prepended', importJob: job });
      setNotice(
        'Import queued. It will start when the collector worker is connected.',
      );
      return job;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not queue import.',
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

  const addVisit = useCallback(
    async (input: NewVisit) => {
      const item = items.find((candidate) => candidate.id === input.itemId);
      if (!item) throw new Error('Atlas item not found');
      const now = new Date().toISOString();
      const visitId = input.id ?? crypto.randomUUID();
      const mutationId = crypto.randomUUID();
      const optimisticVisit: VisitRecord = {
        id: visitId,
        itemId: item.id,
        itemTitle: item.title,
        visitedAt: input.visitedAt,
        note: input.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };

      setJournalBusy(true);
      setNotice('');
      dispatch({ type: 'visit.prepended', visit: optimisticVisit });
      dispatch({
        type: 'item.mutation.started',
        itemId: item.id,
        mutationId,
        patch: {
          hasVisited: true,
          ...(input.rating === undefined
            ? {}
            : { personalRating: input.rating }),
        },
      });
      try {
        const result = await browserAtlasApplication.execute({
          key: 'visit.create',
          input: { ...input, id: visitId },
        });
        dispatch({
          type: 'visit.received',
          optimisticId: optimisticVisit.id,
          visit: result.visit,
        });
        dispatch({
          type: 'item.mutation.succeeded',
          itemId: item.id,
          mutationId,
          item: result.item,
        });
        setNotice('Visit saved. Your place record has been updated.');
        return result;
      } catch (error) {
        dispatch({ type: 'visit.removed', visitId: optimisticVisit.id });
        dispatch({
          type: 'item.mutation.failed',
          itemId: item.id,
          mutationId,
        });
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not save journal entry.',
        );
        throw error;
      } finally {
        setJournalBusy(false);
      }
    },
    [items],
  );

  const editVisit = useCallback(
    async (id: string, input: VisitUpdate) => {
      const previousVisit = visits.find((visit) => visit.id === id);
      if (!previousVisit) throw new Error('Journal entry not found');
      const previousItem = items.find(
        (item) => item.id === previousVisit.itemId,
      );
      if (!previousItem) throw new Error('Atlas item not found');

      const optimisticVisit: VisitRecord = {
        ...previousVisit,
        visitedAt: input.visitedAt,
        note: input.note?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      const mutationId = crypto.randomUUID();

      setJournalBusy(true);
      setNotice('');
      dispatch({
        type: 'visit.received',
        optimisticId: id,
        visit: optimisticVisit,
      });
      dispatch({
        type: 'item.mutation.started',
        itemId: previousItem.id,
        mutationId,
        patch:
          input.rating === undefined
            ? {}
            : {
                personalRating:
                  input.rating === null ? undefined : input.rating,
              },
      });

      try {
        const result = await browserAtlasApplication.execute({
          key: 'visit.update',
          input: { id, ...input },
        });
        if (result.visit) {
          dispatch({
            type: 'visit.received',
            optimisticId: id,
            visit: result.visit,
          });
        }
        dispatch({
          type: 'item.mutation.succeeded',
          itemId: previousItem.id,
          mutationId,
          item: result.item,
        });
        return result;
      } catch (error) {
        dispatch({
          type: 'visit.received',
          optimisticId: id,
          visit: previousVisit,
        });
        dispatch({
          type: 'item.mutation.failed',
          itemId: previousItem.id,
          mutationId,
        });
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not update journal entry.',
        );
        throw error;
      } finally {
        setJournalBusy(false);
      }
    },
    [items, visits],
  );

  const removeVisit = useCallback(
    async (id: string) => {
      const previousVisit = visits.find((visit) => visit.id === id);
      if (!previousVisit) throw new Error('Journal entry not found');
      const previousItem = items.find(
        (item) => item.id === previousVisit.itemId,
      );
      if (!previousItem) throw new Error('Atlas item not found');
      const previousMedia = media.filter((entry) => entry.visitId === id);

      setJournalBusy(true);
      setNotice('');
      dispatch({ type: 'visit.removed', visitId: id });

      try {
        const result = await browserAtlasApplication.execute({
          key: 'visit.delete',
          input: { id },
        });
        dispatch({ type: 'item.received', item: result.item });
        return result;
      } catch (error) {
        dispatch({
          type: 'visit.restored',
          visit: previousVisit,
          media: previousMedia,
        });
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not delete journal entry.',
        );
        throw error;
      } finally {
        setJournalBusy(false);
      }
    },
    [items, media, visits],
  );

  const addVisitMedia = useCallback(
    async (visitId: string, files: readonly File[]) => {
      setMediaVisitPending(visitId, true);
      setNotice('');
      try {
        const uploaded = await browserAtlasApplication.execute({
          key: 'media.attach',
          input: {
            visitId,
            files,
            onBatchCompleted: (completed) => {
              dispatch({ type: 'media.appended', media: completed });
            },
          },
        });
        return uploaded;
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : 'Could not upload photos.',
        );
        throw error;
      } finally {
        setMediaVisitPending(visitId, false);
      }
    },
    [setMediaVisitPending],
  );

  const saveMediaCaption = useCallback(
    async (id: string, caption: string) => {
      const previous = media.find((entry) => entry.id === id);
      if (!previous) throw new Error('Photo not found');
      const optimistic = { ...previous, caption: caption.trim() || undefined };
      dispatch({ type: 'media.received', media: optimistic });
      try {
        const updated = await browserAtlasApplication.execute({
          key: 'media.caption',
          input: { id, caption: caption.trim() },
        });
        dispatch({ type: 'media.received', media: updated });
        return updated;
      } catch (error) {
        dispatch({ type: 'media.received', media: previous });
        setNotice(
          error instanceof Error ? error.message : 'Could not save caption.',
        );
        throw error;
      }
    },
    [media],
  );

  const removeMedia = useCallback(
    async (id: string) => {
      const previous = media.find((entry) => entry.id === id);
      if (!previous) throw new Error('Photo not found');
      dispatch({ type: 'media.removed', mediaId: id });
      try {
        await browserAtlasApplication.execute({
          key: 'media.delete',
          input: { id },
        });
      } catch (error) {
        dispatch({ type: 'media.restored', media: previous });
        setNotice(
          error instanceof Error ? error.message : 'Could not delete photo.',
        );
        throw error;
      }
    },
    [media],
  );

  const saveAssessment = useCallback(
    async (id: string, patch: PlaceAssessmentPatch) => {
      const previous = items.find((item) => item.id === id);
      if (!previous) throw new Error('Atlas item not found');
      const mutationId = crypto.randomUUID();

      setItemPending(id, true);
      setNotice('');
      dispatch({
        type: 'item.mutation.started',
        itemId: id,
        mutationId,
        patch: {
          ...(patch.overallRating === undefined
            ? {}
            : {
                personalRating:
                  patch.overallRating === null
                    ? undefined
                    : patch.overallRating,
              }),
          ...(patch.isFavorite === undefined
            ? {}
            : { isFavorite: patch.isFavorite }),
          ...(patch.hasVisited === undefined
            ? {}
            : { hasVisited: patch.hasVisited }),
        },
      });
      try {
        const { hasVisited, ...assessmentPatch } = patch;
        const updated = await browserAtlasApplication.execute({
          key: 'assessment.update',
          input: {
            itemId: id,
            patch: {
              ...assessmentPatch,
              ...(hasVisited === undefined
                ? {}
                : { manualVisited: hasVisited }),
            },
          },
        });
        dispatch({
          type: 'item.mutation.succeeded',
          itemId: id,
          mutationId,
          item: updated,
        });
        setNotice('');
        return updated;
      } catch (error) {
        dispatch({
          type: 'item.mutation.failed',
          itemId: id,
          mutationId,
        });
        setNotice(
          error instanceof Error ? error.message : 'Could not save status.',
        );
        throw error;
      } finally {
        setItemPending(id, false);
      }
    },
    [items, setItemPending],
  );

  const removeItem = useCallback(
    async (id: string) => {
      setItemPending(id, true);
      setNotice('');
      try {
        await browserAtlasApplication.execute({
          key: 'catalog.delete_item',
          input: { id },
        });
        dispatch({ type: 'item.removed', itemId: id });
        setNotice('Place removed from your Atlas.');
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : 'Could not remove place.',
        );
        throw error;
      } finally {
        setItemPending(id, false);
      }
    },
    [setItemPending],
  );

  const locateNearby = useCallback(async () => {
    setLocationStatus('Requesting your location…');
    setView('map');
    if (!navigator.geolocation) {
      setLocationStatus('Location is not supported by this browser.');
      return [];
    }

    return new Promise<AtlasItem[]>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void browserAtlasApplication
            .execute({
              key: 'decision.nearby',
              input: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                limit: 20,
              },
            })
            .then((results) => {
              const nextDistances = Object.fromEntries(
                results.map((item) => [item.id, item.distanceKm]),
              );
              const itemsById = new Map(items.map((item) => [item.id, item]));
              const nearest = results.flatMap((result) => {
                const item = itemsById.get(result.id);
                return item ? [item] : [];
              });
              setDistances(nextDistances);
              if (nearest[0]) setSelectedId(nearest[0].id);
              setLocationStatus(
                nearest[0]
                  ? `Nearest verified place: ${nearest[0].title} · ${results[0].distanceKm.toFixed(1)} km`
                  : 'No verified places found.',
              );
              resolve(nearest);
            })
            .catch((error) => {
              setLocationStatus('Nearby places are temporarily unavailable.');
              setNotice(
                error instanceof Error
                  ? error.message
                  : 'Could not find nearby places.',
              );
              resolve([]);
            });
        },
        () => {
          setLocationStatus('Location permission was not granted.');
          resolve([]);
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }, [items]);

  const webMcpActions = useMemo(
    () => ({
      items,
      selectItem,
      updateItem: saveItemEdit,
      updateAssessment: saveAssessment,
      removeItem,
      queueImport,
      addJournal: addVisit,
      media,
      updateMediaCaption: saveMediaCaption,
      removeMedia,
      updateJournal: editVisit,
      removeJournal: removeVisit,
      locateNearby,
    }),
    [
      addVisit,
      editVisit,
      items,
      locateNearby,
      media,
      queueImport,
      removeItem,
      removeMedia,
      removeVisit,
      saveMediaCaption,
      saveAssessment,
      saveItemEdit,
      selectItem,
    ],
  );

  useAtlasWebMcp(webMcpActions);

  return {
    addVisit,
    addVisitMedia,
    editVisit,
    busy,
    distances,
    importJobs,
    items,
    favoriteOnly,
    isItemPending: (id: string) => pendingItemIds.has(id),
    isMediaVisitPending: (visitId: string) => pendingMediaVisitIds.has(visitId),
    journalBusy,
    visits,
    media,
    kind,
    locationStatus,
    notice,
    personalFilter,
    query,
    queueImport,
    removeItem,
    removeMedia,
    removeVisit,
    saveAssessment,
    saveMediaCaption,
    saveItemEdit,
    selectedItem,
    selectItem,
    setKind,
    setFavoriteOnly,
    setPersonalFilter,
    setQuery,
    setView,
    summary,
    view,
    visibleItems,
    locateNearby,
  } as const;
}

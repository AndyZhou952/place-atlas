'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createImportJob,
  createVisit,
  deleteAtlasItem,
  deleteVisit,
  fetchAtlasItems,
  fetchImportJobs,
  fetchVisits,
  updateAtlasItem,
  updateItemAssessment,
  updateVisit,
} from './atlas-api-client';
import { distanceInKm } from './distance';
import { matchesPersonalStatus } from './personal-filter';
import { matchesAtlasQuery } from './search';
import type {
  AtlasItem,
  AtlasItemEdit,
  AtlasKindFilter,
  AtlasPersonalFilter,
  AtlasSummary,
  AtlasView,
  ImportJob,
  NewImportJob,
  NewVisit,
  PlaceAssessmentPatch,
  VisitRecord,
  VisitUpdate,
} from './model';
import { useAtlasWebMcp } from './use-atlas-webmcp';
import { verifiedAtlasItems } from './verified-items';

const DEFAULT_ITEM_ID = 'koffee-mameya-kakeru';

export function useAtlasViewModel() {
  const [view, setView] = useState<AtlasView>('map');
  const [items, setItems] = useState<AtlasItem[]>([...verifiedAtlasItems]);
  const [kind, setKind] = useState<AtlasKindFilter>('all');
  const [personalFilter, setPersonalFilter] =
    useState<AtlasPersonalFilter>('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(DEFAULT_ITEM_ID);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [locationStatus, setLocationStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [journalBusy, setJournalBusy] = useState(false);
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
    void Promise.all([
      fetchAtlasItems().then(setItems),
      fetchImportJobs().then(setImportJobs),
      fetchVisits().then(setVisits),
    ]).catch(() => {
      setNotice(
        'Local preview is using verified source data; cloud records reconnect after publish.',
      );
    });
  }, []);

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
        const updated = await updateAtlasItem(id, edit);
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
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
      const job = await createImportJob(input);
      setImportJobs((current) => [job, ...current]);
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
      setVisits((current) => [optimisticVisit, ...current]);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                hasVisited: true,
                ...(input.rating === undefined
                  ? {}
                  : { personalRating: input.rating }),
              }
            : candidate,
        ),
      );
      try {
        const result = await createVisit({ ...input, id: visitId });
        setVisits((current) =>
          current.map((visit) =>
            visit.id === optimisticVisit.id ? result.visit : visit,
          ),
        );
        setItems((current) =>
          current.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        );
        setNotice('Visit saved. Your place record has been updated.');
        return result;
      } catch (error) {
        setVisits((current) =>
          current.filter((visit) => visit.id !== optimisticVisit.id),
        );
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? item : candidate,
          ),
        );
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

      setJournalBusy(true);
      setNotice('');
      setVisits((current) =>
        sortVisits(
          current.map((visit) => (visit.id === id ? optimisticVisit : visit)),
        ),
      );
      if (input.rating !== undefined) {
        setItems((current) =>
          current.map((item) =>
            item.id === previousItem.id
              ? {
                  ...item,
                  personalRating:
                    input.rating === null ? undefined : input.rating,
                }
              : item,
          ),
        );
      }

      try {
        const result = await updateVisit(id, input);
        if (result.visit) {
          setVisits((current) =>
            sortVisits(
              current.map((visit) =>
                visit.id === result.visit?.id ? result.visit : visit,
              ),
            ),
          );
        }
        setItems((current) =>
          current.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        );
        return result;
      } catch (error) {
        setVisits((current) =>
          sortVisits(
            current.map((visit) => (visit.id === id ? previousVisit : visit)),
          ),
        );
        setItems((current) =>
          current.map((item) =>
            item.id === previousItem.id ? previousItem : item,
          ),
        );
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
      const hasAnotherVisit = visits.some(
        (visit) => visit.id !== id && visit.itemId === previousVisit.itemId,
      );

      setJournalBusy(true);
      setNotice('');
      setVisits((current) => current.filter((visit) => visit.id !== id));
      if (!hasAnotherVisit) {
        setItems((current) =>
          current.map((item) =>
            item.id === previousItem.id ? { ...item, hasVisited: false } : item,
          ),
        );
      }

      try {
        const result = await deleteVisit(id);
        setItems((current) =>
          current.map((item) =>
            item.id === result.item.id ? result.item : item,
          ),
        );
        return result;
      } catch (error) {
        setVisits((current) => sortVisits([previousVisit, ...current]));
        setItems((current) =>
          current.map((item) =>
            item.id === previousItem.id ? previousItem : item,
          ),
        );
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
    [items, visits],
  );

  const saveAssessment = useCallback(
    async (id: string, patch: PlaceAssessmentPatch) => {
      const previous = items.find((item) => item.id === id);
      if (!previous) throw new Error('Atlas item not found');

      setItemPending(id, true);
      setNotice('');
      setItems((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
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
          };
        }),
      );
      try {
        const updated = await updateItemAssessment(id, patch);
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setNotice('');
        return updated;
      } catch (error) {
        setItems((current) =>
          current.map((item) => (item.id === id ? previous : item)),
        );
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
        await deleteAtlasItem(id);
        setItems((current) => current.filter((item) => item.id !== id));
        setVisits((current) => current.filter((visit) => visit.itemId !== id));
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
          const nextDistances = Object.fromEntries(
            items.map((item) => [
              item.id,
              distanceInKm(
                position.coords.latitude,
                position.coords.longitude,
                item.latitude,
                item.longitude,
              ),
            ]),
          );
          setDistances(nextDistances);
          const nearest = [...items].sort(
            (left, right) => nextDistances[left.id] - nextDistances[right.id],
          );
          if (nearest[0]) setSelectedId(nearest[0].id);
          setLocationStatus(
            nearest[0]
              ? `Nearest verified place: ${nearest[0].title} · ${nextDistances[nearest[0].id].toFixed(1)} km`
              : 'No verified places found.',
          );
          resolve(nearest);
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
      updateJournal: editVisit,
      removeJournal: removeVisit,
      locateNearby,
    }),
    [
      addVisit,
      editVisit,
      items,
      locateNearby,
      queueImport,
      removeItem,
      removeVisit,
      saveAssessment,
      saveItemEdit,
      selectItem,
    ],
  );

  useAtlasWebMcp(webMcpActions);

  return {
    addVisit,
    editVisit,
    busy,
    distances,
    importJobs,
    items,
    favoriteOnly,
    isItemPending: (id: string) => pendingItemIds.has(id),
    journalBusy,
    visits,
    kind,
    locationStatus,
    notice,
    personalFilter,
    query,
    queueImport,
    removeItem,
    removeVisit,
    saveAssessment,
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

function sortVisits(visits: VisitRecord[]): VisitRecord[] {
  return [...visits].sort(
    (left, right) =>
      right.visitedAt.localeCompare(left.visitedAt) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createImportJob,
  createJournalEntry,
  fetchAtlasItems,
  fetchImportJobs,
  fetchJournalEntries,
  updateAtlasItem,
} from './atlas-api-client';
import { distanceInKm } from './distance';
import type {
  AtlasItem,
  AtlasItemEdit,
  AtlasKindFilter,
  AtlasSummary,
  AtlasView,
  ImportJob,
  JournalEntry,
  NewImportJob,
  NewJournalEntry,
} from './model';
import { useAtlasWebMcp } from './use-atlas-webmcp';
import { verifiedAtlasItems } from './verified-items';

const DEFAULT_ITEM_ID = 'koffee-mameya-kakeru';

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function useAtlasViewModel() {
  const [view, setView] = useState<AtlasView>('map');
  const [items, setItems] = useState<AtlasItem[]>([...verifiedAtlasItems]);
  const [kind, setKind] = useState<AtlasKindFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(DEFAULT_ITEM_ID);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [locationStatus, setLocationStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void Promise.all([
      fetchAtlasItems().then(setItems),
      fetchImportJobs().then(setImportJobs),
      fetchJournalEntries().then(setJournalEntries),
    ]).catch(() => {
      setNotice(
        'Local preview is using verified source data; cloud records reconnect after publish.',
      );
    });
  }, []);

  const visibleItems = useMemo(() => {
    const needle = normalized(query);
    const filtered = items.filter((item) => {
      if (item.verificationStatus !== 'verified') return false;
      const matchesKind = kind === 'all' || item.kind === kind;
      const haystack = normalized(
        [
          item.title,
          item.alternateTitle ?? '',
          item.area,
          item.address,
          ...item.tags,
        ].join(' '),
      );
      return matchesKind && (!needle || haystack.includes(needle));
    });

    return [...filtered].sort((left, right) => {
      const leftDistance = distances[left.id];
      const rightDistance = distances[right.id];
      if (leftDistance === undefined && rightDistance === undefined) return 0;
      if (leftDistance === undefined) return 1;
      if (rightDistance === undefined) return -1;
      return leftDistance - rightDistance;
    });
  }, [distances, items, kind, query]);

  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    items.find((item) => item.id === selectedId) ??
    items[0];

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

  const saveItemEdit = useCallback(async (id: string, edit: AtlasItemEdit) => {
    setBusy(true);
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
      setBusy(false);
    }
  }, []);

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

  const addJournal = useCallback(async (input: NewJournalEntry) => {
    setBusy(true);
    setNotice('');
    try {
      const entry = await createJournalEntry(input);
      setJournalEntries((current) => [entry, ...current]);
      setNotice('Journal entry saved.');
      return entry;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not save journal entry.',
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

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
      queueImport,
      addJournal,
      locateNearby,
    }),
    [addJournal, items, locateNearby, queueImport, saveItemEdit, selectItem],
  );

  useAtlasWebMcp(webMcpActions);

  return {
    addJournal,
    busy,
    distances,
    importJobs,
    journalEntries,
    kind,
    locationStatus,
    mapUrl: selectedItem ? buildOpenStreetMapEmbedUrl(selectedItem) : '',
    notice,
    query,
    queueImport,
    saveItemEdit,
    selectedItem,
    selectItem,
    setKind,
    setQuery,
    setView,
    summary,
    view,
    visibleItems,
    locateNearby,
  } as const;
}

function buildOpenStreetMapEmbedUrl(item: AtlasItem): string {
  const delta = 0.035;
  const bbox = [
    item.longitude - delta,
    item.latitude - delta,
    item.longitude + delta,
    item.latitude + delta,
  ].join(',');
  const params = new URLSearchParams({
    bbox,
    layer: 'mapnik',
    marker: `${item.latitude},${item.longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

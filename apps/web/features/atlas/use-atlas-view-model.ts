'use client';

import { useMemo, useState } from 'react';

import { atlasItems } from './fixtures';
import type { AtlasItem, AtlasKindFilter, AtlasSummary } from './model';
import { useAtlasWebMcp } from './use-atlas-webmcp';

const DEFAULT_ITEM_ID = 'koffee-mameya-kakeru';

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function useAtlasViewModel() {
  const [kind, setKind] = useState<AtlasKindFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(DEFAULT_ITEM_ID);

  useAtlasWebMcp(setSelectedId);

  const visibleItems = useMemo(() => {
    const needle = normalized(query);

    return atlasItems.filter((item) => {
      const matchesKind = kind === 'all' || item.kind === kind;
      const haystack = normalized(
        [item.name, item.localName, item.area, ...item.tags].join(' '),
      );

      return matchesKind && (!needle || haystack.includes(needle));
    });
  }, [kind, query]);

  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ??
    visibleItems[0] ??
    atlasItems.find((item) => item.id === selectedId) ??
    atlasItems[0];

  const summary: AtlasSummary = {
    saved: atlasItems.filter((item) => item.personalState !== 'visited').length,
    needsReview: atlasItems.filter((item) =>
      item.freshnessLabel.toLocaleLowerCase().includes('needs'),
    ).length,
    openingSoon: atlasItems.filter(
      (item) => item.kind === 'event' || item.reservationMode === 'advance',
    ).length,
  };

  return {
    kind,
    mapUrl: buildOpenStreetMapEmbedUrl(selectedItem),
    query,
    selectedItem,
    summary,
    visibleItems,
    selectItem: setSelectedId,
    setKind,
    setQuery,
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

'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';

import type { AtlasItem } from './model';

interface AtlasMapProps {
  readonly items: readonly AtlasItem[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export function AtlasMap({ items, selectedId, onSelect }: AtlasMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;

    void import('leaflet').then((leaflet) => {
      if (disposed || !elementRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(elementRef.current, {
        attributionControl: true,
        zoomControl: false,
      });
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        })
        .addTo(map);
      leaflet.control.zoom({ position: 'bottomright' }).addTo(map);
      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      map.setView([35.6812, 139.7671], 11);
      observer = new ResizeObserver(() => map.invalidateSize(false));
      observer.observe(elementRef.current);
      setReady(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !leaflet || !map || !layer) return;

    layer.clearLayers();
    const bounds: Leaflet.LatLngExpression[] = [];
    const coordinateCounts = new Map<string, number>();
    for (const item of items) {
      const selected = item.id === selectedId;
      const coordinateKey = `${item.latitude.toFixed(4)},${item.longitude.toFixed(4)}`;
      const sameLocationIndex = coordinateCounts.get(coordinateKey) ?? 0;
      coordinateCounts.set(coordinateKey, sameLocationIndex + 1);
      const offset = sameLocationIndex * 0.00018;
      const position: Leaflet.LatLngExpression = [
        item.latitude + offset,
        item.longitude + offset,
      ];
      const marker = leaflet.marker(position, {
        icon: leaflet.divIcon({
          className: 'atlas-map-marker-shell',
          html: `<span class="atlas-map-marker marker-${item.kind}${selected ? ' is-selected' : ''}"><b>${item.kind === 'food' ? '食' : item.kind === 'event' ? '日' : '建'}</b></span>`,
          iconAnchor: [18, 36],
          iconSize: [36, 36],
        }),
        keyboard: true,
        title: item.title,
      });
      const tooltip = document.createElement('span');
      tooltip.className = 'atlas-map-tooltip';
      tooltip.textContent = item.title;
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -28] });
      marker.on('click', () => onSelectRef.current(item.id));
      marker.addTo(layer);
      bounds.push(position);
    }

    if (!fittedRef.current && bounds.length) {
      map.fitBounds(leaflet.latLngBounds(bounds), {
        padding: [70, 70],
        maxZoom: 13,
      });
      fittedRef.current = true;
    }
  }, [items, ready, selectedId]);

  useEffect(() => {
    const item = items.find((candidate) => candidate.id === selectedId);
    if (!ready || !item || !mapRef.current) return;
    mapRef.current.flyTo(
      [item.latitude, item.longitude],
      Math.max(mapRef.current.getZoom(), 13),
      {
        duration: 0.45,
      },
    );
  }, [items, ready, selectedId]);

  return (
    <div
      ref={elementRef}
      className="map-canvas"
      aria-label="Interactive map of Atlas places"
    />
  );
}

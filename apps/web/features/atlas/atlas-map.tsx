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
  const markersRef = useRef<Map<string, Leaflet.Marker>>(new Map());
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const fittedRef = useRef(false);
  const previousSelectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const markerSignature = JSON.stringify(
    items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      latitude: item.latitude,
      longitude: item.longitude,
    })),
  );

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const markers = markersRef.current;

    void import('leaflet').then((leaflet) => {
      if (disposed || !elementRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(elementRef.current, {
        attributionControl: true,
        fadeAnimation: false,
        markerZoomAnimation: false,
        preferCanvas: true,
        zoomControl: false,
      });
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          keepBuffer: 4,
          maxZoom: 19,
          updateWhenIdle: true,
          updateWhenZooming: false,
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
      markers.clear();
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !leaflet || !map || !layer) return;

    const markerItems = JSON.parse(markerSignature) as Array<{
      id: string;
      kind: AtlasItem['kind'];
      title: string;
      latitude: number;
      longitude: number;
    }>;
    layer.clearLayers();
    markersRef.current.clear();
    const bounds: Leaflet.LatLngExpression[] = [];
    const coordinateCounts = new Map<string, number>();
    for (const item of markerItems) {
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
          html: `<span class="atlas-map-marker marker-${item.kind}"><b>${item.kind === 'food' ? '食' : item.kind === 'event' ? '日' : '建'}</b></span>`,
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
      markersRef.current.set(item.id, marker);
      bounds.push(position);
    }

    if (!fittedRef.current && bounds.length) {
      map.fitBounds(leaflet.latLngBounds(bounds), {
        padding: [70, 70],
        maxZoom: 13,
      });
      fittedRef.current = true;
    }
  }, [markerSignature, ready]);

  useEffect(() => {
    const item = items.find((candidate) => candidate.id === selectedId);
    if (!ready || !item || !mapRef.current) return;

    for (const [id, marker] of markersRef.current) {
      marker
        .getElement()
        ?.querySelector('.atlas-map-marker')
        ?.classList.toggle('is-selected', id === selectedId);
    }

    if (previousSelectedRef.current !== selectedId) {
      mapRef.current.setView(
        [item.latitude, item.longitude],
        Math.max(mapRef.current.getZoom(), 13),
        { animate: false },
      );
      previousSelectedRef.current = selectedId;
    }
  }, [items, ready, selectedId]);

  return (
    <div
      ref={elementRef}
      className="map-canvas"
      aria-label="Interactive map of Atlas places"
    />
  );
}

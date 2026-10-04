'use client';

import { useEffect, useRef, useState } from 'react';

import type { AtlasMapAdapter } from './map-adapter';
import type { AtlasItem } from './model';

interface AtlasMapProps {
  readonly items: readonly AtlasItem[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export function AtlasMap({ items, selectedId, onSelect }: AtlasMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<AtlasMapAdapter | null>(null);
  const onSelectRef = useRef(onSelect);
  const resizeFrameRef = useRef<number | undefined>(undefined);
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

    void Promise.all([import('leaflet'), import('./leaflet-map-adapter')]).then(
      ([leaflet, { LeafletMapAdapter }]) => {
        if (disposed || !elementRef.current) return;
        const adapter = new LeafletMapAdapter(
          leaflet,
          elementRef.current,
          (id) => onSelectRef.current(id),
        );
        adapterRef.current = adapter;
        observer = new ResizeObserver(() => {
          if (resizeFrameRef.current !== undefined) {
            window.cancelAnimationFrame(resizeFrameRef.current);
          }
          resizeFrameRef.current = window.requestAnimationFrame(() => {
            adapter.resize();
            resizeFrameRef.current = undefined;
          });
        });
        observer.observe(elementRef.current);
        setReady(true);
      },
    );

    return () => {
      disposed = true;
      observer?.disconnect();
      if (resizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    adapterRef.current?.setItems(JSON.parse(markerSignature) as AtlasItem[]);
  }, [markerSignature, ready]);

  useEffect(() => {
    if (!ready) return;
    adapterRef.current?.setSelected(selectedId);
  }, [ready, selectedId]);

  return (
    <div
      ref={elementRef}
      className="map-canvas"
      aria-label="Interactive map of Atlas places"
    />
  );
}

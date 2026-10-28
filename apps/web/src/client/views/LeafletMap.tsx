import type * as Leaflet from 'leaflet';
import { useEffect, useRef } from 'react';
import type { Restaurant } from '../../shared/types.ts';

/** OpenStreetMap tiles with one marker per restaurant; selecting pans to it. */
export function LeafletMap({
  items,
  selectedId,
  onSelect,
}: {
  readonly items: readonly Restaurant[];
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<{
    leaflet: typeof Leaflet;
    map: Leaflet.Map;
    layer: Leaflet.LayerGroup;
    fitted: boolean;
  }>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import('leaflet').then((leaflet) => {
      if (disposed || !element.current) return;
      const instance = leaflet
        .map(element.current, { zoomControl: false })
        .setView([35.6812, 139.7671], 11);
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        })
        .addTo(instance);
      leaflet.control.zoom({ position: 'bottomright' }).addTo(instance);
      map.current = {
        leaflet,
        map: instance,
        layer: leaflet.layerGroup().addTo(instance),
        fitted: false,
      };
      observer = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
      observer.observe(element.current);
      element.current.dispatchEvent(new Event('atlas:map-ready'));
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      map.current?.map.remove();
      map.current = null;
    };
  }, []);

  const signature = items.map((r) => `${r.id}:${r.latitude}:${r.longitude}`).join('|');
  useEffect(() => {
    const draw = () => {
      const current = map.current;
      if (!current) return;
      current.layer.clearLayers();
      markers.current.clear();
      const seen = new Map<string, number>();
      for (const restaurant of items) {
        // Offset markers that share a location so each stays clickable.
        const key = `${restaurant.latitude.toFixed(4)},${restaurant.longitude.toFixed(4)}`;
        const offset = (seen.get(key) ?? 0) * 0.00018;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        const marker = current.leaflet
          .marker([restaurant.latitude + offset, restaurant.longitude + offset], {
            title: restaurant.title,
            icon: current.leaflet.divIcon({
              className: 'marker-shell',
              html: '<span class="marker"><b>食</b></span>',
              iconSize: [36, 36],
              iconAnchor: [18, 36],
            }),
          })
          .on('click', () => select.current(restaurant.id))
          .addTo(current.layer);
        markers.current.set(restaurant.id, marker);
      }
      if (!current.fitted && items.length) {
        current.map.fitBounds(
          current.leaflet.latLngBounds(items.map((r) => [r.latitude, r.longitude])),
          { padding: [70, 70], maxZoom: 13 },
        );
        current.fitted = true;
      }
      highlight();
    };
    draw();
    const node = element.current;
    node?.addEventListener('atlas:map-ready', draw);
    return () => node?.removeEventListener('atlas:map-ready', draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` captures the marker inputs.
  }, [signature]);

  const highlight = () => {
    for (const [id, marker] of markers.current) {
      marker
        .getElement()
        ?.querySelector('.marker')
        ?.classList.toggle('is-selected', id === selectedId);
    }
  };
  useEffect(() => {
    highlight();
    const marker = selectedId && markers.current.get(selectedId);
    if (marker && map.current)
      map.current.map.setView(marker.getLatLng(), Math.max(map.current.map.getZoom(), 13), {
        animate: false,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return <div ref={element} className="map-canvas" aria-label="Map of saved restaurants" />;
}

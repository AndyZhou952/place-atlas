import type * as Leaflet from 'leaflet';

import type { AtlasMapAdapter, MapItem } from './map-adapter';
import { atlasTileProvider } from './map-config';
import { buildMarkerPlan, markerDiff } from './map-marker-plan';

interface MarkerEntry {
  readonly marker: Leaflet.Marker;
  readonly signature: string;
}

export class LeafletMapAdapter implements AtlasMapAdapter {
  private readonly map: Leaflet.Map;
  private readonly layer: Leaflet.LayerGroup;
  private readonly markers = new Map<string, MarkerEntry>();
  private readonly items = new Map<string, MapItem>();
  private fitted = false;
  private selectionInitialized = false;
  private selectedId = '';

  constructor(
    private readonly leaflet: typeof import('leaflet'),
    element: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {
    this.map = leaflet.map(element, {
      attributionControl: true,
      fadeAnimation: false,
      zoomControl: false,
    });
    leaflet
      .tileLayer(atlasTileProvider.url, {
        attribution: atlasTileProvider.attribution,
        keepBuffer: atlasTileProvider.keepBuffer,
        maxZoom: atlasTileProvider.maxZoom,
      })
      .addTo(this.map);
    leaflet.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.layer = leaflet.layerGroup().addTo(this.map);
    this.map.setView([35.6812, 139.7671], 11);
  }

  setItems(items: readonly MapItem[]): void {
    const plan = buildMarkerPlan(items);
    const currentSignatures = new Map(
      [...this.markers].map(([id, entry]) => [id, entry.signature]),
    );
    const diff = markerDiff(currentSignatures, plan);
    const upsertIds = new Set(diff.upsert.map((entry) => entry.item.id));

    for (const id of [...diff.remove, ...upsertIds]) {
      const entry = this.markers.get(id);
      if (entry) this.layer.removeLayer(entry.marker);
      this.markers.delete(id);
    }
    this.items.clear();
    for (const item of items) this.items.set(item.id, item);

    for (const entry of diff.upsert) {
      const position: Leaflet.LatLngExpression = [
        entry.latitude,
        entry.longitude,
      ];
      const marker = this.leaflet.marker(position, {
        icon: this.leaflet.divIcon({
          className: 'atlas-map-marker-shell',
          html: `<span class="atlas-map-marker marker-${entry.item.kind}"><b>${markerGlyph(entry.item.kind)}</b></span>`,
          iconAnchor: [18, 36],
          iconSize: [36, 36],
        }),
        keyboard: true,
        title: entry.item.title,
      });
      const tooltip = document.createElement('span');
      tooltip.className = 'atlas-map-tooltip';
      tooltip.textContent = entry.item.title;
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -28] });
      marker.on('click', () => this.onSelect(entry.item.id));
      marker.addTo(this.layer);
      this.markers.set(entry.item.id, {
        marker,
        signature: entry.signature,
      });
    }

    if (!this.fitted && plan.length) {
      this.map.fitBounds(
        this.leaflet.latLngBounds(
          plan.map((entry) => [entry.latitude, entry.longitude]),
        ),
        { padding: [70, 70], maxZoom: 13 },
      );
      this.fitted = true;
    }
    this.paintSelection();
  }

  setSelected(id: string): void {
    const changed = this.selectedId !== id;
    this.selectedId = id;
    this.paintSelection();
    const item = this.items.get(id);
    if (changed && this.selectionInitialized && item) {
      this.map.setView(
        [item.latitude, item.longitude],
        Math.max(this.map.getZoom(), 13),
        { animate: false },
      );
    }
    this.selectionInitialized = true;
  }

  resize(): void {
    this.map.invalidateSize({ animate: false, debounceMoveend: true });
  }

  destroy(): void {
    this.map.remove();
    this.markers.clear();
    this.items.clear();
  }

  private paintSelection(): void {
    for (const [id, entry] of this.markers) {
      entry.marker
        .getElement()
        ?.querySelector('.atlas-map-marker')
        ?.classList.toggle('is-selected', id === this.selectedId);
    }
  }
}

function markerGlyph(kind: MapItem['kind']): string {
  if (kind === 'food') return '食';
  if (kind === 'event') return '日';
  return '建';
}

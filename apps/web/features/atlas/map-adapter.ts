import type { AtlasItem } from './model';

export type MapItem = Pick<
  AtlasItem,
  'id' | 'kind' | 'title' | 'latitude' | 'longitude'
>;

export interface AtlasMapAdapter {
  setItems(items: readonly MapItem[]): void;
  setSelected(id: string): void;
  resize(): void;
  destroy(): void;
}

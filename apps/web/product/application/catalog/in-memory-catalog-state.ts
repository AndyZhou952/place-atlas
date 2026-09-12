import type {
  CatalogRecordState,
  CatalogStateSnapshot,
} from './catalog-state.ts';
import type { AtlasItem } from './atlas-item.ts';
import { isAtlasItem } from './catalog-projection.ts';

const emptySnapshot: CatalogStateSnapshot = {
  dynamicPayloads: [],
  overrides: [],
  assessments: [],
  tombstoneIds: [],
  visitCounts: [],
};

export class InMemoryCatalogState implements CatalogRecordState {
  private snapshot: CatalogStateSnapshot;

  constructor(snapshot: CatalogStateSnapshot = emptySnapshot) {
    this.snapshot = structuredClone(snapshot);
  }

  async readSnapshot(): Promise<CatalogStateSnapshot> {
    return structuredClone(this.snapshot);
  }

  async saveDynamicItem(item: AtlasItem, storedAt: string): Promise<void> {
    const otherPayloads = this.snapshot.dynamicPayloads.filter((payload) => {
      try {
        const candidate: unknown = JSON.parse(payload);
        return !isAtlasItem(candidate) || candidate.id !== item.id;
      } catch {
        return true;
      }
    });
    this.snapshot = {
      ...this.snapshot,
      dynamicPayloads: [
        ...otherPayloads,
        JSON.stringify({ ...item, updatedAt: storedAt }),
      ],
    };
  }

  async saveOverride(
    override: CatalogStateSnapshot['overrides'][number],
  ): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      overrides: [
        ...this.snapshot.overrides.filter(
          (existing) => existing.itemId !== override.itemId,
        ),
        override,
      ],
    };
  }
}

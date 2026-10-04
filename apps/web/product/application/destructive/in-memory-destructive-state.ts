import type { PlaceAssessment } from '../assessments/place-assessment.ts';
import type { AtlasItemOverrideRecord } from '../catalog/catalog-state.ts';
import type {
  DestructiveItemContext,
  DestructiveRecordState,
} from './destructive-state.ts';

interface DeletionVisitRecord {
  readonly id: string;
  readonly itemId: string;
}

interface DeletionMediaRecord {
  readonly visitId: string;
  readonly itemId: string;
  readonly objectKey: string;
}

interface InMemoryDestructiveInitialState {
  readonly dynamicPayloads?: readonly string[];
  readonly overrides?: readonly AtlasItemOverrideRecord[];
  readonly assessments?: readonly PlaceAssessment[];
  readonly visits?: readonly DeletionVisitRecord[];
  readonly media?: readonly DeletionMediaRecord[];
  readonly tombstoneIds?: readonly string[];
}

export class InMemoryDestructiveState implements DestructiveRecordState {
  private dynamicPayloads: string[];
  private overrides: AtlasItemOverrideRecord[];
  private assessments: PlaceAssessment[];
  private visits: DeletionVisitRecord[];
  private media: DeletionMediaRecord[];
  private tombstoneIds: string[];

  constructor(initial: InMemoryDestructiveInitialState = {}) {
    this.dynamicPayloads = [...(initial.dynamicPayloads ?? [])];
    this.overrides = structuredClone([...(initial.overrides ?? [])]);
    this.assessments = structuredClone([...(initial.assessments ?? [])]);
    this.visits = structuredClone([...(initial.visits ?? [])]);
    this.media = structuredClone([...(initial.media ?? [])]);
    this.tombstoneIds = [...(initial.tombstoneIds ?? [])];
  }

  async readVisitDeletion(
    id: string,
  ): Promise<DestructiveItemContext | undefined> {
    const visit = this.visits.find((candidate) => candidate.id === id);
    return visit ? this.itemContext(visit.itemId, id) : undefined;
  }

  async commitVisitDeletion(id: string): Promise<void> {
    this.visits = this.visits.filter((visit) => visit.id !== id);
    this.media = this.media.filter((record) => record.visitId !== id);
  }

  async readItemDeletion(id: string): Promise<DestructiveItemContext> {
    return this.itemContext(id);
  }

  async commitItemDeletion(id: string): Promise<void> {
    this.dynamicPayloads = this.dynamicPayloads.filter(
      (payload) => dynamicItemId(payload) !== id,
    );
    this.overrides = this.overrides.filter(
      (override) => override.itemId !== id,
    );
    this.assessments = this.assessments.filter(
      (assessment) => assessment.itemId !== id,
    );
    this.visits = this.visits.filter((visit) => visit.itemId !== id);
    this.media = this.media.filter((record) => record.itemId !== id);
    if (!this.tombstoneIds.includes(id)) this.tombstoneIds.push(id);
  }

  snapshot(): Required<InMemoryDestructiveInitialState> {
    return structuredClone({
      dynamicPayloads: this.dynamicPayloads,
      overrides: this.overrides,
      assessments: this.assessments,
      visits: this.visits,
      media: this.media,
      tombstoneIds: this.tombstoneIds,
    });
  }

  private itemContext(
    itemId: string,
    visitId?: string,
  ): DestructiveItemContext {
    return {
      itemId,
      dynamicPayload: this.dynamicPayloads.find(
        (payload) => dynamicItemId(payload) === itemId,
      ),
      override: structuredClone(
        this.overrides.find((override) => override.itemId === itemId),
      ),
      assessment: structuredClone(
        this.assessments.find((assessment) => assessment.itemId === itemId),
      ),
      tombstoned: this.tombstoneIds.includes(itemId),
      visitCount: this.visits.filter((visit) => visit.itemId === itemId).length,
      mediaObjectKeys: this.media
        .filter(
          (record) =>
            record.itemId === itemId &&
            (visitId === undefined || record.visitId === visitId),
        )
        .map((record) => record.objectKey),
    };
  }
}

function dynamicItemId(payload: string): string | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const id = Reflect.get(value, 'id');
      return typeof id === 'string' ? id : undefined;
    }
  } catch {
    // Malformed stored candidates are ignored consistently with Catalog.
  }
  return undefined;
}

import type {
  CatalogRecordState,
  CatalogStateSnapshot,
} from '../catalog/catalog-state.ts';
import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { PlaceAssessment } from './place-assessment.ts';
import type {
  PlaceAssessmentContext,
  PlaceAssessmentRecordState,
} from './place-assessment-state.ts';

type InitialState = Partial<
  Pick<
    CatalogStateSnapshot,
    'dynamicPayloads' | 'overrides' | 'tombstoneIds' | 'visitCounts'
  >
> & {
  readonly assessments?: readonly PlaceAssessment[];
};

export class InMemoryPlaceAssessmentState
  implements PlaceAssessmentRecordState, CatalogRecordState
{
  private snapshot: Omit<CatalogStateSnapshot, 'assessments'>;
  private assessments: PlaceAssessment[];

  constructor(initial: InitialState = {}) {
    this.snapshot = {
      dynamicPayloads: initial.dynamicPayloads ?? [],
      overrides: initial.overrides ?? [],
      tombstoneIds: initial.tombstoneIds ?? [],
      visitCounts: initial.visitCounts ?? [],
    };
    this.assessments = structuredClone([...(initial.assessments ?? [])]);
  }

  async read(itemId: string): Promise<PlaceAssessmentContext> {
    return {
      assessment: structuredClone(
        this.assessments.find((assessment) => assessment.itemId === itemId),
      ),
      visitCount:
        this.snapshot.visitCounts.find(
          (visitCount) => visitCount.itemId === itemId,
        )?.count ?? 0,
    };
  }

  async save(assessment: PlaceAssessment): Promise<void> {
    this.assessments = [
      ...this.assessments.filter(
        (candidate) => candidate.itemId !== assessment.itemId,
      ),
      structuredClone(assessment),
    ];
  }

  async readSnapshot(): Promise<CatalogStateSnapshot> {
    return structuredClone({
      ...this.snapshot,
      assessments: this.assessments.map((assessment) => ({
        itemId: assessment.itemId,
        overallRating: assessment.overallRating,
        isFavorite: assessment.isFavorite,
        manualVisited: assessment.manualVisited,
      })),
    });
  }

  async saveDynamicItem(item: AtlasItem, storedAt: string): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      dynamicPayloads: [
        ...this.snapshot.dynamicPayloads.filter((payload) => {
          try {
            return JSON.parse(payload)?.id !== item.id;
          } catch {
            return true;
          }
        }),
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
          (candidate) => candidate.itemId !== override.itemId,
        ),
        override,
      ],
    };
  }
}

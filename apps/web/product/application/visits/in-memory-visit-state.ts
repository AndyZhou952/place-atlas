import type { PlaceAssessment } from '../assessments/place-assessment.ts';
import type { AtlasItemOverrideRecord } from '../catalog/catalog-state.ts';
import type { Visit } from './visit.ts';
import type {
  CreateVisitRecords,
  UpdateVisitRecords,
  VisitItemRecordContext,
  VisitMutationContext,
  VisitRecordState,
} from './visit-state.ts';

interface InMemoryVisitInitialState {
  readonly visits?: readonly Visit[];
  readonly assessments?: readonly PlaceAssessment[];
  readonly dynamicPayloads?: readonly string[];
  readonly overrides?: readonly AtlasItemOverrideRecord[];
  readonly tombstoneIds?: readonly string[];
}

export class InMemoryVisitState implements VisitRecordState {
  private visits: Visit[];
  private assessments: PlaceAssessment[];
  readonly #dynamicPayloads: readonly string[];
  readonly #overrides: readonly AtlasItemOverrideRecord[];
  readonly #tombstoneIds: ReadonlySet<string>;

  constructor(initial: InMemoryVisitInitialState = {}) {
    this.visits = structuredClone([...(initial.visits ?? [])]);
    this.assessments = structuredClone([...(initial.assessments ?? [])]);
    this.#dynamicPayloads = initial.dynamicPayloads ?? [];
    this.#overrides = initial.overrides ?? [];
    this.#tombstoneIds = new Set(initial.tombstoneIds ?? []);
  }

  async list(): Promise<readonly Visit[]> {
    return structuredClone(this.visits);
  }

  async readItemContext(itemId: string): Promise<VisitItemRecordContext> {
    return this.itemContext(itemId);
  }

  async readVisitContext(
    id: string,
  ): Promise<VisitMutationContext | undefined> {
    const visit = this.visits.find((candidate) => candidate.id === id);
    return visit
      ? { ...this.itemContext(visit.itemId), visit: structuredClone(visit) }
      : undefined;
  }

  async create({ visit, assessment }: CreateVisitRecords) {
    const inserted = !this.visits.some(
      (candidate) => candidate.id === visit.id,
    );
    if (inserted) this.visits.push(structuredClone(visit));
    if (assessment) this.saveAssessment(assessment);
    return { inserted };
  }

  async update({ visit, assessment }: UpdateVisitRecords): Promise<void> {
    const index = this.visits.findIndex(
      (candidate) => candidate.id === visit.id,
    );
    if (index >= 0) this.visits[index] = structuredClone(visit);
    if (assessment) this.saveAssessment(assessment);
  }

  private itemContext(itemId: string): VisitItemRecordContext {
    return {
      itemId,
      dynamicPayload: this.#dynamicPayloads.find((payload) => {
        try {
          return JSON.parse(payload)?.id === itemId;
        } catch {
          return false;
        }
      }),
      override: structuredClone(
        this.#overrides.find((override) => override.itemId === itemId),
      ),
      assessment: structuredClone(
        this.assessments.find((assessment) => assessment.itemId === itemId),
      ),
      tombstoned: this.#tombstoneIds.has(itemId),
      visitCount: this.visits.filter((visit) => visit.itemId === itemId).length,
    };
  }

  private saveAssessment(assessment: PlaceAssessment): void {
    this.assessments = [
      ...this.assessments.filter(
        (candidate) => candidate.itemId !== assessment.itemId,
      ),
      structuredClone(assessment),
    ];
  }
}

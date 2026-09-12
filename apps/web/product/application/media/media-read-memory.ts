import type {
  MediaObjectStore,
  StoredMediaObject,
} from './media-object-store.ts';
import type { VisitMediaRecordState } from './media-state.ts';
import type { VisitMediaFilters, VisitMediaMetadata } from './visit-media.ts';

export class InMemoryVisitMediaState implements VisitMediaRecordState {
  readonly #records: VisitMediaMetadata[];
  readonly #visits: ReadonlyMap<
    string,
    { readonly itemId: string; readonly nextDisplayOrder?: number }
  >;

  constructor(
    records: readonly VisitMediaMetadata[] = [],
    visits: ReadonlyMap<
      string,
      { readonly itemId: string; readonly nextDisplayOrder?: number }
    > = new Map(),
  ) {
    this.#records = [...records];
    this.#visits = visits;
  }

  async list(filters: VisitMediaFilters) {
    return this.#records
      .filter(
        (record) =>
          (!filters.visitId || record.visitId === filters.visitId) &&
          (!filters.itemId || record.itemId === filters.itemId),
      )
      .toSorted(compareVisitMedia);
  }

  async find(id: string) {
    return this.#records.find((record) => record.id === id);
  }

  async getVisitContext(visitId: string) {
    const visit = this.#visits.get(visitId);
    if (!visit) return undefined;
    const existingOrders = this.#records
      .filter((record) => record.visitId === visitId)
      .map((record) => record.displayOrder);
    return {
      itemId: visit.itemId,
      nextDisplayOrder:
        visit.nextDisplayOrder ??
        (existingOrders.length ? Math.max(...existingOrders) + 1 : 0),
    };
  }

  async insert(records: readonly VisitMediaMetadata[]) {
    this.#records.push(...records);
  }

  async updateCaption(
    id: string,
    caption: string | undefined,
    updatedAt: string,
  ) {
    const index = this.#records.findIndex((record) => record.id === id);
    if (index < 0) return undefined;
    const updated = { ...this.#records[index], caption, updatedAt };
    this.#records[index] = updated;
    return updated;
  }

  async delete(id: string) {
    const index = this.#records.findIndex((record) => record.id === id);
    if (index < 0) return undefined;
    return this.#records.splice(index, 1)[0];
  }
}

export class InMemoryMediaObjectStore implements MediaObjectStore {
  readonly #objects: Map<string, StoredMediaObject>;
  readonly #written = new Map<string, Uint8Array>();

  constructor(objects: ReadonlyMap<string, StoredMediaObject> = new Map()) {
    this.#objects = new Map(objects);
  }

  async get(objectKey: string) {
    const bytes = this.#written.get(objectKey);
    if (bytes) {
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      };
    }
    return this.#objects.get(objectKey);
  }

  async put(object: {
    readonly objectKey: string;
    readonly bytes: Uint8Array;
  }) {
    this.#written.set(object.objectKey, Uint8Array.from(object.bytes));
  }

  async delete(objectKey: string) {
    this.#written.delete(objectKey);
    this.#objects.delete(objectKey);
  }
}

function compareVisitMedia(
  left: VisitMediaMetadata,
  right: VisitMediaMetadata,
) {
  return (
    left.visitId.localeCompare(right.visitId) ||
    left.displayOrder - right.displayOrder ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

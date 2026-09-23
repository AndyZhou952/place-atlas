import {
  defineOperationGroup,
  type MediaContent,
  type OperationDefinition,
} from '../atlas-application.ts';
import { failure, success, type Result } from '../result.ts';
import type { MediaObjectStore } from './media-object-store.ts';
import type { VisitMediaRecordState } from './media-state.ts';
import type {
  VisitMedia,
  VisitMediaFilters,
  VisitMediaMetadata,
} from './visit-media.ts';
import {
  type PublicDisplayAccess,
  unavailablePublicDisplayAccess,
} from '../public-display/public-display-access.ts';

export interface VisitMediaUpload {
  readonly id?: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly caption?: string | null;
}

export interface AttachVisitMediaInput {
  readonly visitId: string;
  readonly uploads: readonly VisitMediaUpload[];
}

export interface UpdateVisitMediaCaptionInput {
  readonly id: string;
  readonly caption?: string | null;
}

export interface DeleteVisitMediaOutput {
  readonly id: string;
  readonly deleted: true;
}

export interface MediaDependencies {
  readonly clock: { now(): string };
  readonly idSource: { nextId(): string };
  readonly displayIdSource?: { nextId(): string };
  readonly digest: (bytes: Uint8Array) => Promise<string>;
}

const allowedImageContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
const maxVisitMediaBytes = 8 * 1024 * 1024;
const maxVisitMediaCaptionLength = 160;

export function createMediaOperationGroup(
  state: VisitMediaRecordState,
  objects: MediaObjectStore,
  dependencies: MediaDependencies,
  publicDisplayAccess: PublicDisplayAccess = unavailablePublicDisplayAccess,
) {
  const listVisitMedia: OperationDefinition<
    'media.list',
    VisitMediaFilters,
    readonly VisitMedia[],
    'json'
  > = {
    descriptor: {
      key: 'media.list',
      resultKind: 'json',
      effect: 'read',
      validate: validateMediaFilters,
    },
    async handle(filters) {
      try {
        const records = await state.list(filters);
        return success(records.map(toVisitMedia));
      } catch {
        return failure(
          'dependency_failure',
          'Visit photos are temporarily unavailable.',
        );
      }
    },
  };

  const openVisitMedia: OperationDefinition<
    'media.open',
    { readonly id: string },
    MediaContent,
    'media_stream'
  > = {
    descriptor: {
      key: 'media.open',
      resultKind: 'media_stream',
      effect: 'read',
      validate: validateMediaId,
    },
    async handle({ id }) {
      try {
        const metadata = await state.find(id);
        if (!metadata) return failure('not_found', 'Photo not found.');
        const object = await objects.get(metadata.objectKey);
        if (!object) {
          return failure(
            'dependency_failure',
            'Photo content is temporarily unavailable.',
          );
        }
        return success({
          body: sanitizeMediaBody(object.body),
          contentType: metadata.contentType,
          byteSize: metadata.byteSize,
          etag: object.etag,
        });
      } catch {
        return failure(
          'dependency_failure',
          'Photo content is temporarily unavailable.',
        );
      }
    },
  };

  const openDisplayMedia: OperationDefinition<
    'media.openDisplay',
    { readonly displayId: string },
    MediaContent,
    'media_stream'
  > = {
    descriptor: {
      key: 'media.openDisplay',
      resultKind: 'media_stream',
      effect: 'read',
      validate: validateDisplayMediaId,
    },
    async handle({ displayId }) {
      try {
        const metadata = await state.findByDisplayId(displayId);
        if (
          !metadata ||
          !(await publicDisplayAccess.allowsItem(metadata.itemId))
        ) {
          return failure('not_found', 'Photo not found.');
        }
        const object = await objects.get(metadata.objectKey);
        if (!object) {
          return failure(
            'dependency_failure',
            'Photo content is temporarily unavailable.',
          );
        }
        return success({
          body: sanitizeMediaBody(object.body),
          contentType: metadata.contentType,
          byteSize: metadata.byteSize,
        });
      } catch {
        return failure(
          'dependency_failure',
          'Photo content is temporarily unavailable.',
        );
      }
    },
  };

  const attachVisitMedia: OperationDefinition<
    'media.attach',
    AttachVisitMediaInput,
    readonly VisitMedia[],
    'json'
  > = {
    descriptor: {
      key: 'media.attach',
      resultKind: 'json',
      effect: 'write',
      validate: validateAttachInput,
    },
    async handle({ visitId, uploads }, execution) {
      try {
        const context = await state.getVisitContext(visitId);
        if (!context) return failure('not_found', 'Journal entry not found.');
        const now = dependencies.clock.now();
        const results = await Promise.allSettled(
          uploads.map(async (upload, index) => {
            assertAllowedImage(upload.contentType, upload.bytes);
            const id = upload.id ?? dependencies.idSource.nextId();
            const displayId = createDisplayId(dependencies.displayIdSource);
            const contentSha256 = await dependencies.digest(upload.bytes);
            const objectKey = `visits/${visitId}/${id}`;
            const metadata: VisitMediaMetadata = {
              id,
              displayId,
              visitId,
              itemId: context.itemId,
              objectKey,
              originalFilename: upload.originalFilename || 'image',
              contentType: upload.contentType,
              byteSize: upload.bytes.byteLength,
              contentSha256,
              caption: normalizeCaption(upload.caption),
              displayOrder: context.nextDisplayOrder + index,
              createdAt: now,
              updatedAt: now,
            };
            await objects.put({
              objectKey,
              bytes: upload.bytes,
              contentType: upload.contentType,
              mediaId: id,
              visitId,
              contentSha256,
            });
            return metadata;
          }),
        );
        const prepared = fulfilledValues(results);
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        if (failed) {
          await cleanupStoredObjects(objects, prepared);
          return failed.reason instanceof MediaInputError
            ? failure('invalid_input', failed.reason.message)
            : failure('dependency_failure', 'Visit photos could not be saved.');
        }
        try {
          const output = prepared.map(toVisitMedia);
          await state.insert(
            prepared,
            execution?.atomicMutation?.receiptFor(output),
          );
        } catch {
          await cleanupStoredObjects(objects, prepared);
          return failure(
            'dependency_failure',
            'Visit photos could not be saved.',
          );
        }
        return success(prepared.map(toVisitMedia));
      } catch {
        return failure(
          'dependency_failure',
          'Visit photos could not be saved.',
        );
      }
    },
  };

  const updateVisitMediaCaption: OperationDefinition<
    'media.caption',
    UpdateVisitMediaCaptionInput,
    VisitMedia,
    'json'
  > = {
    descriptor: {
      key: 'media.caption',
      resultKind: 'json',
      effect: 'write',
      validate: validateCaptionInput,
    },
    async handle({ id, caption: value }, execution) {
      let caption: string | undefined;
      try {
        caption = normalizeCaption(value);
      } catch (error) {
        return failure(
          'invalid_input',
          error instanceof MediaInputError
            ? error.message
            : 'Caption must be text.',
        );
      }
      try {
        if (!execution?.atomicMutation) {
          let metadata = await state.updateCaption(
            id,
            caption,
            dependencies.clock.now(),
          );
          if (!metadata) {
            const displayRecord = await state.findByDisplayId(id);
            if (displayRecord) {
              metadata = await state.updateCaption(
                displayRecord.id,
                caption,
                dependencies.clock.now(),
              );
            }
          }
          return metadata
            ? success(toVisitMedia(metadata))
            : failure('not_found', 'Photo not found.');
        }
        const directRecord = await state.find(id);
        const displayRecord = directRecord
          ? undefined
          : await state.findByDisplayId(id);
        const current = directRecord ?? displayRecord;
        if (!current) return failure('not_found', 'Photo not found.');
        const updatedAt = dependencies.clock.now();
        const output = toVisitMedia({ ...current, caption, updatedAt });
        const metadata = await state.updateCaption(
          current.id,
          caption,
          updatedAt,
          execution?.atomicMutation?.receiptFor(output),
        );
        return metadata
          ? success(output)
          : failure('not_found', 'Photo not found.');
      } catch {
        return failure(
          'dependency_failure',
          'The photo caption could not be updated.',
        );
      }
    },
  };

  const deleteVisitMedia: OperationDefinition<
    'media.delete',
    { readonly id: string },
    DeleteVisitMediaOutput,
    'json'
  > = {
    descriptor: {
      key: 'media.delete',
      resultKind: 'json',
      effect: 'destructive',
      validate: validateMediaId,
    },
    async handle({ id }, execution) {
      let metadata: VisitMediaMetadata | undefined;
      try {
        if (!execution?.atomicMutation) {
          metadata = await state.delete(id);
          if (!metadata) {
            const displayRecord = await state.findByDisplayId(id);
            if (displayRecord) metadata = await state.delete(displayRecord.id);
          }
        } else {
          const directRecord = await state.find(id);
          const displayRecord = directRecord
            ? undefined
            : await state.findByDisplayId(id);
          const current = directRecord ?? displayRecord;
          if (!current) return failure('not_found', 'Photo not found.');
          const output = { id: current.id, deleted: true as const };
          metadata = await state.delete(
            current.id,
            execution.atomicMutation.receiptFor(output),
          );
        }
      } catch {
        return failure('dependency_failure', 'The photo could not be deleted.');
      }
      if (!metadata) return failure('not_found', 'Photo not found.');
      try {
        await objects.delete(metadata.objectKey);
        return success({ id: metadata.id, deleted: true });
      } catch {
        if (execution?.atomicMutation) {
          return success({ id: metadata.id, deleted: true });
        }
        return failure('dependency_failure', 'The photo could not be deleted.');
      }
    },
  };

  return defineOperationGroup({
    'media.list': listVisitMedia,
    'media.open': openVisitMedia,
    'media.openDisplay': openDisplayMedia,
    'media.attach': attachVisitMedia,
    'media.caption': updateVisitMediaCaption,
    'media.delete': deleteVisitMedia,
  });
}

function validateAttachInput(input: unknown): Result<AttachVisitMediaInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure(
      'invalid_input',
      'A Visit and at least one image are required.',
    );
  }
  const visitId = Reflect.get(input, 'visitId');
  const uploads = Reflect.get(input, 'uploads');
  if (
    typeof visitId !== 'string' ||
    !visitId ||
    !Array.isArray(uploads) ||
    !uploads.length ||
    !uploads.every(isVisitMediaUpload)
  ) {
    return failure(
      'invalid_input',
      'A Visit and at least one image are required.',
    );
  }
  return success({ visitId, uploads });
}

function isVisitMediaUpload(value: unknown): value is VisitMediaUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const id = Reflect.get(value, 'id');
  const originalFilename = Reflect.get(value, 'originalFilename');
  const contentType = Reflect.get(value, 'contentType');
  const bytes = Reflect.get(value, 'bytes');
  const caption = Reflect.get(value, 'caption');
  return (
    (id === undefined || typeof id === 'string') &&
    typeof originalFilename === 'string' &&
    typeof contentType === 'string' &&
    bytes instanceof Uint8Array &&
    (caption === undefined || caption === null || typeof caption === 'string')
  );
}

function validateCaptionInput(
  input: unknown,
): Result<UpdateVisitMediaCaptionInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_input', 'Caption must be text.');
  }
  const id = Reflect.get(input, 'id');
  const caption = Reflect.get(input, 'caption');
  if (
    typeof id !== 'string' ||
    !id ||
    (caption !== undefined && caption !== null && typeof caption !== 'string')
  ) {
    return failure('invalid_input', 'Caption must be text.');
  }
  return success({ id, caption });
}

function assertAllowedImage(contentType: string, bytes: Uint8Array): void {
  if (!allowedImageContentTypes.some((allowed) => allowed === contentType)) {
    throw new MediaInputError('Use a JPEG, PNG, WebP, or GIF image.');
  }
  if (!bytes.byteLength || bytes.byteLength > maxVisitMediaBytes) {
    throw new MediaInputError('Each image must be between 1 byte and 8 MB.');
  }
  if (!hasMatchingImageSignature(contentType, bytes)) {
    throw new MediaInputError('The file contents do not match the image type.');
  }
}

function hasMatchingImageSignature(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (contentType === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
  }
  return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function normalizeCaption(
  value: string | null | undefined,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const caption = value.trim().replace(/\s+/g, ' ');
  if (caption.length > maxVisitMediaCaptionLength) {
    throw new MediaInputError(
      `Caption must be ${maxVisitMediaCaptionLength} characters or fewer.`,
    );
  }
  return caption || undefined;
}

function fulfilledValues<T>(results: readonly PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
}

async function cleanupStoredObjects(
  objects: MediaObjectStore,
  records: readonly VisitMediaMetadata[],
): Promise<void> {
  await Promise.allSettled(
    records.map(async (record) => objects.delete(record.objectKey)),
  );
}

class MediaInputError extends Error {}

function validateMediaFilters(input: unknown): Result<VisitMediaFilters> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_input', 'Photo filters must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  if (
    !Object.keys(candidate).every(
      (key) => key === 'visitId' || key === 'itemId',
    )
  ) {
    return failure('invalid_input', 'Photo filters are invalid.');
  }
  const visitId = candidate.visitId;
  const itemId = candidate.itemId;
  if (
    (visitId !== undefined && (typeof visitId !== 'string' || !visitId)) ||
    (itemId !== undefined && (typeof itemId !== 'string' || !itemId))
  ) {
    return failure('invalid_input', 'Photo filters are invalid.');
  }
  return success({ visitId, itemId });
}

function validateMediaId(input: unknown): Result<{ readonly id: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1
  ) {
    return failure('invalid_input', 'A photo ID is required.');
  }
  const id = Reflect.get(input, 'id');
  if (typeof id !== 'string' || !id) {
    return failure('invalid_input', 'A photo ID is required.');
  }
  return success({ id });
}
function validateDisplayMediaId(
  input: unknown,
): Result<{ readonly displayId: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1
  ) {
    return failure('invalid_input', 'A photo display ID is required.');
  }
  const displayId = Reflect.get(input, 'displayId');
  if (
    typeof displayId !== 'string' ||
    !/^pm_[A-Za-z0-9_-]+$/u.test(displayId)
  ) {
    return failure('invalid_input', 'A photo display ID is required.');
  }
  return success({ displayId });
}

function createDisplayId(source?: { nextId(): string }): string {
  const token = (source?.nextId() ?? crypto.randomUUID()).trim();
  if (!/^[A-Za-z0-9-]{8,128}$/u.test(token)) {
    throw new MediaInputError(
      'A secure photo display ID could not be created.',
    );
  }
  return `pm_${token}`;
}

function toVisitMedia({
  objectKey: _objectKey,
  displayId: _displayId,
  ...record
}: VisitMediaMetadata): VisitMedia {
  return {
    ...record,
    contentUrl: `/api/media/${encodeURIComponent(record.id)}/content`,
  };
}

function sanitizeMediaBody(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let finished = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // A concurrent cancellation may already have released the source.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          finished = true;
          release();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch {
        if (finished) return;
        finished = true;
        release();
        controller.error(new Error('The photo stream could not be read.'));
      }
    },
    async cancel() {
      if (finished) return;
      finished = true;
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best-effort and must not expose storage failures.
      } finally {
        release();
      }
    },
  });
}

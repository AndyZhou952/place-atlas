import {
  defineOperationGroup,
  type AtomicMutationCommit,
  type OperationDefinition,
} from '../atlas-application.ts';
import { failure, success, type Result } from '../result.ts';
import type { CatalogRead } from './catalog-read.ts';
import { isAtlasItem } from './catalog-projection.ts';
import { ratingPlaceId } from '../../../agent/google-rating-policy.ts';

export interface GoogleRatingReference {
  readonly itemId: string;
  readonly placeId: string;
  readonly score: number;
  readonly reviewCount?: number;
  readonly url: string;
  readonly observedAt: string;
  readonly capturedAt: string;
  readonly source: 'google_places_api';
}
export type SaveGoogleRatingReference = Omit<
  GoogleRatingReference,
  'capturedAt' | 'source'
>;
export interface GoogleRatingReferenceState {
  list(): Promise<readonly GoogleRatingReference[]>;
  save(
    reference: GoogleRatingReference,
    commit?: AtomicMutationCommit,
  ): Promise<void>;
}

export function validateGoogleRatingReference(
  input: unknown,
): Result<SaveGoogleRatingReference> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return failure('invalid_input', 'A Google rating reference is required.');
  const value = input as Record<string, unknown>;
  if (
    typeof value.itemId !== 'string' ||
    !value.itemId.trim() ||
    value.itemId.length > 500 ||
    typeof value.placeId !== 'string' ||
    !/^[A-Za-z0-9_-]{10,500}$/u.test(value.placeId) ||
    typeof value.score !== 'number' ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 5 ||
    (value.reviewCount !== undefined &&
      (typeof value.reviewCount !== 'number' ||
        !Number.isSafeInteger(value.reviewCount) ||
        value.reviewCount < 0)) ||
    typeof value.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    typeof value.url !== 'string' ||
    value.url.length > 2000
  )
    return failure(
      'invalid_input',
      'A valid score, source and observation date are required.',
    );
  try {
    const url = new URL(value.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['www.google.com', 'maps.google.com', 'maps.app.goo.gl'].includes(
        url.hostname,
      )
    )
      return failure('invalid_input', 'A Google Maps source link is required.');
  } catch {
    return failure('invalid_input', 'A Google Maps source link is required.');
  }
  return success({
    itemId: value.itemId,
    placeId: value.placeId,
    score: value.score,
    url: value.url,
    observedAt: new Date(value.observedAt).toISOString(),
    ...(value.reviewCount === undefined
      ? {}
      : { reviewCount: value.reviewCount as number }),
  });
}

export function createGoogleRatingReferenceOperationGroup(
  catalog: CatalogRead,
  state: GoogleRatingReferenceState,
  clock: { now(): string },
) {
  const list: OperationDefinition<
    'catalog.google_rating_references',
    Record<string, never>,
    readonly GoogleRatingReference[],
    'json'
  > = {
    descriptor: {
      key: 'catalog.google_rating_references',
      resultKind: 'json',
      effect: 'read',
      validate(input) {
        return input &&
          typeof input === 'object' &&
          !Array.isArray(input) &&
          !Object.keys(input).length
          ? success({})
          : failure('invalid_input', 'No parameters are accepted.');
      },
    },
    async handle() {
      try {
        const items = await catalog.list('full_merged_catalog');
        const eligible = new Map(
          items
            .filter(isAtlasItem)
            .filter((item) => item.verificationStatus === 'verified')
            .map((item) => [item.id, ratingPlaceId(item)]),
        );
        return success(
          (await state.list()).filter(
            (reference) => eligible.get(reference.itemId) === reference.placeId,
          ),
        );
      } catch {
        return failure(
          'dependency_failure',
          'Saved Google references are temporarily unavailable.',
        );
      }
    },
  };
  const save: OperationDefinition<
    'catalog.save_google_rating_reference',
    SaveGoogleRatingReference,
    GoogleRatingReference,
    'json'
  > = {
    descriptor: {
      key: 'catalog.save_google_rating_reference',
      resultKind: 'json',
      effect: 'write',
      validate: validateGoogleRatingReference,
    },
    async handle(input, execution) {
      try {
        const item = await catalog.get(input.itemId);
        if (!item) return failure('not_found', 'Place not found.');
        if (
          !isAtlasItem(item) ||
          item.verificationStatus !== 'verified' ||
          ratingPlaceId(item) !== input.placeId
        )
          return failure(
            'invalid_input',
            'The reference must match the saved place identity.',
          );
        const capturedAt = clock.now();
        if (
          Date.parse(input.observedAt) > Date.parse(capturedAt) ||
          Date.parse(input.observedAt) < Date.UTC(2000, 0, 1)
        )
          return failure(
            'invalid_input',
            'The observation date must be in the past.',
          );
        const reference: GoogleRatingReference = {
          ...input,
          capturedAt,
          source: 'google_places_api',
        };
        await state.save(
          reference,
          execution?.atomicMutation?.receiptFor(reference),
        );
        return success(reference);
      } catch {
        return failure(
          'dependency_failure',
          'The Google rating reference could not be saved.',
        );
      }
    },
  };
  return defineOperationGroup({
    'catalog.google_rating_references': list,
    'catalog.save_google_rating_reference': save,
  });
}

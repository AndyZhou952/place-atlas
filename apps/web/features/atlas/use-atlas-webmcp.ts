'use client';

import { useEffect } from 'react';

import {
  browserAtlasApplication,
  type BrowserAtlasApplication,
} from './atlas-api-client.ts';
import { browserOperationHttpCatalog } from './atlas-browser-operation-catalog.ts';
import type { AtlasItem, AtlasItemEdit } from './model';
import { normalizeRating } from './rating.ts';

export interface ModelContextTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
    readonly destructiveHint?: boolean;
  };
  execute(input: unknown): unknown;
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { readonly signal?: AbortSignal },
  ): void | Promise<void>;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

interface AtlasWebMcpUiActions {
  readonly items: readonly AtlasItem[];
  readonly selectItem: (id: string) => void;
}

interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

interface AtlasWebMcpToolDependencies extends AtlasWebMcpUiActions {
  readonly application: BrowserAtlasApplication;
  readonly getCurrentCoordinates: () => Promise<Coordinates | undefined>;
}

export function useAtlasWebMcp(actions: AtlasWebMcpUiActions): void {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = createAtlasWebMcpTools({
      application: browserAtlasApplication,
      items: actions.items,
      selectItem: actions.selectItem,
      getCurrentCoordinates: readBrowserCoordinates,
    });
    for (const tool of tools) {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => undefined);
    }
    return () => lifecycle.abort();
  }, [actions]);
}

export function createAtlasWebMcpTools({
  application,
  items,
  selectItem,
  getCurrentCoordinates,
}: AtlasWebMcpToolDependencies): readonly ModelContextTool[] {
  return [
    {
      name: 'list_atlas_items',
      title: 'List Japan Atlas items',
      description:
        'Read the verified and review-pending places currently visible to the user.',
      inputSchema: emptyInputSchema(),
      annotations: readAnnotations,
      async execute() {
        const currentItems = await application.execute({
          key: browserOperationHttpCatalog['catalog.list'].key,
          input: { profile: 'full_merged_catalog' },
        });
        return currentItems.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          area: item.area,
          verificationStatus: item.verificationStatus,
          tabelogScore: item.tabelog?.score,
        }));
      },
    },
    {
      name: 'focus_atlas_item',
      title: 'Focus Japan Atlas item',
      description:
        'Select an existing Atlas item and center the visible map on it.',
      inputSchema: objectInputSchema({ id: { type: 'string' } }, ['id']),
      annotations: uiReadAnnotations,
      execute(input) {
        const id = readString(input, 'id');
        const item = items.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Unknown Atlas item: ${id}`);
        selectItem(id);
        return { id, title: item.title, focused: true };
      },
    },
    {
      name: 'update_atlas_item',
      title: 'Update Japan Atlas item',
      description:
        'Persist a user-approved title, description, and personal state for an existing item.',
      inputSchema: objectInputSchema(
        {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          personalState: {
            type: 'string',
            enum: ['candidate', 'saved', 'planned', 'visited'],
          },
        },
        ['id', 'title', 'description', 'personalState'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const id = readString(input, 'id');
        const updated = await application.execute({
          key: browserOperationHttpCatalog['catalog.update_item'].key,
          input: {
            id,
            title: readString(input, 'title'),
            description: readString(input, 'description'),
            personalState: readPersonalState(input),
          },
        });
        return { id: updated.id, title: updated.title, updated: true };
      },
    },
    {
      name: 'update_item_preferences',
      title: 'Update favorite or visited status',
      description:
        'Persist the user-approved favorite and visited status for one Atlas item.',
      inputSchema: objectInputSchema(
        {
          id: { type: 'string' },
          isFavorite: { type: 'boolean' },
          hasVisited: { type: 'boolean' },
        },
        ['id'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const id = readString(input, 'id');
        const values = readRecord(input);
        const updated = await application.execute({
          key: browserOperationHttpCatalog['assessment.update'].key,
          input: {
            itemId: id,
            patch: {
              ...(typeof values.isFavorite === 'boolean'
                ? { isFavorite: values.isFavorite }
                : {}),
              ...(typeof values.hasVisited === 'boolean'
                ? { manualVisited: values.hasVisited }
                : {}),
            },
          },
        });
        return {
          id: updated.id,
          isFavorite: updated.isFavorite,
          hasVisited: updated.hasVisited,
        };
      },
    },
    {
      name: 'set_personal_rating',
      title: 'Set or clear a personal rating',
      description:
        'Persist one optional overall rating from 0 to 5 for an Atlas item. This is separate from individual visits and Tabelog.',
      inputSchema: objectInputSchema(
        {
          id: { type: 'string' },
          rating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
        },
        ['id', 'rating'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const values = readRecord(input);
        const id = readString(input, 'id');
        const rating = values.rating;
        assertRating(rating, true);
        const updated = await application.execute({
          key: browserOperationHttpCatalog['assessment.update'].key,
          input: {
            itemId: id,
            patch: {
              overallRating:
                rating === null ? null : normalizeRating(rating as number),
            },
          },
        });
        return { id: updated.id, rating: updated.personalRating ?? null };
      },
    },
    {
      name: 'create_visit',
      title: 'Create a visit record',
      description:
        'Record a visit to one Atlas item with at least a rating or note. Photos can then be attached through the media operation.',
      inputSchema: objectInputSchema(
        {
          mutationId: { type: 'string' },
          itemId: { type: 'string' },
          visitedAt: { type: 'string' },
          rating: { type: 'number', minimum: 0, maximum: 5 },
          note: { type: 'string' },
        },
        ['itemId', 'visitedAt'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const values = readRecord(input);
        const rating = values.rating;
        if (rating !== undefined) assertRating(rating, false);
        const note = readOptionalString(input, 'note');
        if (rating === undefined && !note) {
          throw new TypeError('a visit requires at least a rating or note');
        }
        return application.execute({
          key: browserOperationHttpCatalog['visit.create'].key,
          input: {
            id: readOptionalString(input, 'mutationId'),
            itemId: readString(input, 'itemId'),
            visitedAt: readString(input, 'visitedAt'),
            ...(rating === undefined
              ? {}
              : { rating: normalizeRating(rating as number) }),
            note,
          },
        });
      },
    },
    {
      name: 'update_visit',
      title: 'Update a visit record',
      description:
        'Correct the date or note on a visit and optionally replace or clear the place’s persistent personal rating.',
      inputSchema: objectInputSchema(
        {
          id: { type: 'string' },
          visitedAt: { type: 'string' },
          rating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
          note: { type: 'string' },
        },
        ['id', 'visitedAt'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const values = readRecord(input);
        const rating = values.rating;
        assertOptionalNullableRating(rating);
        return application.execute({
          key: browserOperationHttpCatalog['visit.update'].key,
          input: {
            id: readString(input, 'id'),
            visitedAt: readString(input, 'visitedAt'),
            note: readOptionalString(input, 'note'),
            ...(rating === undefined
              ? {}
              : {
                  rating:
                    rating === null ? null : normalizeRating(rating as number),
                }),
          },
        });
      },
    },
    {
      name: 'list_visit_media',
      title: 'List Visit photos',
      description:
        'Read public photo display metadata and captions for one Visit. Binary upload uses the scoped media HTTP operation.',
      inputSchema: objectInputSchema({ visitId: { type: 'string' } }, [
        'visitId',
      ]),
      annotations: readAnnotations,
      async execute(input) {
        const currentMedia = await application.execute({
          key: browserOperationHttpCatalog['media.list'].key,
          input: { visitId: readString(input, 'visitId') },
        });
        return currentMedia.map((entry) => ({
          id: entry.id,
          visitId: entry.visitId,
          itemId: entry.itemId,
          originalFilename: entry.originalFilename,
          ...(entry.caption === undefined ? {} : { caption: entry.caption }),
          displayOrder: entry.displayOrder,
          contentUrl: entry.contentUrl,
        }));
      },
    },
    {
      name: 'update_visit_media_caption',
      title: 'Update a Visit photo caption',
      description:
        'Set or clear the optional one-line caption on a private Visit photo.',
      inputSchema: objectInputSchema(
        {
          id: { type: 'string' },
          caption: { type: 'string', maxLength: 160 },
        },
        ['id', 'caption'],
      ),
      annotations: writeAnnotations,
      async execute(input) {
        const updated = await application.execute({
          key: browserOperationHttpCatalog['media.caption'].key,
          input: {
            id: readString(input, 'id'),
            caption: readString(input, 'caption'),
          },
        });
        return { id: updated.id, caption: updated.caption ?? null };
      },
    },
    {
      name: 'delete_visit_media',
      title: 'Delete a Visit photo',
      description: 'Delete one user-confirmed private Visit photo.',
      inputSchema: objectInputSchema({ id: { type: 'string' } }, ['id']),
      annotations: destructiveAnnotations,
      async execute(input) {
        const id = readString(input, 'id');
        await application.execute({
          key: browserOperationHttpCatalog['media.delete'].key,
          input: { id },
        });
        return { id, deleted: true };
      },
    },
    {
      name: 'delete_visit',
      title: 'Delete a visit record',
      description:
        'Delete one user-confirmed visit and reconcile the place’s visited status.',
      inputSchema: objectInputSchema({ id: { type: 'string' } }, ['id']),
      annotations: destructiveAnnotations,
      async execute(input) {
        const id = readString(input, 'id');
        await application.execute({
          key: browserOperationHttpCatalog['visit.delete'].key,
          input: { id },
        });
        return { id, deleted: true };
      },
    },
    {
      name: 'delete_atlas_item',
      title: 'Delete an Atlas item',
      description:
        'Remove one user-confirmed Atlas item and its personal visit data.',
      inputSchema: objectInputSchema({ id: { type: 'string' } }, ['id']),
      annotations: destructiveAnnotations,
      async execute(input) {
        const id = readString(input, 'id');
        await application.execute({
          key: browserOperationHttpCatalog['catalog.delete_item'].key,
          input: { id },
        });
        return { id, deleted: true };
      },
    },
    {
      name: 'find_nearby_atlas_items',
      title: 'Find nearby Atlas items',
      description:
        'Request the user’s browser location, sort Atlas items by distance, and focus the nearest result.',
      inputSchema: emptyInputSchema(),
      annotations: uiReadAnnotations,
      async execute() {
        const coordinates = await getCurrentCoordinates();
        if (!coordinates) return [];
        const nearby = await application.execute({
          key: browserOperationHttpCatalog['decision.nearby'].key,
          input: {
            ...coordinates,
            limit: 5,
            profile: 'full_merged_catalog',
          },
        });
        if (nearby[0]) selectItem(nearby[0].id);
        return nearby.map((item) => ({ id: item.id, title: item.title }));
      },
    },
  ];
}

const readAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: true,
} as const;
const uiReadAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: false,
} as const;
const writeAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: true,
} as const;
const destructiveAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
} as const;

function emptyInputSchema() {
  return objectInputSchema({});
}

function objectInputSchema(
  properties: Readonly<Record<string, unknown>>,
  required?: readonly string[],
) {
  return {
    type: 'object',
    properties,
    ...(required ? { required } : {}),
    additionalProperties: false,
  };
}

function readString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object' || !(key in input)) {
    throw new TypeError(`${key} is required`);
  }
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function readRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  return input as Record<string, unknown>;
}

function readOptionalString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPersonalState(input: unknown): AtlasItemEdit['personalState'] {
  const value = readString(input, 'personalState');
  if (!['candidate', 'saved', 'planned', 'visited'].includes(value)) {
    throw new TypeError('personalState is invalid');
  }
  return value as AtlasItemEdit['personalState'];
}

function assertRating(value: unknown, nullable: boolean): void {
  if (
    (nullable && value === null) ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 5)
  ) {
    return;
  }
  throw new TypeError(
    nullable
      ? 'rating must be null or a number from 0 to 5'
      : 'rating must be a number from 0 to 5',
  );
}

function assertOptionalNullableRating(value: unknown): void {
  if (value === undefined || value === null) return;
  assertRating(value, false);
}

function readBrowserCoordinates(): Promise<Coordinates | undefined> {
  if (!navigator.geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

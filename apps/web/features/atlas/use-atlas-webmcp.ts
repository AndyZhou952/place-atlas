'use client';

import { useEffect } from 'react';

import type {
  AtlasItem,
  AtlasItemEdit,
  NewImportJob,
  NewJournalEntry,
} from './model';

interface ModelContextTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
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

interface AtlasWebMcpActions {
  readonly items: readonly AtlasItem[];
  readonly selectItem: (id: string) => void;
  readonly updateItem: (id: string, edit: AtlasItemEdit) => Promise<AtlasItem>;
  readonly queueImport: (input: NewImportJob) => Promise<unknown>;
  readonly addJournal: (input: NewJournalEntry) => Promise<unknown>;
  readonly locateNearby: () => Promise<AtlasItem[]>;
}

export function useAtlasWebMcp(actions: AtlasWebMcpActions): void {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: ModelContextTool) => {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => undefined);
    };

    register({
      name: 'list_atlas_items',
      title: 'List Japan Atlas items',
      description:
        'Read the verified and review-pending places currently visible to the user.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        return actions.items.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          area: item.area,
          verificationStatus: item.verificationStatus,
          tabelogScore: item.tabelog?.score,
        }));
      },
    });

    register({
      name: 'focus_atlas_item',
      title: 'Focus Japan Atlas item',
      description:
        'Select an existing Atlas item and center the visible map on it.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const id = readString(input, 'id');
        const item = actions.items.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Unknown Atlas item: ${id}`);
        actions.selectItem(id);
        return { id, title: item.title, focused: true };
      },
    });

    register({
      name: 'update_atlas_item',
      title: 'Update Japan Atlas item',
      description:
        'Persist a user-approved title, description, and personal state for an existing item.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          personalState: {
            type: 'string',
            enum: ['candidate', 'saved', 'planned', 'visited'],
          },
        },
        required: ['id', 'title', 'description', 'personalState'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const id = readString(input, 'id');
        const updated = await actions.updateItem(id, {
          title: readString(input, 'title'),
          description: readString(input, 'description'),
          personalState: readPersonalState(input),
        });
        return { id: updated.id, title: updated.title, updated: true };
      },
    });

    register({
      name: 'queue_creator_import',
      title: 'Queue creator import',
      description:
        'Create a durable acquisition job for a creator profile, channel, or post URL.',
      inputSchema: {
        type: 'object',
        properties: {
          creatorName: { type: 'string' },
          sourceRef: { type: 'string' },
          platform: { type: 'string' },
        },
        required: ['creatorName', 'sourceRef'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const job = await actions.queueImport({
          creatorName: readString(input, 'creatorName'),
          sourceRef: readString(input, 'sourceRef'),
          platform: readOptionalString(input, 'platform'),
        });
        return { queued: true, job };
      },
    });

    register({
      name: 'find_nearby_atlas_items',
      title: 'Find nearby Atlas items',
      description:
        'Request the user’s browser location, sort Atlas items by distance, and focus the nearest result.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute() {
        const nearby = await actions.locateNearby();
        return nearby
          .slice(0, 5)
          .map((item) => ({ id: item.id, title: item.title }));
      },
    });

    return () => lifecycle.abort();
  }, [actions]);
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

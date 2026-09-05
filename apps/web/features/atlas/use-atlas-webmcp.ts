'use client';

import { useEffect } from 'react';

import { atlasItems } from './fixtures';

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

export function useAtlasWebMcp(selectItem: (id: string) => void): void {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: 'focus_saved_item',
        title: 'Focus saved item',
        description:
          'Select a saved food, event, or architecture item and center the visible map on it.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: false,
        },
        execute(input) {
          const id = readId(input);
          const item = atlasItems.find((candidate) => candidate.id === id);
          if (!item) throw new Error(`Unknown saved item: ${id}`);

          selectItem(item.id);
          return { id: item.id, name: item.name, focused: true };
        },
      },
      { signal: lifecycle.signal },
    );

    void Promise.resolve(registration).catch(() => {
      // WebMCP is progressive enhancement; the visible interface remains usable.
    });

    return () => lifecycle.abort();
  }, [selectItem]);
}

function readId(input: unknown): string {
  if (!input || typeof input !== 'object' || !('id' in input)) {
    throw new TypeError('id is required');
  }

  const { id } = input as { readonly id?: unknown };
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('id must be a non-empty string');
  }

  return id;
}

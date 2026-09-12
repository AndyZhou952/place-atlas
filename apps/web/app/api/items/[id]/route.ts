import { NextResponse } from 'next/server';

import { deleteAtlasItemResponse } from '@/app/api/destructive-responses';
import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import type {
  AtlasItemEdit,
  PersonalState,
} from '@/product/application/catalog/atlas-item';

import { getAtlasItemResponse } from './get-atlas-item-response';
import { updateAtlasItemResponse } from '../item-write-response';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return getAtlasItemResponse(getServerAtlasApplication(), id);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const edit = parseAtlasItemEdit(await request.json());
  if (!edit) {
    return new NextResponse(
      'Valid title, description, and state are required',
      {
        status: 400,
      },
    );
  }

  return updateAtlasItemResponse(getServerAtlasApplication(), id, edit);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return deleteAtlasItemResponse(getServerAtlasApplication(), id);
}

function parseAtlasItemEdit(input: unknown): AtlasItemEdit | undefined {
  if (
    !isRecord(input) ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    !isPersonalState(input.personalState)
  ) {
    return undefined;
  }
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    personalState: input.personalState,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPersonalState(value: unknown): value is PersonalState {
  return (
    value === 'candidate' ||
    value === 'saved' ||
    value === 'planned' ||
    value === 'visited'
  );
}

import { NextResponse } from 'next/server';

import { deleteAtlasItemResponse } from '@/app/api/destructive-responses';
import { rejectUncoordinatedOwnerPocWrite } from '@/lib/server/application/owner-poc-write-policy';
import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';
import type {
  AtlasItemEdit,
  PersonalState,
} from '@/product/application/catalog/atlas-item';

import { getAtlasItemResponse } from './get-atlas-item-response';
import { ownerMutationResponse } from '../../owner-mutation-response';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return getAtlasItemResponse(getServerAtlasApplication(), id);
}

export const PATCH = withOwnerWriteAuth(async function PATCH(
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

  return ownerMutationResponse({
    coordinator: getServerInvocationCoordinator(),
    request,
    operation: 'catalog.update_item',
    operationInput: { id, ...edit },
    errors: {
      invalidInput: 'Valid title, description, and state are required',
      notFound: 'Atlas item not found',
      dependencyFailure: 'The Atlas item could not be updated.',
    },
  });
});

export const DELETE = withOwnerWriteAuth(async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unavailable = rejectUncoordinatedOwnerPocWrite();
  if (unavailable) return unavailable;
  void request;
  const { id } = await context.params;
  return deleteAtlasItemResponse(getServerAtlasApplication(), id);
});

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

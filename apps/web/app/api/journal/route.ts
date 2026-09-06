import { NextResponse } from 'next/server';

import type { NewJournalEntry } from '@/features/atlas/model';
import { addJournalEntry, listJournalEntries } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listJournalEntries());
}

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<NewJournalEntry>;
  if (
    typeof input.itemId !== 'string' ||
    !input.itemId ||
    typeof input.visitedAt !== 'string' ||
    !input.visitedAt ||
    typeof input.rating !== 'number' ||
    input.rating < 0 ||
    input.rating > 5 ||
    typeof input.note !== 'string' ||
    !input.note.trim()
  ) {
    return new NextResponse(
      'Valid place, date, 0–5 rating, and note are required',
      {
        status: 400,
      },
    );
  }

  try {
    return NextResponse.json(
      await addJournalEntry({
        itemId: input.itemId,
        visitedAt: input.visitedAt,
        rating: input.rating,
        note: input.note.trim(),
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Atlas item not found') {
      return new NextResponse(error.message, { status: 404 });
    }
    throw error;
  }
}

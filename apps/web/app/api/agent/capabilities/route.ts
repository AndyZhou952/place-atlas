import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    service: 'Japan Atlas',
    version: '0.2',
    channelStatus: 'not_connected',
    operations: [
      { name: 'list_atlas_items', method: 'GET', path: '/api/items' },
      {
        name: 'find_nearby',
        method: 'GET',
        path: '/api/nearby?lat={lat}&lon={lon}',
      },
      { name: 'update_atlas_item', method: 'PATCH', path: '/api/items/{id}' },
      { name: 'queue_creator_import', method: 'POST', path: '/api/inbox' },
      { name: 'add_journal_entry', method: 'POST', path: '/api/journal' },
    ],
  });
}

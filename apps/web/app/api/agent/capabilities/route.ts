import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    service: 'Japan Atlas',
    version: '0.4',
    channelStatus: 'not_connected',
    operations: [
      { name: 'list_atlas_items', method: 'GET', path: '/api/items' },
      {
        name: 'find_nearby',
        method: 'GET',
        path: '/api/nearby?lat={lat}&lon={lon}',
      },
      { name: 'update_atlas_item', method: 'PATCH', path: '/api/items/{id}' },
      {
        name: 'update_place_assessment',
        method: 'PATCH',
        path: '/api/items/{id}/personal',
      },
      { name: 'delete_atlas_item', method: 'DELETE', path: '/api/items/{id}' },
      { name: 'queue_creator_import', method: 'POST', path: '/api/inbox' },
      { name: 'create_visit', method: 'POST', path: '/api/journal' },
      {
        name: 'list_visit_media',
        method: 'GET',
        path: '/api/media?visitId={visitId}',
      },
      {
        name: 'upload_visit_media',
        method: 'POST',
        contentType: 'multipart/form-data',
        path: '/api/media',
      },
      {
        name: 'update_visit_media_caption',
        method: 'PATCH',
        path: '/api/media/{id}',
      },
      {
        name: 'delete_visit_media',
        method: 'DELETE',
        path: '/api/media/{id}',
      },
    ],
  });
}

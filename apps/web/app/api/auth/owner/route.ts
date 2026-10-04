import {
  ownerAuthStatusResponse,
  ownerLoginResponse,
  ownerLogoutResponse,
} from '@/lib/server/auth/owner-auth';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return ownerAuthStatusResponse(request);
}

export function POST(request: Request): Promise<Response> {
  return ownerLoginResponse(request);
}

export function DELETE(request: Request): Promise<Response> {
  return ownerLogoutResponse(request);
}

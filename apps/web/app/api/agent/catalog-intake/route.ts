import { env } from 'cloudflare:workers';

import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import type { AddAgentSecrets } from '@/lib/server/auth/add-agent-token';

import { addAgentIntakeResponse } from './add-agent-intake-response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return addAgentIntakeResponse({
    request,
    getApplication: getServerAtlasApplication,
    secrets: env as unknown as AddAgentSecrets,
  });
}

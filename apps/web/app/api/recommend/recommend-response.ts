import { parseRecommendConversationInput } from '../../../product/application/decision/recommend-conversation.ts';
import type { RecommendConversationOutput } from '../../../product/application/decision/recommend-conversation.ts';

export interface RecommendHttpService {
  ask(input: unknown): Promise<RecommendConversationOutput>;
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

export async function recommendResponse(
  request: Request,
  service: RecommendHttpService,
): Promise<Response> {
  const length = Number(request.headers.get('content-length'));
  if (length > 8_192) return json({ error: 'Request too large' }, 413);
  let value: unknown;
  try {
    const body = await request.text();
    if (body.length > 8_192) return json({ error: 'Request too large' }, 413);
    value = JSON.parse(body);
  } catch {
    return json({ error: 'Valid JSON is required' }, 400);
  }
  const input = parseRecommendConversationInput(value);
  if (!input)
    return json({ error: 'Valid query and replies are required' }, 400);
  try {
    return json(await service.ask(input));
  } catch {
    return json(
      {
        status: 'unavailable',
        message: 'Recommendations are temporarily unavailable. Please retry.',
        retryable: true,
      },
      503,
    );
  }
}

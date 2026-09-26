import { createPlaceResearchAgent } from './place-research.ts';

const required = ['AGENT_API_KEY', 'AGENT_BASE_URL', 'AGENT_MODEL'];
if (required.some((name) => !process.env[name]))
  throw new Error(`Set ${required.join(', ')} in the environment.`);
const [name, address] = process.argv.slice(2);
if (!name || !address)
  throw new Error(
    'Usage: node --experimental-strip-types agent/live-smoke.mjs "restaurant" "branch address"',
  );
const agent = createPlaceResearchAgent({
  apiKey: process.env.AGENT_API_KEY,
  baseUrl: process.env.AGENT_BASE_URL,
  model: process.env.AGENT_MODEL,
  searchApiKey: process.env.SEARCH_API_KEY,
  async fetch(url, init) {
    const started = Date.now();
    const response = await fetch(url, init);
    console.error(
      JSON.stringify({
        provider: new URL(url).hostname,
        status: response.status,
        durationMs: Date.now() - started,
      }),
    );
    if (
      new URL(url).hostname === new URL(process.env.AGENT_BASE_URL).hostname &&
      response.ok
    ) {
      const data = await response.clone().json();
      const message = data.choices?.[0]?.message;
      console.error(
        JSON.stringify({
          responseFields: Object.keys(data),
          finishReason: data.choices?.[0]?.finish_reason,
          toolNames: message?.tool_calls?.map((call) => call.function?.name),
          contentLength:
            typeof message?.content === 'string'
              ? message.content.length
              : null,
        }),
      );
    }
    return response;
  },
});
const started = Date.now();
const result = await agent.research({
  phase: 'initial',
  selectedSubject: {
    ownerQuery: `${name} ${address}`,
    providerNamespace: 'eval',
    placeId: 'eval',
    transientName: name,
    transientAddress: address,
  },
  scope: { ownerId: 'eval', channel: 'web', conversationId: 'eval' },
  sessionId: 'eval',
  expectedSessionVersion: 1,
  queryOrUrlsDigest: 'eval',
});
console.log(
  JSON.stringify({ durationMs: Date.now() - started, result }, null, 2),
);
if (result.kind !== 'observed') process.exitCode = 1;

// Wires the Add harness to this deployment's bindings. The flow is unchanged from the original
// Owner PoC composition: Google Places verifies the typed place (when enabled), Tabelog/web
// research enriches it, Nominatim confirms coordinates, and the Owner confirms before publishing.
import type { Env } from '../../env.ts';
import { listCatalogItems } from '../../db.ts';
import { completeSettings, resolveAgentSettings } from '../../settings.ts';
import {
  createGooglePlaceDiscoveryAdapter,
  createGooglePlacesNewClient,
} from '../discovery/google-places.ts';
import {
  createNominatimDurableGeocoderAdapter,
  createNominatimFixedEndpointTransport,
  D1NominatimPolicyState,
  nominatimIdentity,
} from '../discovery/nominatim.ts';
import { D1ProviderUsage } from '../discovery/quota.ts';
import { createTabelogPlaceDiscoveryPort } from '../discovery/tabelog-search.ts';
import {
  createFirecrawlRestaurantReader,
  createRestaurantSourceReader,
  reusingListingReads,
  withSameListingFallback,
} from '../research/page-reader.ts';
import { createConfiguredPlaceResearchAgent } from '../research/agent.ts';
import { readTabelogListingResult } from '../research/tabelog-listing.ts';
import { createCatalogIntakeModule, type CatalogIntakeModule } from './workflow.ts';
import { D1AtlasCatalogIntakePublisher } from './store.ts';
import { D1CatalogIntakeState } from './store.ts';

export interface AddOptions {
  readonly fetch?: typeof fetch;
  readonly clock?: { now(): Date };
  readonly idSource?: { nextId(): string };
}

export function createAddHarness(env: Env, options: AddOptions = {}): CatalogIntakeModule {
  const database = env.DB;
  const clock = options.clock ?? { now: () => new Date() };
  const fetcher = options.fetch ? { fetch: options.fetch } : {};
  const googleEnabled = env.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'enabled';
  const googleKey = googleEnabled ? env.GOOGLE_PLACES_API_KEY : undefined;
  const usage = new D1ProviderUsage(database, () => clock.now());

  const sourceReader = reusingListingReads(
    env.RESTAURANT_SOURCE_READER === 'firecrawl'
      ? withSameListingFallback(
          createFirecrawlRestaurantReader({ apiKey: env.FIRECRAWL_API_KEY, fetch: options.fetch }),
          (url, signal) => readTabelogListingResult(url, options.fetch ?? fetch, signal),
        )
      : env.BROWSER
        ? createRestaurantSourceReader(env.BROWSER, options.fetch)
        : (url, signal) => readTabelogListingResult(url, options.fetch ?? fetch, signal),
  );

  const discovery = createTabelogPlaceDiscoveryPort({
    ...(googleKey
      ? {
          textDiscovery: createGooglePlaceDiscoveryAdapter(
            createGooglePlacesNewClient({ apiKey: googleKey, usage, ...fetcher }),
          ),
        }
      : {}),
    sourceReader,
    ...fetcher,
    ...(env.SEARCH_API_KEY ? { searchApiKey: env.SEARCH_API_KEY } : {}),
  });

  const nominatimState = new D1NominatimPolicyState(database, clock);
  const durableGeocoder =
    env.CATALOG_INTAKE_DURABLE_GEOCODER_MODE === 'enabled'
      ? createNominatimDurableGeocoderAdapter({
          ...nominatimIdentity(env.ATLAS_PUBLIC_URL),
          transport: createNominatimFixedEndpointTransport(fetcher),
          cache: nominatimState,
          rateGate: nominatimState,
          clock,
        })
      : undefined;

  const researchOptions = {
    ...(env.SEARCH_API_KEY ? { searchApiKey: env.SEARCH_API_KEY } : {}),
    sourceReader,
    ...fetcher,
  };
  // Model settings are resolved per research call so Owner-saved credentials apply immediately.
  const canResolveSettings = Boolean(env.AGENT_SETTINGS_SECRET ?? env.ATLAS_OWNER_SESSION_SECRET);
  const webResearchPort = canResolveSettings
    ? {
        async research(
          input: Parameters<
            NonNullable<ReturnType<typeof createConfiguredPlaceResearchAgent>>['research']
          >[0],
        ) {
          try {
            const settings = completeSettings(await resolveAgentSettings(env)) ?? {};
            const agent = createConfiguredPlaceResearchAgent({ ...researchOptions, ...settings });
            return agent ? agent.research(input) : { kind: 'unavailable' as const };
          } catch {
            return { kind: 'unavailable' as const };
          }
        },
      }
    : createConfiguredPlaceResearchAgent({
        ...researchOptions,
        agentApiKey: env.AGENT_API_KEY,
        agentBaseUrl: env.AGENT_BASE_URL,
        agentModel: env.AGENT_MODEL,
      });

  const idSource = options.idSource ?? { nextId: () => crypto.randomUUID() };
  return createCatalogIntakeModule({
    savedPlaceLookup: { list: () => listCatalogItems(database) },
    discoveryPort: discovery,
    ...(durableGeocoder ? { durableGeocoderPort: durableGeocoder } : {}),
    ...(webResearchPort ? { webResearchPort } : {}),
    enrichmentPolicy: webResearchPort ? 'enrich_if_available' : 'disabled',
    statePort: new D1CatalogIntakeState(database, clock),
    atlasCatalogIntakePort: new D1AtlasCatalogIntakePublisher(database, {
      now: () => clock.now(),
      nextId: () => idSource.nextId(),
    }),
    clock,
    idSource,
    catalogRevision: {
      async read() {
        const row = await database
          .prepare('SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1')
          .first<{ revision_number: number }>();
        return row ? `catalog-r${row.revision_number}` : 'catalog-missing';
      },
    },
  });
}

/** Daily maintenance: expired Add sessions and stale geocoder cache rows. */
export async function cleanupAddState(database: D1Database, now: Date) {
  const intake = await new D1CatalogIntakeState(database).cleanup(now);
  const nominatimCacheRemoved = await new D1NominatimPolicyState(database, {
    now: () => now,
  }).cleanup(now);
  return { intake, nominatimCacheRemoved };
}

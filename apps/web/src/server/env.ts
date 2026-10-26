import type { BrowserContentBinding } from './agent/research/page-reader.ts';
import type { RouteSidecarServiceBinding } from './agent/recommend/routes.ts';

export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  readonly ASSETS?: Fetcher;
  readonly ATLAS_OWNER_PASSWORD?: string;
  readonly ATLAS_OWNER_SESSION_SECRET?: string;
  /** Optional Bearer token (32-128 URL-safe characters) for the external Add Agent API. */
  readonly ATLAS_ADD_AGENT_TOKEN?: string;
  /** Public URL of this deployment, sent as contact in Nominatim requests. */
  readonly ATLAS_PUBLIC_URL?: string;
  /** Encrypts Owner-saved model credentials; falls back to the session secret. */
  readonly AGENT_SETTINGS_SECRET?: string;
  readonly AGENT_API_KEY?: string;
  readonly AGENT_BASE_URL?: string;
  readonly AGENT_MODEL?: string;
  /** Tavily key for the research agent's web search. */
  readonly SEARCH_API_KEY?: string;
  /** `firecrawl` reads restaurant pages through Firecrawl (falling back to a direct read). */
  readonly RESTAURANT_SOURCE_READER?: string;
  readonly FIRECRAWL_API_KEY?: string;
  /** Cloudflare Browser Rendering, used when the source reader is not Firecrawl. */
  readonly BROWSER?: BrowserContentBinding;
  readonly GOOGLE_PLACES_API_KEY?: string;
  /** `enabled` turns on Google Places discovery, details and ratings. */
  readonly CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
  /** `enabled` turns on the Nominatim geocoder used to confirm Add coordinates. */
  readonly CATALOG_INTAKE_DURABLE_GEOCODER_MODE?: string;
  /** Optional route sidecar Worker for Recommend geocoding, walking and transit times. */
  readonly ROUTE_SIDECAR?: RouteSidecarServiceBinding;
}

export function googleKey(env: Env): string | undefined {
  return env.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'enabled'
    ? env.GOOGLE_PLACES_API_KEY
    : undefined;
}

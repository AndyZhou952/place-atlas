export interface Env {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  readonly ASSETS?: Fetcher;
  readonly ATLAS_OWNER_PASSWORD?: string;
  readonly ATLAS_OWNER_SESSION_SECRET?: string;
  /** Optional Bearer token for the external Add API. */
  readonly ATLAS_ADD_AGENT_TOKEN?: string;
  /** Public URL of this deployment, sent as contact in geocoder requests. */
  readonly ATLAS_PUBLIC_URL?: string;
  /** Encrypts Owner-saved model credentials; falls back to the session secret. */
  readonly AGENT_SETTINGS_SECRET?: string;
  readonly AGENT_API_KEY?: string;
  readonly AGENT_BASE_URL?: string;
  readonly AGENT_MODEL?: string;
  /** Tavily key; without it search uses public Yahoo! JAPAN / DuckDuckGo pages. */
  readonly SEARCH_API_KEY?: string;
  /** `firecrawl` reads Tabelog through Firecrawl first, then directly. */
  readonly RESTAURANT_SOURCE_READER?: string;
  readonly FIRECRAWL_API_KEY?: string;
  readonly GOOGLE_PLACES_API_KEY?: string;
  /** Set to `disabled` to ignore a configured Google key. */
  readonly CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
}

export function googleKey(env: Env): string | undefined {
  return env.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'disabled'
    ? undefined
    : env.GOOGLE_PLACES_API_KEY;
}

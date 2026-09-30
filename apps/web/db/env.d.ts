declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    BROWSER?: import('../agent/browser-source-reader').BrowserContentBinding;
    ROUTE_SIDECAR: import('../route-sidecar/metered-route-sidecar-client').RouteSidecarServiceBinding;
    GOOGLE_PLACES_API_KEY?: string;
    CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
    CATALOG_INTAKE_DURABLE_GEOCODER_MODE?: string;
    AGENT_API_KEY?: string;
    AGENT_BASE_URL?: string;
    AGENT_MODEL?: string;
    SEARCH_API_KEY?: string;
    RESTAURANT_SOURCE_READER?: string;
    FIRECRAWL_API_KEY?: string;
    ATLAS_DEPLOYMENT_ENV?: string;
    JAPAN_TRANSIT_PROVIDER?: string;
  }
}

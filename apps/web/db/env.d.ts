declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    ROUTE_SIDECAR: import('../route-sidecar/metered-route-sidecar-client').RouteSidecarServiceBinding;
    GOOGLE_PLACES_API_KEY?: string;
    CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
    CATALOG_INTAKE_DURABLE_GEOCODER_MODE?: string;
    CATALOG_INTAKE_RESEARCH_RELAY_MODE?: string;
    RESEARCH_RELAY_ENDPOINT?: string;
    RESEARCH_RELAY_INGRESS_BEARER_SECRET?: string;
    RESEARCH_ALLOWANCE_KEY_VERSION?: string;
    RESEARCH_ALLOWANCE_HMAC_SECRET?: string;
    RESEARCH_RESULT_KEY_VERSION?: string;
    RESEARCH_RESULT_HMAC_SECRET?: string;
    ATLAS_DEPLOYMENT_ENV?: string;
  }
}

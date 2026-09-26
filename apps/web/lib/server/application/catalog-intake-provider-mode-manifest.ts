export const googlePlacesSecretBindingName = 'GOOGLE_PLACES_API_KEY' as const;

export const catalogIntakeProviderPolicy = {
  schemaVersion: 1,
  googlePlaces: {
    policyVersion: 'google-places-new-transient-pro-v1',
    modeVariable: 'CATALOG_INTAKE_GOOGLE_PLACES_MODE',
    enabledValue: 'enabled',
    secretBinding: googlePlacesSecretBindingName,
    providerId: 'google-places-new',
    origins: ['https://places.googleapis.com'],
    persistedFields: ['placeId'],
    transientFields: ['displayName', 'formattedAddress'],
    monthlyCaps: {
      searchTextRequests: 1000,
      detailsRequests: 1000,
      searchTextCostUsd: 32,
      detailsCostUsd: 17,
    },
  },
  durableGeocoder: {
    policyVersion: 'public-nominatim-owner-triggered-v1',
    modeVariable: 'CATALOG_INTAKE_DURABLE_GEOCODER_MODE',
    enabledValue: 'enabled',
    providerId: 'nominatim.openstreetmap.org',
    endpoint: 'https://nominatim.openstreetmap.org/search',
    cacheTtlDays: 30,
  },
} as const;

export interface CatalogIntakeProviderModes {
  readonly googlePlaces?: string;
  readonly durableGeocoder?: string;
}

export interface OwnerPocCatalogIntakeRuntimeBindings {
  readonly AGENT_API_KEY?: string;
  readonly AGENT_BASE_URL?: string;
  readonly AGENT_MODEL?: string;
  readonly SEARCH_API_KEY?: string;
  readonly GOOGLE_PLACES_API_KEY?: string;
  readonly CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
  readonly CATALOG_INTAKE_DURABLE_GEOCODER_MODE?: string;
}

export function projectOwnerPocCatalogIntakeRuntime(
  bindings: OwnerPocCatalogIntakeRuntimeBindings,
) {
  return {
    agentApiKey: bindings.AGENT_API_KEY,
    agentBaseUrl: bindings.AGENT_BASE_URL,
    agentModel: bindings.AGENT_MODEL,
    searchApiKey: bindings.SEARCH_API_KEY,
    googlePlacesApiKey: bindings.GOOGLE_PLACES_API_KEY,
    providerModes: {
      googlePlaces: bindings.CATALOG_INTAKE_GOOGLE_PLACES_MODE,
      durableGeocoder: bindings.CATALOG_INTAKE_DURABLE_GEOCODER_MODE,
    },
  };
}

export function inspectCatalogIntakeProviderModes(
  modes: CatalogIntakeProviderModes,
) {
  return {
    googlePlaces:
      modes.googlePlaces ===
      catalogIntakeProviderPolicy.googlePlaces.enabledValue
        ? ('enabled' as const)
        : ('disabled' as const),
    durableGeocoder:
      modes.durableGeocoder ===
      catalogIntakeProviderPolicy.durableGeocoder.enabledValue
        ? ('enabled' as const)
        : ('disabled' as const),
  };
}

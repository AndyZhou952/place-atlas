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
  researchRelay: {
    policyVersion: 'tabelog-detail-guarded-v1',
    modeVariable: 'CATALOG_INTAKE_RESEARCH_RELAY_MODE',
    enabledValue: 'relay_enabled_guarded_v1',
    disabledValue: 'relay_disabled_manual_unknown',
  },
} as const;

export interface CatalogIntakeProviderModes {
  readonly googlePlaces?: string;
  readonly durableGeocoder?: string;
  readonly researchRelay?: string;
}

export interface OwnerPocCatalogIntakeRuntimeBindings {
  readonly GOOGLE_PLACES_API_KEY?: string;
  readonly CATALOG_INTAKE_GOOGLE_PLACES_MODE?: string;
  readonly CATALOG_INTAKE_DURABLE_GEOCODER_MODE?: string;
  readonly CATALOG_INTAKE_RESEARCH_RELAY_MODE?: string;
  readonly RESEARCH_RELAY_ENDPOINT?: string;
  readonly RESEARCH_RELAY_INGRESS_BEARER_SECRET?: string;
  readonly RESEARCH_ALLOWANCE_KEY_VERSION?: string;
  readonly RESEARCH_ALLOWANCE_HMAC_SECRET?: string;
  readonly RESEARCH_RESULT_KEY_VERSION?: string;
  readonly RESEARCH_RESULT_HMAC_SECRET?: string;
}

export function projectOwnerPocCatalogIntakeRuntime(
  bindings: OwnerPocCatalogIntakeRuntimeBindings,
) {
  return {
    googlePlacesApiKey: bindings.GOOGLE_PLACES_API_KEY,
    researchRelayEndpoint: bindings.RESEARCH_RELAY_ENDPOINT,
    researchRelayIngressBearerSecret:
      bindings.RESEARCH_RELAY_INGRESS_BEARER_SECRET,
    researchAllowanceKeyVersion: bindings.RESEARCH_ALLOWANCE_KEY_VERSION,
    researchAllowanceHmacSecret: bindings.RESEARCH_ALLOWANCE_HMAC_SECRET,
    researchResultKeyVersion: bindings.RESEARCH_RESULT_KEY_VERSION,
    researchResultHmacSecret: bindings.RESEARCH_RESULT_HMAC_SECRET,
    providerModes: {
      googlePlaces: bindings.CATALOG_INTAKE_GOOGLE_PLACES_MODE,
      durableGeocoder: bindings.CATALOG_INTAKE_DURABLE_GEOCODER_MODE,
      researchRelay: bindings.CATALOG_INTAKE_RESEARCH_RELAY_MODE,
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
    researchRelay:
      modes.researchRelay ===
      catalogIntakeProviderPolicy.researchRelay.enabledValue
        ? ('relay_enabled_guarded_v1' as const)
        : ('relay_disabled_manual_unknown' as const),
  };
}

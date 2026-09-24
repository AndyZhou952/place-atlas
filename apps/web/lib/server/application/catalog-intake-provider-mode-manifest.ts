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
    policyVersion: 'dp06-proposed-disabled-v1',
    modeVariable: 'CATALOG_INTAKE_RESEARCH_RELAY_MODE',
    requiredValue: 'relay_disabled_manual_unknown',
  },
} as const;

export interface CatalogIntakeProviderModes {
  readonly googlePlaces?: string;
  readonly durableGeocoder?: string;
  readonly researchRelay?: string;
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
    researchRelay: 'relay_disabled_manual_unknown' as const,
  };
}

import type { CatalogRead } from '../catalog/catalog-read.ts';
import type { Result } from '../result.ts';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface ProviderAttribution {
  readonly label: string;
  readonly url: string;
}

export interface LocationResolutionProvenance {
  readonly providerId: string;
  readonly policyVersion: string;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export interface ResolvedLocation {
  readonly canonicalAddress: string;
  readonly point: GeoPoint;
}

export type LocationResolution =
  | {
      readonly status: 'resolved';
      readonly location: ResolvedLocation;
      readonly attribution: ProviderAttribution;
      readonly provenance: LocationResolutionProvenance;
    }
  | {
      readonly status: 'ambiguous';
      readonly candidates: readonly ResolvedLocation[];
      readonly attribution: ProviderAttribution;
      readonly provenance: LocationResolutionProvenance;
    }
  | {
      readonly status: 'unresolved';
      readonly reason: 'not_found' | 'dependency_failure';
      readonly warning: string;
      readonly provenance?: LocationResolutionProvenance;
    };

export interface LocationResolver {
  resolve(locationHint: string): Promise<LocationResolution>;
}

export type WalkingRouteEvidence =
  | {
      readonly status: 'fresh';
      readonly durationSeconds: number;
      readonly distanceMeters: number;
      readonly checkedAt: string;
      readonly attribution: ProviderAttribution;
    }
  | {
      readonly status: 'stale';
      readonly checkedAt: string;
      readonly attribution: ProviderAttribution;
      readonly warning: string;
    }
  | {
      readonly status: 'unavailable';
      readonly warning: string;
    };

export interface RouteProvider {
  walking(
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<WalkingRouteEvidence>;
  walkingMany?(
    origin: GeoPoint,
    destinations: readonly GeoPoint[],
  ): Promise<readonly WalkingRouteEvidence[]>;
}

export type TransitRouteEvidence =
  | {
      readonly status: 'fresh';
      readonly durationSeconds: number;
      readonly boardingCount: number;
      readonly lineIdentities: readonly string[];
      readonly transferCount: number;
      readonly checkedAt: string;
      readonly attribution: ProviderAttribution;
    }
  | {
      readonly status: 'stale';
      readonly checkedAt: string;
      readonly attribution: ProviderAttribution;
      readonly warning: string;
    }
  | {
      readonly status: 'unavailable';
      readonly warning: string;
    };

export interface TransitRouteProvider {
  transit(
    origin: GeoPoint,
    destination: GeoPoint,
  ): Promise<TransitRouteEvidence>;
}

export interface NearbyRecommendationQuery {
  readonly locationHint: string;
}

export interface WalkingRecommendation {
  readonly itemId: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly straightLineDistanceKm: number;
  readonly visited: boolean;
  readonly route: Extract<WalkingRouteEvidence, { readonly status: 'fresh' }>;
}

export interface DistanceCandidate {
  readonly itemId: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly straightLineDistanceKm: number;
  readonly visited: boolean;
  readonly warning: string;
}

export interface DirectTransitCandidate {
  readonly itemId: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly straightLineDistanceKm: number;
  readonly visited: boolean;
  readonly route: Extract<TransitRouteEvidence, { readonly status: 'fresh' }>;
}

export type NearbyRecommendationOutcome =
  | Extract<LocationResolution, { readonly status: 'ambiguous' }>
  | Extract<LocationResolution, { readonly status: 'unresolved' }>
  | {
      readonly status: 'resolved';
      readonly provenance: LocationResolutionProvenance;
      readonly requestedLocation: string;
      readonly resolvedLocation: string;
      readonly recommendations: readonly WalkingRecommendation[];
      readonly distanceCandidates: readonly DistanceCandidate[];
      readonly directTransitCandidates: readonly DirectTransitCandidate[];
      readonly unavailableRoutes: readonly {
        readonly itemId: string;
        readonly name: string;
        readonly straightLineDistanceKm: number;
        readonly warning: string;
      }[];
      readonly attribution: ProviderAttribution;
    };

export interface NearbyRecommendation {
  execute(
    query: NearbyRecommendationQuery,
  ): Promise<Result<NearbyRecommendationOutcome>>;
}

export interface NearbyRecommendationDependencies {
  readonly catalog: CatalogRead;
  readonly locationResolver: LocationResolver;
  readonly routeProvider: RouteProvider;
  readonly clock: { readonly now: () => Date };
  readonly routeEvidenceMaximumAgeMs: number;
  readonly transitRouteProvider?: TransitRouteProvider;
}

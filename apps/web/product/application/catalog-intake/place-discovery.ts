import type { Result } from '../result.ts';

export interface PlaceDiscoveryRequest {
  readonly name: string;
  readonly address?: string;
  readonly near?: string;
}

export interface SourcedPlaceFact<Value> {
  readonly value: Value;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export type OptionalSourcedPlaceTextFact =
  | { readonly status: 'unknown' }
  | ({ readonly status: 'known' } & SourcedPlaceFact<string>);

export interface PlaceStrongIdentity {
  readonly providerNamespace: string;
  readonly stablePlaceId: string;
}

export type ExternalRatingFact =
  | {
      readonly status: 'unknown';
      readonly reason: 'not_permitted' | 'unavailable';
    }
  | {
      readonly status: 'known';
      readonly score: number;
      readonly platform: string;
      readonly reviewCount?: number;
      readonly sourceUrl: string;
      readonly checkedAt: string;
    };

export interface DiscoveredPlaceCandidate {
  readonly strongIdentity: PlaceStrongIdentity;
  readonly name: SourcedPlaceFact<string>;
  readonly address: SourcedPlaceFact<string>;
  readonly branch?: OptionalSourcedPlaceTextFact;
  readonly area?: OptionalSourcedPlaceTextFact;
  readonly coordinates: SourcedPlaceFact<{
    readonly latitude: number;
    readonly longitude: number;
  }>;
  readonly externalRating: ExternalRatingFact;
  readonly source: {
    readonly providerId: string;
    readonly sourceUrl: string;
    readonly checkedAt: string;
    readonly policy?: {
      readonly version: string;
      readonly durableFields: readonly string[];
      readonly chatFields?: readonly string[];
      readonly mapPresentation?: {
        readonly target: 'openstreetmap';
        readonly coordinateField: 'coordinates';
        readonly attribution: {
          readonly label: string;
          readonly url: string;
        };
      };
    };
  };
}

export interface PlaceDiscoveryResult {
  readonly candidates: readonly DiscoveredPlaceCandidate[];
}

export interface PlaceDiscoveryProvider {
  discover(
    request: PlaceDiscoveryRequest,
  ): Promise<Result<PlaceDiscoveryResult>>;
}

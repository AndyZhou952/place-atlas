import { mapFoursquarePlacesResponse } from './foursquare-place-discovery-mapper.ts';

export interface FoursquareOfflineCalibrationCase {
  readonly id: string;
  readonly payload: unknown;
  readonly expected:
    | { readonly outcome: 'mapped'; readonly stablePlaceIds: readonly string[] }
    | { readonly outcome: 'empty' | 'abstain' };
}

export interface FoursquareOfflineCalibrationReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: readonly string[];
  readonly outcomes: readonly {
    readonly id: string;
    readonly outcome: 'mapped' | 'empty' | 'abstain';
  }[];
}

export function runFoursquareOfflineCalibration(
  cases: readonly FoursquareOfflineCalibrationCase[],
): FoursquareOfflineCalibrationReport {
  const outcomes = cases.map((calibrationCase) => {
    const fields = mapFoursquarePlacesResponse(calibrationCase.payload);
    return {
      id: calibrationCase.id,
      outcome: !fields
        ? ('abstain' as const)
        : fields.fsqPlaceId.length === 0
          ? ('empty' as const)
          : ('mapped' as const),
      stablePlaceIds: fields?.fsqPlaceId,
    };
  });
  const failed = outcomes.flatMap((outcome, index) => {
    const expected = cases[index]?.expected;
    if (!expected || outcome.outcome !== expected.outcome) return [outcome.id];
    if (
      expected.outcome === 'mapped' &&
      !sameValues(outcome.stablePlaceIds, expected.stablePlaceIds)
    ) {
      return [outcome.id];
    }
    return [];
  });
  return {
    total: cases.length,
    passed: cases.length - failed.length,
    failed,
    outcomes: outcomes.map(({ id, outcome }) => ({ id, outcome })),
  };
}

function sameValues(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  return (
    left !== undefined &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function normalizeAssessmentRating(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new RangeError('Rating must be a number from 0 to 10.');
  }

  return Math.round((value + Number.EPSILON) * 10) / 10;
}

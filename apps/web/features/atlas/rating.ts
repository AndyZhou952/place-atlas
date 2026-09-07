export function normalizeRating(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 5) {
    throw new RangeError('Rating must be a number from 0 to 5.');
  }

  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function parseOptionalRating(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : normalizeRating(Number(trimmed));
}

import { normalizeAssessmentRating } from '../../product/application/assessments/assessment-rating.ts';

export { normalizeAssessmentRating as normalizeRating } from '../../product/application/assessments/assessment-rating.ts';

export function parseOptionalRating(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === ''
    ? undefined
    : normalizeAssessmentRating(Number(trimmed));
}

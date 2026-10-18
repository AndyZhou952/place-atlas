-- Applied once by the existing D1 migration runner; source and media ratings are unchanged.
UPDATE place_assessments
SET overall_rating = ROUND(overall_rating * 4) / 2.0
WHERE overall_rating IS NOT NULL;

UPDATE `place_assessments`
SET `overall_rating` = NULL,
    `is_favorite` = 0,
    `has_visited` = 0,
    `summary` = NULL
WHERE `overall_rating` IS NOT NULL
   OR `is_favorite` <> 0
   OR `has_visited` <> 0
   OR `summary` IS NOT NULL;

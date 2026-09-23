SELECT
  manifest.seed_version,
  manifest.source_artifact,
  manifest.record_count,
  manifest.source_sha256,
  manifest.payload_aggregate_sha256,
  records.item_id AS id,
  records.payload_sha256,
  items.payload_json
FROM owner_poc_seed_manifests AS manifest
JOIN owner_poc_seed_manifest_records AS records
  ON records.seed_version = manifest.seed_version
JOIN atlas_items AS items
  ON items.id = records.item_id
WHERE manifest.seed_version = 'owner-poc-seed-v1'
ORDER BY records.item_id;

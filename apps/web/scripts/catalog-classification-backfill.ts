import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classifyRestaurant } from '../product/application/catalog/restaurant-classification.ts';

interface PayloadRow {
  readonly id: string;
  readonly payload_json: string;
  readonly table_name?: string;
}

export function planClassificationBackfill(rows: readonly PayloadRow[]) {
  const entries = rows.map((row) => {
    if (
      !['atlas_items', 'atlas_review_candidates'].includes(
        row.table_name ?? 'atlas_items',
      )
    )
      throw new TypeError('Unsupported catalog table.');
    const item = JSON.parse(row.payload_json);
    if (
      item.id !== row.id ||
      !Array.isArray(item.tags) ||
      !['food', 'event', 'architecture'].includes(item.kind)
    )
      throw new TypeError('Invalid saved catalog payload.');
    const classification = classifyRestaurant(item);
    const changed =
      JSON.stringify(item.classification) !== JSON.stringify(classification);
    return { row, classification, changed };
  });
  const planned = entries.filter((entry) => entry.changed);
  const updates = planned.map(
    ({ row, classification }) =>
      `UPDATE ${row.table_name ?? 'atlas_items'} SET payload_json = json_set(payload_json, '$.classification', json(${quote(JSON.stringify(classification))})) WHERE id = ${quote(row.id)} AND payload_json = ${quote(row.payload_json)};`,
  );
  return {
    report: {
      total: entries.length,
      changed: planned.length,
      unknownCuisine: entries
        .filter(
          ({ classification, row }) =>
            JSON.parse(row.payload_json).kind === 'food' &&
            !classification.cuisines.length,
        )
        .map(({ row }) => row.id),
      unknownCountry: entries
        .filter(({ classification }) => !classification.geography.countryCode)
        .map(({ row }) => row.id),
      unknownSubdivision: entries
        .filter(
          ({ classification }) => !classification.geography.subdivisionCode,
        )
        .map(({ row }) => row.id),
      entries: entries.map(({ row, classification, changed }) => ({
        id: row.id,
        changed,
        classification,
      })),
    },
    // Original payload comparison prevents overwriting concurrent edits.
    sql: [
      ...updates.flatMap((update) => [
        update,
        'UPDATE atlas_catalog_revision SET revision_number = revision_number + 1 WHERE singleton = 1 AND changes() > 0;',
      ]),
      'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1;',
    ].join('\n'),
  };
}

function quote(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , input, outputPrefix] = process.argv;
  if (!input || !outputPrefix || process.argv.length !== 4)
    throw new TypeError(
      'Usage: node --experimental-strip-types scripts/catalog-classification-backfill.ts <raw-rows.json> <output-prefix>',
    );
  const parsed = JSON.parse(readFileSync(input, 'utf8'));
  const rows = Array.isArray(parsed[0]?.results)
    ? parsed.flatMap((response: { results: PayloadRow[] }) => response.results)
    : parsed;
  const plan = planClassificationBackfill(rows);
  writeFileSync(
    outputPrefix + '.json',
    JSON.stringify(plan.report, null, 2) + '\n',
    { flag: 'wx' },
  );
  writeFileSync(outputPrefix + '.sql', plan.sql + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      total: plan.report.total,
      changed: plan.report.changed,
      unknownCuisine: plan.report.unknownCuisine,
      unknownCountry: plan.report.unknownCountry,
      unknownSubdivision: plan.report.unknownSubdivision,
    }),
  );
}

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const fields = ['openingHours', 'regularClosingDays'];

/** Plan only; existing runtimes can ignore root fields without rejecting intake profiles. */
export function planRestaurantHoursBackfill(exported, benchmark) {
  const rows = exported.flatMap((entry) => entry.results ?? [entry]);
  const statements = [];
  const rollback = [];
  const entries = [];
  for (const sample of benchmark.cases) {
    const matches = rows.filter((row) => row.id === sample.itemId);
    if (matches.length !== 1)
      throw new Error(`Missing or ambiguous item: ${sample.id}`);
    const row = matches[0];
    const before = JSON.parse(row.payload_json);
    if (
      before.id !== sample.itemId ||
      before.title !== sample.name ||
      before.kind !== 'food' ||
      before.intakeEvidence?.tabelog?.url !== sample.listingUrl
    )
      throw new Error(`Restaurant identity changed: ${sample.id}`);
    const next = structuredClone(before);
    let observedAt;
    for (const field of fields) {
      const claim = sample[field];
      if (claim === undefined) continue; // Unknown never erases existing evidence.
      const source = new URL(claim.sourceUrl);
      if (
        source.protocol !== 'https:' ||
        source.username ||
        source.password ||
        typeof claim.value !== 'string' ||
        !claim.value.trim() ||
        claim.value.length > 1200 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
          claim.observedAt,
        ) ||
        !sample.evidence.some((proof) => proof.sourceUrl === claim.sourceUrl)
      )
        throw new Error(`Invalid sourced schedule: ${sample.id}/${field}`);
      next[field] = claim;
      observedAt = claim.observedAt;
    }
    const changed = fields.some(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]),
    );
    entries.push({
      id: sample.itemId,
      changed,
      fields: fields.filter((field) => sample[field]),
    });
    if (!changed) continue;
    next.updatedAt = observedAt;
    const after = JSON.stringify(next);
    statements.push(
      `UPDATE atlas_items SET payload_json=${quote(after)}, updated_at=${quote(observedAt)} WHERE id=${quote(row.id)} AND payload_json=${quote(row.payload_json)} AND updated_at=${quote(row.updated_at)};\nUPDATE maintenance_control SET write_revision=write_revision+1 WHERE id=1 AND changes()=1;`,
    );
    rollback.push(
      `UPDATE atlas_items SET payload_json=${quote(row.payload_json)}, updated_at=${quote(row.updated_at)} WHERE id=${quote(row.id)} AND payload_json=${quote(after)} AND updated_at=${quote(observedAt)};\nUPDATE maintenance_control SET write_revision=write_revision+1 WHERE id=1 AND changes()=1;`,
    );
  }
  return {
    entries,
    sql: statements.join('\n'),
    rollbackSql: rollback.join('\n'),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, benchmark, output] = process.argv.slice(2);
  if (!input || !benchmark || !output)
    throw new Error('Provide D1 export, hours benchmark, and output prefix.');
  const plan = planRestaurantHoursBackfill(
    JSON.parse(readFileSync(input, 'utf8')),
    JSON.parse(readFileSync(benchmark, 'utf8')),
  );
  writeFileSync(`${output}.sql`, plan.sql);
  writeFileSync(`${output}.rollback.sql`, plan.rollbackSql);
  writeFileSync(`${output}.json`, JSON.stringify(plan.entries, null, 2));
  console.log(
    JSON.stringify({
      targets: plan.entries.length,
      changes: plan.entries.filter((entry) => entry.changed).length,
      executed: false,
    }),
  );
}

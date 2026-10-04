import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OBSERVED_AT = '2026-10-04T00:00:00.000Z';
const SPECS = [
  {
    key: 'shima',
    id: '7cde3b6c-b853-4102-a4ad-8ab1a4c53170',
    title: 'らぁ麺や 嶋',
    tabelogUrl: 'https://tabelog.com/tokyo/A1304/A130401/13247487/',
    bookingUrl: 'https://www.tablecheck.com/ja/shops/ramenya-shima/reserve',
    reservationUrl: 'https://www.tablecheck.com/ja/shops/ramenya-shima/reserve',
    officialUrl: null,
    oldOfficialUrl: null,
  },
  {
    key: 'rodeo',
    id: '9fe5a165-0776-4a57-af42-a9a607fcca62',
    title: 'RODEO',
    tabelogUrl: 'https://tabelog.com/tokyo/A1317/A131701/13213575/',
    bookingUrl: 'https://yoyaku.toreta.in/rodeo-nakameguro/#/',
    reservationUrl: 'https://yoyaku.toreta.in/rodeo-nakameguro/',
    officialUrl: 'https://gf-restaurant.jp/rodeo/nakameguro',
    oldOfficialUrl: 'https://gf-restaurant.jp/rodeo',
  },
];

const jsonString = (value) => quote(JSON.stringify(value));

export function unpackRows(raw) {
  if (!Array.isArray(raw)) throw new TypeError('Input must be a row array.');
  const rows = raw.flatMap((entry) =>
    Array.isArray(entry?.results) ? entry.results : [entry],
  );
  return rows.filter((row) => row && typeof row.payload_json === 'string');
}

export function planRestaurantLinkRepair(inputRows) {
  const rows = unpackRows(inputRows);
  if (rows.length === 0) throw new Error('Input contains no atlas_items rows.');

  const byId = new Map();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || byId.has(row.id))
      throw new Error('Input has a missing or duplicate atlas item id.');
    const payload = parsePayload(row);
    if (payload.id !== row.id)
      throw new Error(`Payload id does not match row id: ${row.id}`);
    byId.set(row.id, { row, payload });
  }

  const planned = SPECS.map((spec) => {
    const entry = byId.get(spec.id);
    if (!entry) throw new Error(`Expected ${spec.key} record is missing.`);
    const { row, payload } = entry;
    const isAlreadyCorrect = isRepaired(spec, row, payload);
    if (!isAlreadyCorrect) assertIdentity(spec, row, payload);
    const expected = repairPayload(spec, payload);
    const alreadyCorrect = isAlreadyCorrect;
    const originalUpdatedAt = row.updated_at;
    if (typeof originalUpdatedAt !== 'string' || !originalUpdatedAt)
      throw new Error(`Missing updated_at for ${spec.key}.`);
    return {
      spec,
      row,
      payload,
      expected,
      originalUpdatedAt,
      alreadyCorrect,
    };
  });

  const changes = planned.filter((entry) => !entry.alreadyCorrect);
  const updates = changes.map(({ spec, row, expected, originalUpdatedAt }) => {
    const expectedOldOfficial = spec.oldOfficialUrl
      ? ` AND json_extract(payload_json, '$.officialUrl') = ${quote(spec.oldOfficialUrl)}`
      : '';
    const sourceGuard = [
      `AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.sources') AS source WHERE json_extract(source.value, '$.role') = 'tabelog' AND json_extract(source.value, '$.url') = ${quote(spec.tabelogUrl)})`,
      "AND NOT EXISTS (SELECT 1 FROM json_each(payload_json, '$.sources') AS source WHERE json_extract(source.value, '$.role') = 'reservation')",
      spec.oldOfficialUrl
        ? `AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.sources') AS source WHERE json_extract(source.value, '$.role') = 'official' AND json_extract(source.value, '$.url') = ${quote(spec.oldOfficialUrl)})`
        : "AND NOT EXISTS (SELECT 1 FROM json_each(payload_json, '$.sources') AS source WHERE json_extract(source.value, '$.role') = 'official')",
    ].join(' ');
    const expectedReservationUrl = quote(spec.tabelogUrl);
    const expectedIntakeBookingMissing =
      " AND json_type(payload_json, '$.intakeEvidence.profile.bookingLink') IS NULL";
    const expectedNoOfficialClaim = spec.officialUrl
      ? " AND json_type(payload_json, '$.intakeEvidence.profile.officialWebsite') IS NULL"
      : '';
    return [
      `UPDATE atlas_items SET payload_json = ${jsonString(expected)}, updated_at = ${quote(OBSERVED_AT)}`,
      `WHERE id = ${quote(spec.id)}`,
      `AND payload_json = ${quote(row.payload_json)}`,
      `AND updated_at = ${quote(originalUpdatedAt)}`,
      `AND json_extract(payload_json, '$.id') = ${quote(spec.id)}`,
      `AND json_extract(payload_json, '$.title') = ${quote(spec.title)}`,
      `AND json_extract(payload_json, '$.intakeEvidence.tabelog.url') = ${quote(spec.tabelogUrl)}`,
      `AND json_extract(payload_json, '$.reservation.url') = ${expectedReservationUrl}`,
      `AND json_extract(payload_json, '$.intakeEvidence.reservation.url') = ${expectedReservationUrl}`,
      expectedOldOfficial,
      spec.officialUrl
        ? ''
        : "AND json_type(payload_json, '$.officialUrl') IS NULL",
      expectedIntakeBookingMissing,
      expectedNoOfficialClaim,
      sourceGuard,
      ';',
      'UPDATE maintenance_control SET write_revision = write_revision + 1 WHERE id = 1 AND changes() = 1;',
    ]
      .filter(Boolean)
      .join(' ');
  });

  const rollbackStatements = changes.map(
    ({ spec, row, expected, originalUpdatedAt }) =>
      `UPDATE atlas_items SET payload_json = ${quote(row.payload_json)}, updated_at = ${quote(originalUpdatedAt)} WHERE id = ${quote(spec.id)} AND payload_json = ${jsonString(expected)} AND updated_at = ${quote(OBSERVED_AT)};\nUPDATE maintenance_control SET write_revision = write_revision + 1 WHERE id = 1 AND changes() = 1;`,
  );

  const ids = planned.map(({ spec }) => quote(spec.id)).join(', ');
  const readbackChecks = planned
    .map(({ spec }) => {
      const officialValue = spec.officialUrl
        ? `json_extract(payload_json, '$.intakeEvidence.profile.officialWebsite.value') = ${quote(spec.officialUrl)} AND json_extract(payload_json, '$.officialUrl') = ${quote(spec.officialUrl)} AND EXISTS (SELECT 1 FROM json_each(atlas_items.payload_json, '$.sources') AS official_source WHERE json_extract(official_source.value, '$.role') = 'official' AND json_extract(official_source.value, '$.url') = ${quote(spec.officialUrl)})`
        : "json_type(payload_json, '$.intakeEvidence.profile.officialWebsite') IS NULL AND json_type(payload_json, '$.officialUrl') IS NULL";
      return `SELECT id, CASE WHEN json_extract(payload_json, '$.reservation.url') = ${quote(spec.reservationUrl)} AND json_extract(payload_json, '$.intakeEvidence.reservation.url') = ${quote(spec.tabelogUrl)} AND json_extract(payload_json, '$.intakeEvidence.profile.bookingLink.value') = ${quote(spec.bookingUrl)} AND ${officialValue} AND EXISTS (SELECT 1 FROM json_each(atlas_items.payload_json, '$.sources') AS booking_source WHERE json_extract(booking_source.value, '$.role') = 'reservation' AND json_extract(booking_source.value, '$.url') = ${quote(spec.bookingUrl)}) AND updated_at = ${quote(OBSERVED_AT)} THEN 1 ELSE 0 END AS links_match FROM atlas_items WHERE id = ${quote(spec.id)};`;
    })
    .join('\n');
  return {
    report: {
      observedAt: OBSERVED_AT,
      targetCount: planned.length,
      changedCount: changes.length,
      entries: planned.map(
        ({
          spec,
          row,
          payload,
          expected,
          originalUpdatedAt,
          alreadyCorrect,
        }) => ({
          key: spec.key,
          id: spec.id,
          changed: !alreadyCorrect,
          oldUpdatedAt: originalUpdatedAt,
          newUpdatedAt: alreadyCorrect ? originalUpdatedAt : OBSERVED_AT,
          oldPayload: payload,
          newPayload: alreadyCorrect ? payload : expected,
          oldPayloadJson: row.payload_json,
        }),
      ),
    },
    backupSql: `SELECT id, payload_json, updated_at FROM atlas_items WHERE id IN (${ids}) ORDER BY id;`,
    sql: updates.join('\n'),
    rollbackSql: rollbackStatements.join('\n'),
    assertionsSql: `${readbackChecks}\nSELECT write_revision FROM maintenance_control WHERE id = 1;`,
  };
}

function assertIdentity(spec, row, payload) {
  if (
    payload.kind !== 'food' ||
    payload.title !== spec.title ||
    payload.intakeEvidence?.tabelog?.url !== spec.tabelogUrl ||
    payload.reservation?.url !== spec.tabelogUrl ||
    payload.intakeEvidence?.reservation?.url !== spec.tabelogUrl
  )
    throw new Error(`Refusing unexpected identity or old URL for ${spec.key}.`);
  if (spec.oldOfficialUrl && payload.officialUrl !== spec.oldOfficialUrl)
    throw new Error(`Refusing unexpected official URL for ${spec.key}.`);
  if (!Array.isArray(payload.sources))
    throw new Error(`Missing sources for ${spec.key}.`);
  const tabelog = payload.sources.filter(
    (source) => source.role === 'tabelog' && source.url === spec.tabelogUrl,
  );
  if (tabelog.length !== 1)
    throw new Error(`Expected one exact Tabelog source for ${spec.key}.`);
  const wrongBookingSources = payload.sources.filter(
    (source) =>
      source.role === 'reservation' &&
      source.url !== spec.tabelogUrl &&
      source.url !== spec.bookingUrl,
  );
  if (wrongBookingSources.length > 1)
    throw new Error(`Ambiguous reservation sources for ${spec.key}.`);
  if (payload.intakeEvidence?.profile?.bookingLink) {
    const current = payload.intakeEvidence.profile.bookingLink.value;
    if (current !== spec.bookingUrl)
      throw new Error(`Unexpected existing booking claim for ${spec.key}.`);
  }
  const officialSources = payload.sources.filter(
    (source) => source.role === 'official',
  );
  if (spec.officialUrl) {
    if (
      officialSources.length !== 1 ||
      officialSources[0].url !== spec.oldOfficialUrl
    )
      throw new Error(`Unexpected official source for ${spec.key}.`);
  } else if (officialSources.length !== 0) {
    throw new Error(`Unexpected official source for ${spec.key}.`);
  }
  if (spec.officialUrl && payload.intakeEvidence?.profile?.officialWebsite) {
    const current = payload.intakeEvidence.profile.officialWebsite.value;
    if (current !== spec.officialUrl)
      throw new Error(`Unexpected existing official claim for ${spec.key}.`);
  }
  if (!spec.officialUrl && payload.officialUrl)
    throw new Error(`Unexpected standalone official URL for ${spec.key}.`);
  if (row.id !== spec.id) throw new Error(`Unexpected row id for ${spec.key}.`);
}

function isRepaired(spec, row, payload) {
  if (
    payload.id !== spec.id ||
    payload.kind !== 'food' ||
    payload.title !== spec.title ||
    payload.intakeEvidence?.tabelog?.url !== spec.tabelogUrl ||
    payload.reservation?.url !== spec.reservationUrl ||
    payload.reservation?.checkedAt !== OBSERVED_AT ||
    payload.intakeEvidence?.reservation?.url !== spec.tabelogUrl ||
    payload.intakeEvidence?.profile?.bookingLink?.value !== spec.bookingUrl ||
    payload.intakeEvidence?.profile?.bookingLink?.sourceUrl !==
      spec.bookingUrl ||
    payload.intakeEvidence?.profile?.bookingLink?.observedAt !== OBSERVED_AT ||
    payload.updatedAt !== OBSERVED_AT ||
    row.updated_at !== OBSERVED_AT ||
    !payload.sources.some(
      (source) => source.role === 'tabelog' && source.url === spec.tabelogUrl,
    )
  )
    return false;
  if (spec.officialUrl) {
    if (
      payload.officialUrl !== spec.officialUrl ||
      payload.intakeEvidence?.profile?.officialWebsite?.value !==
        spec.officialUrl ||
      payload.intakeEvidence?.profile?.officialWebsite?.sourceUrl !==
        spec.officialUrl ||
      payload.intakeEvidence?.profile?.officialWebsite?.observedAt !==
        OBSERVED_AT ||
      !payload.sources.some(
        (source) =>
          source.role === 'official' && source.url === spec.officialUrl,
      )
    )
      return false;
  }
  return payload.sources.some(
    (source) => source.role === 'reservation' && source.url === spec.bookingUrl,
  );
}

function repairPayload(spec, original) {
  const payload = structuredClone(original);
  const profile = { ...payload.intakeEvidence.profile };
  profile.bookingLink = {
    value: spec.bookingUrl,
    sourceUrl: spec.bookingUrl,
    observedAt: OBSERVED_AT,
  };
  if (spec.officialUrl) {
    profile.officialWebsite = {
      value: spec.officialUrl,
      sourceUrl: spec.officialUrl,
      observedAt: OBSERVED_AT,
    };
    payload.officialUrl = spec.officialUrl;
  }
  payload.intakeEvidence.profile = profile;
  payload.reservation.url = spec.reservationUrl;
  payload.reservation.checkedAt = OBSERVED_AT;

  const reservationSource = {
    label: 'Booking',
    url: spec.bookingUrl,
    role: 'reservation',
  };
  const existingReservationIndex = payload.sources.findIndex(
    (source) => source.role === 'reservation',
  );
  if (existingReservationIndex >= 0)
    payload.sources[existingReservationIndex] = reservationSource;
  else payload.sources.push(reservationSource);

  if (spec.officialUrl) {
    const officialSourceIndex = payload.sources.findIndex(
      (source) => source.role === 'official',
    );
    const officialSource = {
      label: 'Official restaurant page',
      url: spec.officialUrl,
      role: 'official',
    };
    if (officialSourceIndex >= 0)
      payload.sources[officialSourceIndex] = officialSource;
    else payload.sources.push(officialSource);
  }
  payload.updatedAt = OBSERVED_AT;
  return payload;
}

function parsePayload(row) {
  try {
    return JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Invalid payload JSON for ${row.id}.`);
  }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , inputPath, outputPrefix] = process.argv;
  if (!inputPath || !outputPrefix || process.argv.length !== 4)
    throw new TypeError(
      'Usage: node scripts/restaurant-link-repair.mjs <raw-rows.json> <output-prefix>',
    );
  const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  const plan = planRestaurantLinkRepair(raw);
  for (const [suffix, content] of [
    ['.json', JSON.stringify(plan.report, null, 2) + '\n'],
    ['.backup.sql', plan.backupSql + '\n'],
    ['.sql', plan.sql + '\n'],
    ['.rollback.sql', plan.rollbackSql + '\n'],
    ['.assertions.sql', plan.assertionsSql + '\n'],
  ])
    writeFileSync(outputPrefix + suffix, content, { flag: 'wx' });
  console.log(
    JSON.stringify({
      targetCount: plan.report.targetCount,
      changedCount: plan.report.changedCount,
      sqlGenerated: true,
      executed: false,
    }),
  );
}

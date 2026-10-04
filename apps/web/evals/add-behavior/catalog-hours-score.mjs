const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const ALL_DAYS = [...WEEKDAYS, '祝', '祝前日', '祝後日'];
const DAY_SOURCE = '(?:祝前日|祝後日|月|火|水|木|金|土|日|祝(?:日)?)';
const DAY_GROUP_SOURCE = `${DAY_SOURCE}(?:(?:曜日|曜))?(?:(?:[・、,/]|〜|～|~|-|–|—|\\s)*${DAY_SOURCE}(?:(?:曜日|曜|日))?)*`;
const DAY_TOKEN = new RegExp(
  `(?<![\\p{L}])(${DAY_GROUP_SOURCE}|全日|毎日)`,
  'gu',
);
const TIME_RANGE =
  /(?<!\d)(\d{1,2}:\d{2})\s*(?:-|–|—|〜|～|~|至|から)\s*(?:翌)?(\d{1,2}:\d{2})(?!\d)/gu;
const TIME_POINT = /(?<![\d:])(\d{1,2}:\d{2})(?![\d:])/gu;
const LO_PATTERN =
  /(?:L\s*\.?\s*O\s*\.?|ラストオーダー|ﾗｽﾄｵｰﾀﾞｰ)\s*[:：]?(?:\s*料理)?\s*(\d{1,2}:\d{2})/giu;
const SERVICE_LABELS = [
  [/ランチ|昼食|午餐|lunch/iu, 'lunch'],
  [/ディナー|夕食|晚餐|dinner/iu, 'dinner'],
  [/モーニング|朝食|breakfast/iu, 'breakfast'],
  [/カフェタイム|喫茶|cafe/iu, 'cafe'],
  [/ティータイム|tea/iu, 'tea'],
];
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\p{P}\p{Z}\s]/gu, '');

function expandDayGroup(raw) {
  const text = raw
    .normalize('NFKC')
    .replace(/([月火水木金土日])祝(?!日)/gu, '$1・祝')
    .replace(/曜日|曜/gu, '')
    .replace(/祝日/gu, '祝');
  if (text === '全日' || text === '毎日') return ALL_DAYS;
  const members = [...text.matchAll(/祝前日|祝後日|[月火水木金土日祝]/gu)].map(
    (m) => ({
      d: m[0],
      i: m.index,
    }),
  );
  const days = new Set();
  members.forEach((member, index) => {
    const next = members[index + 1];
    const between = next ? text.slice(member.i + 1, next.i) : '';
    if (
      next &&
      /[〜～~\-–—]/u.test(between) &&
      WEEKDAYS.includes(member.d) &&
      WEEKDAYS.includes(next.d)
    ) {
      let start = WEEKDAYS.indexOf(member.d);
      let end = WEEKDAYS.indexOf(next.d);
      if (end < start) [start, end] = [end, start];
      WEEKDAYS.slice(start, end + 1).forEach((day) => days.add(day));
    } else days.add(member.d);
  });
  return ALL_DAYS.filter((day) => days.has(day));
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function validClock(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour <= 24 && minute < 60 && (hour < 24 || minute === 0);
}

function serviceLabels(text) {
  return SERVICE_LABELS.filter(([regex]) => regex.test(text))
    .map(([, label]) => label)
    .sort((a, b) => a.localeCompare(b));
}

/** Parse Japanese weekly time rows into per-day facts plus non-weekday schedules. */
export function parseOperatingHours(value) {
  if (typeof value !== 'string' || !value.trim())
    return { valid: false, reason: 'empty' };
  const scheduleText = value
    .replace(/【営業時間変更のお知らせ】[\s\S]*$/u, '')
    .replace(/営業時間・定休日は変更となる場合[^。]*(?:。|$)/u, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩](?=\s*\d{1,2}:\d{2})/gu, '; ');
  let text = scheduleText
    .normalize('NFKC')
    .replace(/\[([月火水木金土日祝])\]/gu, '$1')
    .replace(/\r/g, '\n');
  const sectionMarkers = [...text.matchAll(/■\s*(定休日|入店時間|営業時間)/gu)];
  const sourceText = text;
  const supplementalHours = sectionMarkers.flatMap((marker, index) => {
    if (marker[1] !== '営業時間') return [];
    const end = sectionMarkers[index + 1]?.index ?? sourceText.length;
    return [sourceText.slice(marker.index + marker[0].length, end).trim()];
  });
  const dateSchedules = [
    ...sourceText.matchAll(
      /(\d{1,2}月\d{1,2}日)\s*(\d{1,2}:\d{2})\s*(?:-|–|—|〜|～|~|至|から)\s*(?:翌)?(\d{1,2}:\d{2})/gu,
    ),
  ].map((match) => `${match[1]}:${match[2]}-${match[3]}`);
  text = text.replace(
    /\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}\s*(?:-|–|—|〜|～|~|至|から)\s*(?:翌)?\d{1,2}:\d{2}/gu,
    ' ',
  );
  if (sectionMarkers.length) {
    const first = sectionMarkers[0];
    const textBefore = text.slice(0, first.index);
    const hasEarlierHours =
      TIME_RANGE.test(textBefore) || /24時間営業/iu.test(textBefore);
    TIME_RANGE.lastIndex = 0;
    if (hasEarlierHours || first[1] !== '営業時間') {
      const nextMarker = sectionMarkers[1];
      const tail = text.slice(
        first.index + first[0].length,
        nextMarker?.index ?? text.length,
      );
      const tailHasHours = TIME_RANGE.test(tail);
      TIME_RANGE.lastIndex = 0;
      text =
        hasEarlierHours &&
        first[1] === '営業時間' &&
        /最終入店/u.test(tail) &&
        !tailHasHours
          ? `${text.slice(0, first.index)} ${tail}`
          : text.slice(0, first.index);
    } else {
      const nextMarker = sectionMarkers[1];
      text = text
        .slice(first.index + first[0].length, nextMarker?.index ?? text.length)
        .trim();
    }
  }
  const invalidRange = [...text.matchAll(TIME_RANGE)].some(
    (m) => !validClock(m[1]) || !validClock(m[2]),
  );
  const invalidPoint = [...text.matchAll(TIME_POINT)].some(
    (m) => !validClock(m[1]),
  );
  if (invalidRange || invalidPoint)
    return { valid: false, reason: 'invalid_time' };
  const tokens = [
    ...text
      .replace(/([月火水木金土日])祝(?!日)/gu, '$1・祝')
      .matchAll(DAY_TOKEN),
  ];
  const byDay = Object.fromEntries(ALL_DAYS.map((day) => [day, []]));
  const lastOrdersByDay = Object.fromEntries(ALL_DAYS.map((day) => [day, []]));
  const unassigned = [];
  const unassignedLastOrders = [];
  const closures = [];
  const segments = [];
  if (tokens.length) {
    tokens.forEach((token, index) => {
      const rawLabel = token[1];
      const start = token.index + token[0].length;
      const end = tokens[index + 1]?.index ?? text.length;
      const segment = text.slice(start, end);
      const assignedDays = expandDayGroup(rawLabel);
      let previousRangeEnd = 0;
      const ranges = [...segment.matchAll(TIME_RANGE)].map((m) => {
        const labels = serviceLabels(segment.slice(previousRangeEnd, m.index));
        previousRangeEnd = m.index + m[0].length;
        return {
          open: m[1],
          close: m[2],
          overnight: timeToMinutes(m[2]) <= timeToMinutes(m[1]),
          services: labels,
        };
      });
      const rangeSpans = [...segment.matchAll(TIME_RANGE)].map((m) => [
        m.index,
        m.index + m[0].length,
      ]);
      const seatingTimes = [...segment.matchAll(TIME_POINT)]
        .filter(
          (m) =>
            !rangeSpans.some(
              ([start, end]) => m.index >= start && m.index < end,
            ),
        )
        .filter(() => !/(?:L\s*\.?\s*O|ラストオーダー)/iu.test(segment))
        .filter(
          (m) =>
            !/L\s*\.?\s*O\s*\.?\s*(?:料理)?\s*$/iu.test(
              segment.slice(Math.max(0, m.index - 20), m.index),
            ),
        )
        .map((m) => ({
          at: m[1],
          services: serviceLabels(segment.slice(0, m.index)),
        }));
      const closings = /定休日|休業|店休|closed|close\s*day/iu.test(segment);
      const special = /24時間営業|２４時間営業|24\s*hours/iu.test(segment)
        ? ['24h']
        : [];
      const lastOrders = [...segment.matchAll(LO_PATTERN)].map((m) => m[1]);
      if (closings && !ranges.length && !special.length)
        closures.push(...assignedDays);
      for (const day of assignedDays)
        byDay[day].push(
          ...ranges.map((r) => ({ ...r })),
          ...seatingTimes,
          ...special,
        );
      if (closings && !ranges.length) unassignedLastOrders.push(...lastOrders);
      else
        for (const day of assignedDays)
          lastOrdersByDay[day].push(...lastOrders);
      segments.push({
        days: assignedDays,
        ranges,
        seatingTimes,
        special,
        closings,
      });
    });
  } else {
    let previousRangeEnd = 0;
    const ranges = [...text.matchAll(TIME_RANGE)].map((m) => {
      const labels = serviceLabels(text.slice(previousRangeEnd, m.index));
      previousRangeEnd = m.index + m[0].length;
      return {
        open: m[1],
        close: m[2],
        overnight: timeToMinutes(m[2]) <= timeToMinutes(m[1]),
        services: labels,
      };
    });
    const rangeSpans = [...text.matchAll(TIME_RANGE)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    const seatingTimes = [...text.matchAll(TIME_POINT)]
      .filter(
        (m) =>
          !rangeSpans.some(([start, end]) => m.index >= start && m.index < end),
      )
      .filter(() => !/(?:L\s*\.?\s*O|ラストオーダー)/iu.test(text))
      .filter(
        (m) =>
          !/L\s*\.?\s*O\s*\.?\s*(?:料理)?\s*$/iu.test(
            text.slice(Math.max(0, m.index - 20), m.index),
          ),
      )
      .map((m) => ({
        at: m[1],
        services: serviceLabels(text.slice(0, m.index)),
      }));
    const special = /24時間営業|２４時間営業|24\s*hours/iu.test(text)
      ? ['24h']
      : [];
    unassignedLastOrders.push(
      ...[...text.matchAll(LO_PATTERN)].map((m) => m[1]),
    );
    unassigned.push(
      ...ranges.map((r) => ({ ...r })),
      ...seatingTimes,
      ...special,
    );
    segments.push({ days: [], ranges, seatingTimes, special, closings: false });
  }
  const has24h = /24時間営業|２４時間営業|24\s*hours/iu.test(text);
  if (
    tokens.length &&
    unassignedLastOrders.length &&
    Object.values(lastOrdersByDay).every((orders) => orders.length === 0)
  ) {
    for (const day of ALL_DAYS) {
      if (byDay[day].length) lastOrdersByDay[day].push(...unassignedLastOrders);
    }
    unassignedLastOrders.length = 0;
  }
  // A literal 24-hour claim without weekday labels is still a non-empty schedule fact.
  if (has24h && !tokens.length && !unassigned.some((x) => x === '24h'))
    unassigned.push('24h');
  const dayLastOrders = ALL_DAYS.map((day) => [
    day,
    [...new Set(lastOrdersByDay[day])].sort((a, b) => a.localeCompare(b)),
  ]);
  const daySignature = ALL_DAYS.map((day) => [
    day,
    normalizeDayFacts(byDay[day]),
  ]);
  const signature = {
    daySchedule: daySignature,
    unassigned: normalizeDayFacts(unassigned),
    closedDays: ALL_DAYS.filter((day) => closures.includes(day)),
    dayLastOrders,
    unassignedLastOrders: [...new Set(unassignedLastOrders)].sort(),
    serviceLabels: serviceLabels(text),
    has24h,
    timeFacts: normalizeDayFacts([
      ...Object.values(byDay).flat(),
      ...unassigned,
    ]),
    dateSchedules: [...new Set(dateSchedules)].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
  for (const supplemental of supplementalHours) {
    if (!supplemental) continue;
    const parsed = parseOperatingHours(supplemental);
    if (!parsed.valid) continue;
    const extraDays = new Map(parsed.signature.daySchedule);
    const hasDayAssignments = [...extraDays.values()].some(
      (facts) => facts.length,
    );
    if (hasDayAssignments) {
      const extraOrders = new Map(parsed.signature.dayLastOrders);
      for (const day of ALL_DAYS) {
        byDay[day].push(...(extraDays.get(day) ?? []));
        lastOrdersByDay[day].push(...(extraOrders.get(day) ?? []));
      }
    } else {
      const targetDays = ALL_DAYS.filter((day) => byDay[day].length > 0);
      for (const fact of parsed.signature.unassigned)
        for (const day of targetDays) byDay[day].push(fact);
      for (const order of parsed.signature.unassignedLastOrders)
        for (const day of targetDays) lastOrdersByDay[day].push(order);
    }
  }
  if (supplementalHours.length) {
    signature.daySchedule = ALL_DAYS.map((day) => [
      day,
      normalizeDayFacts(byDay[day]),
    ]);
    signature.dayLastOrders = ALL_DAYS.map((day) => [
      day,
      [...new Set(lastOrdersByDay[day])].sort((a, b) => a.localeCompare(b)),
    ]);
    signature.timeFacts = normalizeDayFacts([
      ...Object.values(byDay).flat(),
      ...unassigned,
    ]);
  }
  const factCount =
    signature.timeFacts.length +
    signature.closedDays.length +
    signature.dayLastOrders.flatMap(([, times]) => times).length +
    signature.unassignedLastOrders.length;
  if (factCount > 0) return { valid: true, signature, segments };
  return { valid: false, signature, segments };
}

function normalizeDayFacts(facts) {
  const mapped = facts.map((fact) =>
    typeof fact === 'string'
      ? fact
      : fact.at
        ? `time=${fact.at}`
        : `${fact.open}-${fact.close}|overnight=${fact.overnight}|${fact.services.join(',')}`,
  );
  return [...new Set(mapped)].sort((a, b) => a.localeCompare(b));
}

function collapseIdenticalWeekdays(signature) {
  const schedule = new Map(signature.daySchedule);
  const dayLastOrders = new Map(signature.dayLastOrders);
  const firstHours = JSON.stringify(schedule.get(WEEKDAYS[0]));
  const firstOrders = JSON.stringify(dayLastOrders.get(WEEKDAYS[0]));
  if (
    WEEKDAYS.some((day) => JSON.stringify(schedule.get(day)) !== firstHours) ||
    WEEKDAYS.some(
      (day) => JSON.stringify(dayLastOrders.get(day)) !== firstOrders,
    ) ||
    ALL_DAYS.filter((day) => !WEEKDAYS.includes(day)).some(
      (day) => schedule.get(day)?.length || dayLastOrders.get(day)?.length,
    ) ||
    signature.closedDays.length
  )
    return null;
  return {
    daySchedule: ALL_DAYS.map((day) => [day, []]),
    unassigned: [...schedule.get(WEEKDAYS[0])],
    closedDays: [...signature.closedDays],
    dayLastOrders: ALL_DAYS.map((day) => [day, []]),
    unassignedLastOrders: [...dayLastOrders.get(WEEKDAYS[0])],
    has24h: signature.has24h,
    dateSchedules: signature.dateSchedules ?? [],
  };
}

function scheduleEquivalent(left, right) {
  const project = (signature) => ({
    daySchedule: signature.daySchedule,
    unassigned: signature.unassigned,
    closedDays: signature.closedDays,
    dayLastOrders: signature.dayLastOrders,
    unassignedLastOrders: signature.unassignedLastOrders,
    has24h: signature.has24h,
    dateSchedules: signature.dateSchedules ?? [],
  });
  if (JSON.stringify(project(left)) === JSON.stringify(project(right)))
    return true;
  const collapsedLeft = collapseIdenticalWeekdays(left);
  const collapsedRight = collapseIdenticalWeekdays(right);
  return Boolean(
    (collapsedLeft &&
      JSON.stringify(collapsedLeft) === JSON.stringify(project(right))) ||
    (collapsedRight &&
      JSON.stringify(collapsedRight) === JSON.stringify(project(left))),
  );
}

function closureSignature(value) {
  if (typeof value !== 'string' || !value.trim()) return { valid: false };
  const text = value.normalize('NFKC');
  const noFixed =
    /(?:定休日|店休)?(?:なし|無し|無休|年中無休|休みなし|no\s*regular\s*days?\s*off|open\s*(?:all|7)\s*days)/iu.test(
      text,
    );
  const yearRound = /年中無休|無休|毎日営業|open\s*(?:all|7)\s*days/iu.test(
    text,
  );
  const irregular = /不定休|不定休日|irregular(?:ly)?\s*closed/iu.test(text);
  const facilityRule = /(?:施設|商業施設|館|ビル)に準ずる/iu.test(text);
  const holidayOverlapClauses = [
    ...new Set(
      [
        ...text.matchAll(
          /[^。;；,，/／（）()]*祝日[^。;；,，/／（）()]*重な[^。;；,，/／（）()]*/gu,
        ),
      ]
        .map((match) => match[0].trim())
        .filter(Boolean),
    ),
  ];
  const holidayOverlap = holidayOverlapClauses.map((clause) => {
    if (
      /(?:休み|休業|お休み|店休|定休日)(?:とならない|ではない|しない)|営業(?:します|となる|です)/u.test(
        clause,
      )
    )
      return 'open';
    if (/(?:休み|休業|お休み|店休|定休日)/u.test(clause)) return 'closed';
    return normalize(clause);
  });
  const holidayOverlapPolicy = [...new Set(holidayOverlap)].sort();
  const conditionalExceptions = [
    ...new Set(
      [...text.matchAll(/[^。;；,，/／（）()]*場合[^。;；,，/／（）()]*/gu)]
        .filter((match) => !/祝日[^。;；,，/／（）()]*重な/u.test(match[0]))
        .map((match) => normalize(match[0]))
        .filter(Boolean),
    ),
  ].sort();
  const dayText = text
    .replace(/\d{1,2}月\d{1,2}日?/gu, '')
    .replace(/（[^）]*）|\([^)]*\)/gu, '')
    .replace(
      /[^。;；,，/／（）()]*祝日[^。;；,，/／（）()]*重な[^。;；,，/／（）()]*/gu,
      '',
    )
    .replace(/[^。;；,，/／（）()]*場合[^。;；,，/／（）()]*/gu, '')
    .replace(/([月火水木金土日])祝(?!日)/gu, '$1・祝');
  const dayTokens = [...dayText.matchAll(DAY_TOKEN)].map((m) =>
    expandDayGroup(m[1]),
  );
  const closedDays = [...new Set(dayTokens.flat())]
    .filter((day) => ALL_DAYS.includes(day))
    .sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
  if (
    /祝日.{0,24}(?:定休日|休み|休業)|定休日.{0,24}祝日.{0,12}(?:休み|休業)/u.test(
      text,
    ) &&
    !closedDays.includes('祝')
  )
    closedDays.push('祝');
  closedDays.sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
  const cadence = [
    ...new Set(
      (
        text.match(/(?:毎週|隔週|第[0-9０-９一二三四五六七八九十]+週?)/gu) ?? []
      ).map(normalize),
    ),
  ].sort();
  const seasonal = [
    ...new Set(
      (
        text.match(
          /年末年始|年始|年末|夏季|冬季|お盆|ゴールデンウィーク|GW/giu,
        ) ?? []
      ).map(normalize),
    ),
  ].sort();
  const dates = [
    ...new Set(
      text.match(
        /\d{1,2}月\d{1,2}日(?:[〜～~\-–—]\d{1,2}月?\d{1,2}日)?|\d{1,2}\/\d{1,2}(?:[〜～~\-–—]\d{1,2}\/\d{1,2})?/gu,
      ) ?? [],
    ),
  ]
    .map(normalize)
    .sort();
  const valid =
    noFixed ||
    yearRound ||
    irregular ||
    facilityRule ||
    closedDays.length > 0 ||
    cadence.length > 0 ||
    seasonal.length > 0 ||
    dates.length > 0 ||
    conditionalExceptions.length > 0 ||
    holidayOverlapPolicy.length > 0;
  return {
    valid,
    noFixed,
    yearRound,
    irregular,
    facilityRule,
    closedDays,
    cadence,
    seasonal,
    dates,
    conditionalExceptions,
    holidayOverlapPolicy,
  };
}

function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function claimCheck(field, expected, observed, expectedStatus) {
  if (expectedStatus === 'unavailable') {
    const pass = observed === undefined || observed === null;
    return {
      pass,
      failure: pass ? '' : 'unsupported',
      expected: 'unknown',
      observed: observed?.value ?? observed,
    };
  }
  if (!expected || typeof expected.value !== 'string')
    return { pass: false, failure: 'gold_missing' };
  if (!observed || typeof observed.value !== 'string')
    return { pass: false, failure: 'missing' };
  if (
    observed.sourceUrl !== expected.sourceUrl ||
    !isIsoTimestamp(observed.observedAt)
  )
    return { pass: false, failure: 'evidence', sourceUrl: observed.sourceUrl };
  if (field === 'closingNotes') {
    const pass = normalize(expected.value) === normalize(observed.value);
    return {
      pass,
      failure: pass ? '' : 'closing_note_mismatch',
      sourceUrl: observed.sourceUrl,
    };
  }
  if (field === 'openingHours') {
    const a = parseOperatingHours(expected.value);
    const b = parseOperatingHours(observed.value);
    if (!a.valid || !b.valid)
      return {
        pass: false,
        failure: 'unparseable_schedule',
        expectedParseValid: a.valid,
        observedParseValid: b.valid,
      };
    const pass = scheduleEquivalent(a.signature, b.signature);
    return {
      pass,
      failure: pass ? '' : 'schedule_mismatch',
      expected: a.signature,
      observed: b.signature,
      sourceUrl: observed.sourceUrl,
    };
  }
  const a = closureSignature(expected.value);
  const b = closureSignature(observed.value);
  if (!a.valid || !b.valid)
    return { pass: false, failure: 'unparseable_closure' };
  const pass = JSON.stringify(a) === JSON.stringify(b);
  return {
    pass,
    failure: pass
      ? ''
      : b.noFixed && !a.noFixed
        ? 'inferred_no_rest_days'
        : 'closure_mismatch',
    expected: a,
    observed: b,
    sourceUrl: observed.sourceUrl,
  };
}

/** Verify completeness, branch identity, exact evidence URLs, and explicit unknowns. */
export function validateCatalogHoursContract(manifest, inventory) {
  const errors = [];
  const cases = manifest?.cases;
  const inventoryCases = inventory?.cases;
  if (manifest?.schemaVersion !== 1)
    errors.push('manifest schemaVersion must be 1');
  if (!Array.isArray(cases)) errors.push('manifest cases must be an array');
  if (!Array.isArray(inventoryCases))
    errors.push('inventory cases must be an array');
  if (!Array.isArray(cases) || !Array.isArray(inventoryCases))
    return { pass: false, total: 0, errors };
  if (cases.length !== inventoryCases.length)
    errors.push(
      `case count ${cases.length} does not match inventory count ${inventoryCases.length}`,
    );
  const inventoryById = new Map();
  for (const item of inventoryCases) {
    if (!item.itemId || inventoryById.has(item.itemId))
      errors.push(
        `inventory has missing/duplicate itemId: ${item.itemId ?? '(missing)'}`,
      );
    else inventoryById.set(item.itemId, item);
    if (!item.name || !item.address)
      errors.push(
        `inventory identity incomplete: ${item.itemId ?? '(missing)'}`,
      );
  }
  const seen = new Set();
  for (const sample of cases) {
    if (!sample.itemId || seen.has(sample.itemId))
      errors.push(
        `gold has missing/duplicate itemId: ${sample.itemId ?? '(missing)'}`,
      );
    seen.add(sample.itemId);
    const item = inventoryById.get(sample.itemId);
    if (!item) {
      errors.push(`unknown catalog itemId: ${sample.itemId}`);
      continue;
    }
    if (sample.name !== item.name)
      errors.push(`${sample.itemId}: name differs from inventory`);
    if ((sample.listingUrl ?? null) !== (item.listingUrl ?? null))
      errors.push(`${sample.itemId}: listingUrl differs from inventory`);
    if (!['known', 'unavailable'].includes(sample.hoursStatus))
      errors.push(`${sample.itemId}: invalid hoursStatus`);
    if (!['known', 'unavailable'].includes(sample.weeklyClosureStatus))
      errors.push(`${sample.itemId}: invalid weeklyClosureStatus`);
    if (
      !Array.isArray(sample.evidence) ||
      !sample.evidence.length ||
      sample.evidence.some(
        (e) => !e.sourceUrl || typeof e.quote !== 'string' || !e.quote.trim(),
      )
    )
      errors.push(
        `${sample.itemId}: evidence requires sourceUrl and non-empty quote`,
      );
    for (const field of ['openingHours', 'regularClosingDays']) {
      const status =
        field === 'openingHours'
          ? sample.hoursStatus
          : sample.weeklyClosureStatus;
      const claim = sample[field];
      if (status === 'known') {
        if (!claim || typeof claim.value !== 'string' || !claim.value.trim())
          errors.push(`${sample.itemId}: ${field} is known without a value`);
        if (claim && (!claim.sourceUrl || !isIsoTimestamp(claim.observedAt)))
          errors.push(
            `${sample.itemId}: ${field} requires sourceUrl and full ISO timestamp`,
          );
        if (
          claim &&
          !sample.evidence?.some((e) => e.sourceUrl === claim.sourceUrl)
        )
          errors.push(
            `${sample.itemId}: ${field} source is absent from evidence`,
          );
        if (
          field === 'openingHours' &&
          claim &&
          !parseOperatingHours(claim.value).valid
        )
          errors.push(
            `${sample.itemId}: known openingHours has no parseable time facts`,
          );
      } else if (claim !== undefined && claim !== null)
        errors.push(
          `${sample.itemId}: ${field} must be omitted when unavailable`,
        );
      if (
        status === 'unavailable' &&
        (!sample.unavailableReason || !String(sample.unavailableReason).trim())
      )
        errors.push(
          `${sample.itemId}: ${field} unavailable without unavailableReason`,
        );
    }
    for (const alias of sample.verifiedNameAliases ?? []) {
      if (
        !alias.value ||
        alias.sourceUrl !== sample.listingUrl ||
        !alias.evidenceQuote ||
        !normalize(alias.evidenceQuote).includes(normalize(alias.value)) ||
        !normalize(alias.evidenceQuote).includes(normalize(sample.name)) ||
        !sample.evidence?.some((e) => e.sourceUrl === alias.sourceUrl)
      )
        errors.push(
          `${sample.itemId}: verified name alias lacks exact-source evidence`,
        );
    }
    if (sample.closingNotes) {
      if (
        typeof sample.closingNotes.value !== 'string' ||
        !sample.closingNotes.value.trim() ||
        !sample.closingNotes.sourceUrl ||
        !isIsoTimestamp(sample.closingNotes.observedAt)
      )
        errors.push(
          `${sample.itemId}: closingNotes requires value, sourceUrl and full ISO timestamp`,
        );
      if (
        !sample.evidence?.some(
          (e) => e.sourceUrl === sample.closingNotes.sourceUrl,
        )
      )
        errors.push(
          `${sample.itemId}: closingNotes source is absent from evidence`,
        );
    }
  }
  for (const item of inventoryCases)
    if (!seen.has(item.itemId))
      errors.push(`missing gold case for ${item.itemId}`);
  return { pass: errors.length === 0, total: cases.length, errors };
}

/** Score one exact catalog item against its independently sourced gold claims. */
export function scoreCatalogHoursCase(sample, profile) {
  const optionalNote = profile?.closingNotes;
  let closingNotesCheck;
  if (sample.closingNotes) {
    closingNotesCheck = claimCheck(
      'closingNotes',
      sample.closingNotes,
      optionalNote,
      'known',
    );
  } else if (optionalNote === undefined || optionalNote === null) {
    closingNotesCheck = { pass: true, failure: '', expected: 'unknown' };
  } else {
    const supportedQuote = sample.evidence?.some(
      (entry) =>
        entry.sourceUrl === optionalNote.sourceUrl &&
        normalize(entry.quote).includes(normalize(optionalNote.value)),
    );
    const pass =
      typeof optionalNote.value === 'string' &&
      optionalNote.value.trim() &&
      sample.evidence?.some(
        (entry) => entry.sourceUrl === optionalNote.sourceUrl,
      ) &&
      supportedQuote &&
      isIsoTimestamp(optionalNote.observedAt);
    closingNotesCheck = {
      pass: Boolean(pass),
      failure: pass ? '' : 'unsupported',
      expected: 'unknown',
      observed: optionalNote.value,
      sourceUrl: optionalNote.sourceUrl,
    };
  }
  const checks = {
    openingHours: claimCheck(
      'openingHours',
      sample.openingHours,
      profile?.openingHours,
      sample.hoursStatus,
    ),
    regularClosingDays: claimCheck(
      'regularClosingDays',
      sample.regularClosingDays,
      profile?.regularClosingDays,
      sample.weeklyClosureStatus,
    ),
    closingNotes: closingNotesCheck,
  };
  return { pass: Object.values(checks).every((check) => check.pass), checks };
}

export function normalizeCatalogIdentityPart(value) {
  return normalize(value);
}

export function normalizeCatalogAddress(value) {
  const address = String(value ?? '')
    .normalize('NFKC')
    .replace(
      /^(?:(?:日本|Japan)\s*[、,，]?\s*)?(?:〒\s*\d{3}\s*-\s*\d{4}\s*)?/iu,
      '',
    )
    .replace(/[−–—－‐‑‒]/gu, '-')
    .replace(/(\d+)丁目\s*(\d+)番(?:地)?\s*(\d+)号?/gu, '$1-$2-$3')
    .replace(/(\d+)丁目\s*(\d+)-\s*(\d+)/gu, '$1-$2-$3')
    .replace(/(\d+)丁目/gu, '$1-')
    .replace(/(\d+)番(?:地)?/gu, '$1-')
    .replace(/(\d+)号/gu, '$1');
  const streetNumbers = address.match(
    /\d+\s*[-−－]\s*\d+\s*[-−－]\s*\d+/u,
  )?.[0];
  if (!streetNumbers) return normalize(address);
  const numberParts = streetNumbers.split(/\s*[-−－]\s*/u).join('-');
  const locality = address.slice(0, address.indexOf(streetNumbers));
  return `${normalize(locality)}#${numberParts}`;
}

export function exactProfileIdentityMatch(sample, profile) {
  const name =
    typeof profile?.name === 'string' ? profile.name : profile?.name?.value;
  const address =
    typeof profile?.address === 'string'
      ? profile.address
      : profile?.address?.value;
  const canonicalNameMatch =
    typeof name === 'string' &&
    normalizeCatalogIdentityPart(name) ===
      normalizeCatalogIdentityPart(sample.name);
  const verifiedAlias = (sample.verifiedNameAliases ?? []).find(
    (entry) =>
      entry.sourceUrl === sample.listingUrl &&
      normalizeCatalogIdentityPart(name ?? '') ===
        normalizeCatalogIdentityPart(entry.value) &&
      profile?.name?.sourceUrl === entry.sourceUrl &&
      normalize(entry.evidenceQuote).includes(normalize(entry.value)) &&
      normalize(entry.evidenceQuote).includes(normalize(sample.name)),
  );
  return Boolean(
    (canonicalNameMatch || verifiedAlias) &&
    typeof address === 'string' &&
    normalizeCatalogAddress(address) ===
      normalizeCatalogAddress(sample.address),
  );
}

export function exactCandidateMatch(sample, candidate) {
  const name = normalizeCatalogIdentityPart(candidate?.transientName ?? '');
  const address = normalizeCatalogAddress(candidate?.transientAddress ?? '');
  return Boolean(
    name &&
    address &&
    name === normalizeCatalogIdentityPart(sample.name) &&
    address === normalizeCatalogAddress(sample.address),
  );
}

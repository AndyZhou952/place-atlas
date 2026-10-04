const fold = (text) =>
  text.normalize('NFKC').replace(/曜日|[\p{P}\p{Z}\s]/gu, '');
const ranges = (text) =>
  [...text.matchAll(/(\d{1,2}:\d{2})\s*[-〜～–]\s*(\d{1,2}:\d{2})/gu)].map(
    (match) => `${match[1].padStart(5, '0')}-${match[2].padStart(5, '0')}`,
  );

const days = ['月', '火', '水', '木', '金', '土', '日', '祝'];
function schedule(text) {
  const normalized = text.normalize('NFKC');
  const labels = [
    ...normalized.matchAll(
      /(?<![\p{L}])([月火水木金土日](?:曜日|曜)?(?:[・、,\s〜～~-]*[月火水木金土日祝](?:曜日|曜|日)?)*|祝日?)[\s:：\]】]+/gu,
    ),
  ];
  const result = {};
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    const segment = normalized.slice(
      label.index + label[0].length,
      labels[index + 1]?.index,
    );
    const intervals = [...new Set(ranges(segment))].sort((left, right) =>
      left.localeCompare(right),
    );
    if (!intervals.length && !/定休日|休業/gu.test(segment)) continue;
    const dayText = label[1].replace(/曜日|曜|祝日/gu, (word) =>
      word === '祝日' ? '祝' : '',
    );
    const expanded = dayText.replace(
      /([月火水木金土日])[〜～~-]([月火水木金土日])/gu,
      (_, first, last) =>
        days.slice(days.indexOf(first), days.indexOf(last) + 1).join(''),
    );
    for (const day of days.filter((day) => expanded.includes(day))) {
      result[day] = [...new Set([...(result[day] ?? []), ...intervals])].sort(
        (left, right) => left.localeCompare(right),
      );
    }
  }
  return days.map((day) => [day, result[day] ?? null]);
}

/** Captured branch/source and time-range checks; not a universal timetable parser. */
export function scoreRestaurantHours(sample, profile) {
  const checks = {};
  for (const field of ['openingHours', 'regularClosingDays']) {
    const expected = sample[field];
    const observed = profile?.[field];
    if (!expected) {
      checks[field] = {
        pass: !observed,
        failure: observed ? 'unsupported' : '',
        expected: 'unknown',
      };
      continue;
    }
    if (!observed || typeof observed.value !== 'string') {
      checks[field] = { pass: false, failure: 'missing' };
      continue;
    }
    if (
      observed.sourceUrl !== expected.sourceUrl ||
      !/^\d{4}-\d{2}-\d{2}T/u.test(observed.observedAt ?? '')
    ) {
      checks[field] = { pass: false, failure: 'evidence' };
      continue;
    }
    const pass =
      field === 'openingHours'
        ? JSON.stringify(schedule(expected.value)) ===
          JSON.stringify(schedule(observed.value))
        : fold(observed.value) === fold(expected.value);
    checks[field] = {
      pass,
      failure: pass ? '' : 'wrong',
      sourceUrl: observed.sourceUrl,
      observed: observed.value,
    };
  }
  return { pass: Object.values(checks).every((check) => check.pass), checks };
}

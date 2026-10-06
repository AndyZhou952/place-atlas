const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
const dayToken = '(?:祝前日|祝後日|祝翌日|祝日|祝|[月火水木金土日])';
const dayList = `(?:毎日|${dayToken}(?:[・、〜～~－-]${dayToken})*)`;
const clock = '(?:翌)?[0-9０-９]{1,2}[:：][0-9０-９]{2}';
const range = `${clock}\\s*[-–〜～~]\\s*${clock}`;
const order = `(?:(?:料理|ドリンク)?L\\.O\\.\\s*(?:料理|ドリンク)?${clock}(?:\\s*(?:料理|ドリンク)${clock})*|最終入店\\s*${clock})`;
const period = new RegExp(
  `^(?:(?:ランチ|ディナー|昼|夜)\\s*)?${range}(?:\\s*(?:[（(][^()（）]*[）)]|${order}))*`,
);

function typography(value: string): string {
  return value
    .replace(/[０-９：]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(
      /(翌)?(\d{1,2}):(\d{2})/g,
      (_all, next, hour, minute) =>
        `${next ?? ''}${hour.padStart(2, '0')}:${minute}`,
    )
    .replace(
      /(翌)?(\d{2}):(\d{2})\s*[-–〜～~]\s*(翌)?(\d{2}):(\d{2})/g,
      (_all, firstNext, startHour, startMinute, next, endHour, endMinute) => {
        const overnight =
          !next &&
          !firstNext &&
          Number(endHour) < 24 &&
          Number(startHour) * 60 + Number(startMinute) >
            Number(endHour) * 60 + Number(endMinute);
        return `${firstNext ?? ''}${startHour}:${startMinute}–${next || (overnight ? '翌' : '')}${endHour}:${endMinute}`;
      },
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function days(value: string): string[] {
  if (value === '毎日') return [...weekdays, '祝日'];
  const expanded = value.replace(
    /([月火水木金土日])[〜～~－-]([月火水木金土日])/g,
    (original, start, end) => {
      const from = weekdays.indexOf(start),
        to = weekdays.indexOf(end);
      return from <= to ? weekdays.slice(from, to + 1).join('・') : original;
    },
  );
  return expanded.split(/[・、]/).map((day) => (day === '祝' ? '祝日' : day));
}

function dayLabel(values: readonly string[]): string {
  const unique = [...new Set(values)];
  if (weekdays.every((day) => unique.includes(day)) && unique.includes('祝日'))
    return '毎日';
  const result: string[] = [];
  for (let index = 0; index < weekdays.length; index++) {
    if (!unique.includes(weekdays[index])) continue;
    let end = index;
    while (end + 1 < weekdays.length && unique.includes(weekdays[end + 1]))
      end++;
    if (end - index >= 2) result.push(`${weekdays[index]}〜${weekdays[end]}`);
    else result.push(...weekdays.slice(index, end + 1));
    index = end;
  }
  result.push(...unique.filter((day) => !weekdays.includes(day)));
  return result.join('・');
}

function schedule(value: string): { hours: string; note: string } | undefined {
  let remaining = value.trim();
  const segments: string[] = [];
  const simple = remaining.match(/^(24時間営業|定休日)/);
  if (simple) {
    const suffix = remaining.slice(simple[0].length);
    if (
      suffix.trim() &&
      !/^[;；]/.test(suffix.trim()) &&
      !suffix.includes('\n\n')
    ) {
      return { hours: remaining.replace(/\s+/g, ' '), note: '' };
    }
    return {
      hours: simple[0],
      note: suffix.replace(/^[;；。\s]+/, ''),
    };
  }
  while (remaining) {
    const match = remaining.match(period);
    if (!match) break;
    segments.push(typography(match[0]));
    remaining = remaining.slice(match[0].length);
    const separator = remaining.match(/^[\s/、,;；]+/);
    if (separator) remaining = remaining.slice(separator[0].length);
  }
  return segments.length
    ? {
        hours: segments.join(' / '),
        note: remaining.replace(/^[;；\s]+/, '').trim(),
      }
    : undefined;
}

/** Format verified facts only. Unknown wording and conflicting rules stay explicit. */
export function openingHoursPresentation(value: string): {
  lines: readonly string[];
  notes: readonly string[];
} {
  const [source, ...noteParts] = value.trim().split(/\n\s*注意事項\s*\n/);
  const notes = noteParts
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const original = source.trim();
  if (!original) return { lines: [], notes };
  // A secondary facility's hours remain visible with its explicit scope.
  const facilityParts = original.split(
    /[;；\n]\s*(?=\d+F(?:カフェ|レストラン))/i,
  );
  if (facilityParts.length > 1) {
    const primary = openingHoursPresentation(facilityParts[0]);
    return {
      lines: [...primary.lines, ...facilityParts.slice(1).map(typography)],
      notes: [...primary.notes, ...notes],
    };
  }
  const input = original.replace(new RegExp(`\\[(${dayList})\\]`, 'g'), '$1');
  const anchors = [
    ...input.matchAll(
      new RegExp(
        `(?:^|[\\s;；])(${dayList})[：:]?\\s*(?=(?:ランチ|ディナー|昼|夜)\\s*${clock}|${clock}\\s*[-–〜～~]|24時間営業|定休日)`,
        'g',
      ),
    ),
  ];
  const groups: { days: string[]; hours: string }[] = [];
  const loose: string[] = [];
  const add = (body: string, dayValues: string[]) => {
    const parsed = schedule(body);
    if (!parsed) return false;
    // An unrecognized suffix can qualify this particular day or service.
    // Only explicit note boundaries may detach it from the schedule row.
    if (
      parsed.note &&
      anchors.length > 1 &&
      !body.includes('\n\n') &&
      !/^(?:■|※|【|\d{1,2}月\d{1,2}日)/.test(parsed.note)
    ) {
      parsed.hours += `；${parsed.note}`;
      parsed.note = '';
    }
    groups.push({ days: dayValues, hours: parsed.hours });
    if (parsed.note)
      notes.push(
        ...parsed.note
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
    return true;
  };
  if (anchors.length) {
    const prefix = input
      .slice(0, anchors[0].index)
      .trim()
      .replace(/[;；]\s*FAQ lists\s*$/, '');
    if (prefix) {
      const parsed = schedule(prefix);
      if (!parsed || parsed.note) return { lines: original.split('\n'), notes };
      loose.push(parsed.hours);
    }
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const start = anchor.index! + anchor[0].length;
      const body = input.slice(
        start,
        anchors[index + 1]?.index ?? input.length,
      );
      if (!add(body, days(anchor[1])))
        return {
          lines: original.split('\n'),
          notes: noteParts.flatMap((part) => part.split('\n')).filter(Boolean),
        };
    }
  } else {
    const parsed = schedule(input);
    if (!parsed) {
      const paragraphs = original.split(/\n\s*\n/);
      return {
        lines: paragraphs[0].split('\n').map((line) => line.trim()),
        notes: [
          ...paragraphs.slice(1).flatMap((part) => part.split('\n')),
          ...notes,
        ]
          .map((line) => line.trim())
          .filter(Boolean),
      };
    }
    loose.push(parsed.hours);
    if (parsed.note)
      notes.push(
        ...parsed.note
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
  }
  const conflicting = groups.some((group, index) =>
    groups
      .slice(index + 1)
      .some(
        (other) =>
          group.hours !== other.hours &&
          group.days.some((day) => other.days.includes(day)),
      ),
  );
  const merged: typeof groups = [];
  for (const group of groups) {
    const same =
      !conflicting && merged.find((other) => other.hours === group.hours);
    if (same) same.days.push(...group.days);
    else merged.push({ days: [...group.days], hours: group.hours });
  }
  const lines = [
    ...loose.filter((hours) => !merged.some((group) => group.hours === hours)),
    ...merged.map((group) => `${dayLabel(group.days)} ${group.hours}`),
  ];
  return { lines, notes };
}

export function formatOpeningHours(value: string): string {
  const { lines, notes } = openingHoursPresentation(value);
  const formatted =
    lines.join('\n') +
    (notes.length ? `\n\n注意事項\n${notes.join('\n')}` : '');
  // The existing claim boundary permits 1,200 characters. Never truncate facts.
  return value.trim().length <= 1200 && formatted.length > 1200
    ? value.trim()
    : formatted;
}

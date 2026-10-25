// Formats Tabelog business-hours text into compact day groups without inventing facts.
// Unrecognized wording is kept as-is; source advisories move under 注意事項.

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const DAY = '(?:祝前日|祝後日|祝翌日|祝日|祝|[月火水木金土日])';
const DAY_LIST = `(?:毎日|${DAY}(?:[・、〜～~－-]${DAY})*)`;
const CLOCK = '(?:翌)?[0-9０-９]{1,2}[:：][0-9０-９]{2}';
const RANGE = `${CLOCK}\\s*[-–〜～~]\\s*${CLOCK}`;
const LAST_ORDER = `(?:(?:料理|ドリンク)?L\\.O\\.\\s*(?:料理|ドリンク)?${CLOCK}(?:\\s*(?:料理|ドリンク)${CLOCK})*|最終入店\\s*${CLOCK})`;
const PERIOD = new RegExp(
  `^(?:(?:ランチ|ディナー|昼|夜)\\s*)?${RANGE}(?:\\s*(?:[（(][^()（）]*[）)]|${LAST_ORDER}))*`,
);
const NOTE_START = /^(?:■|※|【|\d{1,2}月\d{1,2}日)/;

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function typography(value: string): string {
  return value
    .replace(/[０-９：]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(
      /(翌)?(\d{1,2}):(\d{2})/g,
      (_all, next, h, m) => `${next ?? ''}${h.padStart(2, '0')}:${m}`,
    )
    .replace(
      /(翌)?(\d{2}):(\d{2})\s*[-–〜～~]\s*(翌)?(\d{2}):(\d{2})/g,
      (_all, firstNext, sh, sm, next, eh, em) => {
        const overnight = !next && !firstNext && Number(eh) < 24 && +sh * 60 + +sm > +eh * 60 + +em;
        return `${firstNext ?? ''}${sh}:${sm}–${next || (overnight ? '翌' : '')}${eh}:${em}`;
      },
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function expandDays(value: string): string[] {
  if (value === '毎日') return [...WEEKDAYS, '祝日'];
  return value
    .replace(/([月火水木金土日])[〜～~－-]([月火水木金土日])/g, (original, start, end) => {
      const from = WEEKDAYS.indexOf(start);
      const to = WEEKDAYS.indexOf(end);
      return from <= to ? WEEKDAYS.slice(from, to + 1).join('・') : original;
    })
    .split(/[・、]/)
    .map((day) => (day === '祝' ? '祝日' : day));
}

function dayLabel(values: readonly string[]): string {
  const days = [...new Set(values)];
  if (WEEKDAYS.every((day) => days.includes(day)) && days.includes('祝日')) return '毎日';
  const result: string[] = [];
  for (let index = 0; index < WEEKDAYS.length; index++) {
    if (!days.includes(WEEKDAYS[index])) continue;
    let end = index;
    while (end + 1 < WEEKDAYS.length && days.includes(WEEKDAYS[end + 1])) end++;
    if (end - index >= 2) result.push(`${WEEKDAYS[index]}〜${WEEKDAYS[end]}`);
    else result.push(...WEEKDAYS.slice(index, end + 1));
    index = end;
  }
  return [...result, ...days.filter((day) => !WEEKDAYS.includes(day))].join('・');
}

/** Parse one schedule body into normalized hours plus any trailing note. */
function schedule(value: string): { hours: string; note: string } | undefined {
  let remaining = value.trim();
  const simple = /^(24時間営業|定休日)/.exec(remaining);
  if (simple) {
    const suffix = remaining.slice(simple[0].length);
    if (suffix.trim() && !/^[;；]/.test(suffix.trim()) && !suffix.includes('\n\n')) {
      return { hours: remaining.replace(/\s+/g, ' '), note: '' };
    }
    return { hours: simple[0], note: suffix.replace(/^[;；。\s]+/, '') };
  }
  const segments: string[] = [];
  for (let match = PERIOD.exec(remaining); match; match = PERIOD.exec(remaining)) {
    segments.push(typography(match[0]));
    remaining = remaining.slice(match[0].length).replace(/^[\s/、,;；]+/, '');
  }
  if (!segments.length) return undefined;
  const parsed = { hours: segments.join(' / '), note: remaining.replace(/^[;；\s]+/, '').trim() };
  // A second service's schedule is a fact to display, not an advisory.
  if (parsed.note && new RegExp(RANGE).test(parsed.note) && !NOTE_START.test(parsed.note)) {
    return { hours: `${parsed.hours}；${typography(parsed.note)}`, note: '' };
  }
  return parsed;
}

export function presentOpeningHours(value: string): { lines: string[]; notes: string[] } {
  const [source, ...noteParts] = value.trim().split(/\n\s*注意事項\s*\n/);
  const notes = splitLines(noteParts.join('\n'));
  const original = source.trim();
  if (!original) return { lines: [], notes };
  const verbatim = { lines: original.split('\n'), notes };
  // A secondary facility's hours stay visible with their explicit scope.
  const facilities = original.split(/[;；\n]\s*(?=\d+F(?:カフェ|レストラン))/i);
  if (facilities.length > 1) {
    const primary = presentOpeningHours(facilities[0]);
    return {
      lines: [...primary.lines, ...facilities.slice(1).map(typography)],
      notes: [...primary.notes, ...notes],
    };
  }
  const input = original.replace(new RegExp(`\\[(${DAY_LIST})\\]`, 'g'), '$1');
  const anchors = [
    ...input.matchAll(
      new RegExp(
        `(?:^|[\\s;；])(${DAY_LIST})[：:]?\\s*(?=(?:ランチ|ディナー|昼|夜)\\s*${CLOCK}|${CLOCK}\\s*[-–〜～~]|24時間営業|定休日)`,
        'g',
      ),
    ),
  ];
  const groups: { days: string[]; hours: string }[] = [];
  const loose: string[] = [];
  if (!anchors.length) {
    const parsed = schedule(input);
    if (!parsed) {
      const [first, ...rest] = original.split(/\n\s*\n/);
      return {
        lines: first.split('\n').map((line) => line.trim()),
        notes: [...splitLines(rest.join('\n')), ...notes],
      };
    }
    loose.push(parsed.hours);
    notes.push(...splitLines(parsed.note));
  } else {
    const prefix = input.slice(0, anchors[0].index).trim();
    if (prefix) {
      const parsed = schedule(prefix);
      if (!parsed || parsed.note) return verbatim;
      loose.push(parsed.hours);
    }
    for (const [index, anchor] of anchors.entries()) {
      const body = input.slice(
        anchor.index! + anchor[0].length,
        anchors[index + 1]?.index ?? input.length,
      );
      const parsed = schedule(body);
      if (!parsed) return { lines: verbatim.lines, notes: splitLines(noteParts.join('\n')) };
      // An unrecognized suffix qualifies its own day unless explicitly marked as a note.
      if (
        parsed.note &&
        anchors.length > 1 &&
        !body.includes('\n\n') &&
        !NOTE_START.test(parsed.note)
      ) {
        parsed.hours += `；${parsed.note}`;
        parsed.note = '';
      }
      groups.push({ days: expandDays(anchor[1]), hours: parsed.hours });
      notes.push(...splitLines(parsed.note));
    }
  }
  const conflicting = groups.some((group, index) =>
    groups
      .slice(index + 1)
      .some(
        (other) =>
          group.hours !== other.hours && group.days.some((day) => other.days.includes(day)),
      ),
  );
  const merged: typeof groups = [];
  for (const group of groups) {
    const same = !conflicting && merged.find((other) => other.hours === group.hours);
    if (same) same.days.push(...group.days);
    else merged.push({ days: [...group.days], hours: group.hours });
  }
  return {
    lines: [
      ...loose.filter((hours) => !merged.some((group) => group.hours === hours)),
      ...merged.map((group) => `${dayLabel(group.days)} ${group.hours}`),
    ],
    notes,
  };
}

/** Storage form: grouped lines, then advisories under 注意事項. Never truncates facts. */
export function formatOpeningHours(value: string): string {
  const { lines, notes } = presentOpeningHours(value);
  const formatted = lines.join('\n') + (notes.length ? `\n\n注意事項\n${notes.join('\n')}` : '');
  return formatted.length > 1200 && value.trim().length <= 1200 ? value.trim() : formatted;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOpeningHours, presentOpeningHours } from '../src/shared/hours.ts';

// Literal expectations: input → stored form. Formatting the output again must not change it.
const CASES: [string, string][] = [
  ['月・火・水・木・金 11:00 - 20:00', '月〜金 11:00–20:00'],
  [
    '月・火・水・木・金・土・日 11:00 - 20:00 ■ 定休日 不定休',
    '月〜日 11:00–20:00\n\n注意事項\n■ 定休日 不定休',
  ],
  [
    '月・火・水・木・金 17:00 - 23:00 土・日・祝日 12:00 - 14:00 L.O. 13:00 17:00 - 22:00',
    '月〜金 17:00–23:00\n土・日・祝日 12:00–14:00 L.O. 13:00 / 17:00–22:00',
  ],
  [
    '月・火・水・木・金 08:15 - 14:30 土・日・祝日 定休日',
    '月〜金 08:15–14:30\n土・日・祝日 定休日',
  ],
  [
    '月 11:00 - 22:00 火 11:00 - 22:00 水 11:00 - 22:00 木 11:00 - 22:00 金 11:00 - 22:00 土 11:00 - 22:00 日・祝日 11:00 - 22:00',
    '毎日 11:00–22:00',
  ],
  ['金 18:00 - 2:00', '金 18:00–翌02:00'],
  ['１１：００～２０：００', '11:00–20:00'],
  ['24時間営業', '24時間営業'],
  ['不規則なため、店舗にお問い合わせください', '不規則なため、店舗にお問い合わせください'],
];

for (const [input, expected] of CASES) {
  test(`hours: ${input.slice(0, 30)}`, () => {
    assert.equal(formatOpeningHours(input), expected);
    assert.equal(formatOpeningHours(expected), expected, 'idempotent');
  });
}

test('days with overlapping, different hours are not merged', () => {
  assert.deepEqual(presentOpeningHours('月・火 11:00 - 15:00 月 17:00 - 22:00').lines, [
    '月・火 11:00–15:00',
    '月 17:00–22:00',
  ]);
});

test('long advisories are never truncated', () => {
  const source = `金 18:00-2:00\n${'注'.repeat(1180)}`;
  assert.equal(formatOpeningHours(source), source);
});

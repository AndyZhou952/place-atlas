import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exactCandidateMatch,
  exactProfileIdentityMatch,
  parseOperatingHours,
  scoreCatalogHoursCase,
} from './catalog-hours-score.mjs';

const timestamp = '2026-10-04T05:45:41.000Z';
const expected = {
  itemId: 'one',
  name: 'Branch A',
  listingUrl: 'https://tabelog.com/x/1/',
  hoursStatus: 'known',
  weeklyClosureStatus: 'known',
  openingHours: {
    value:
      '月〜金：ランチ 11:30 - 14:00; ディナー 17:00 - 23:00 L.O. 22:30\n土・日・祝日：12:00 - 15:00',
    sourceUrl: 'https://tabelog.com/x/1/',
    observedAt: timestamp,
  },
  regularClosingDays: {
    value: '日曜日・祝日、年末年始',
    sourceUrl: 'https://tabelog.com/x/1/',
    observedAt: timestamp,
  },
};
const claim = (value, sourceUrl = expected.listingUrl) => ({
  value,
  sourceUrl,
  observedAt: timestamp,
});

test('day/time scorer preserves grouped assignments, service periods, and last orders', () => {
  const pass = scoreCatalogHoursCase(expected, {
    openingHours: claim(
      '月・火・水・木・金 ランチ 11:30〜14:00 ディナー 17:00～23:00（L.O.22:30）; 土・日・祝 12:00 - 15:00',
    ),
    regularClosingDays: claim('日祝、年末年始'),
  });
  assert.equal(pass.pass, true, JSON.stringify(pass.checks));
  assert.equal(
    parseOperatingHours('月～金 11:30-14:00; 土日祝 12:00-15:00').valid,
    true,
  );
});

test('weekday-specific rows and a grouped row preserve the same assigned L.O.', () => {
  const expectedClaim = claim(
    '月～金 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30; 土日祝 12:00-15:00 L.O.14:30',
  );
  const observedClaim = claim(
    '月 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30\n火 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30\n水 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30\n木 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30\n金 11:30-14:00 L.O.13:30 / 17:00-23:00 L.O.22:30\n土 12:00-15:00 L.O.14:30\n日 12:00-15:00 L.O.14:30\n祝日 12:00-15:00 L.O.14:30',
  );
  assert.equal(
    scoreCatalogHoursCase(
      { ...expected, openingHours: expectedClaim },
      {
        openingHours: observedClaim,
        regularClosingDays: claim(expected.regularClosingDays.value),
      },
    ).pass,
    true,
  );
  const wrongHoliday = claim(
    observedClaim.value.replace('祝日 12:00-15:00', '祝日 11:00-15:00'),
  );
  assert.equal(
    scoreCatalogHoursCase(
      { ...expected, openingHours: expectedClaim },
      {
        openingHours: wrongHoliday,
        regularClosingDays: claim(expected.regularClosingDays.value),
      },
    ).pass,
    false,
  );
});

test('omitting a weekday, swapping day assignments, changing a close or dropping L.O. fails', () => {
  for (const value of [
    '月・火・木・金 ランチ 11:30-14:00 ディナー 17:00-23:00 L.O.22:30; 土・日・祝 12:00-15:00',
    '月～木 ランチ 11:30-14:00 ディナー 17:00-23:00 L.O.22:30; 金・土・日・祝 12:00-15:00',
    '月～金 ランチ 11:30-14:00 ディナー 17:00-22:00 L.O.22:30; 土・日・祝 12:00-15:00',
    '月～金 ランチ 11:30-14:00 ディナー 17:00-23:00; 土・日・祝 12:00-15:00',
  ]) {
    assert.equal(
      scoreCatalogHoursCase(expected, {
        openingHours: claim(value),
        regularClosingDays: claim(expected.regularClosingDays.value),
      }).pass,
      false,
      value,
    );
  }
});

test('overnight, 24-hour service and a schedule with no parseable facts cannot pass as empty', () => {
  assert.equal(
    parseOperatingHours('毎日 18:00 - 翌03:30').signature.timeFacts.some(
      (fact) => fact.includes('overnight=true'),
    ),
    true,
  );
  assert.equal(parseOperatingHours('月～日 24時間営業').signature.has24h, true);
  assert.equal(parseOperatingHours('店休日は要確認').valid, false);
  assert.equal(parseOperatingHours('月〜金 99:99 - 120:00').valid, false);
  const allDay = { ...expected, openingHours: claim('月～日 24時間営業') };
  assert.equal(
    scoreCatalogHoursCase(allDay, {
      openingHours: claim('月～日 11:00-23:00'),
      regularClosingDays: claim(expected.regularClosingDays.value),
    }).pass,
    false,
  );
});

test('bracketed weekday ranges, 24-hour text, and editorial entry/maintenance times are parsed without reassignment', () => {
  const bracketed = parseOperatingHours('[月]～[日] 24時間営業');
  assert.deepEqual(
    bracketed.signature.daySchedule.slice(0, 7).map(([, facts]) => facts),
    Array.from({ length: 7 }, () => ['24h']),
  );
  const entry = parseOperatingHours(
    '月～金 08:15 - 14:30 土・日・祝日 定休日 ■入店時間 8:15～、8:45～、9:30～ 営業時間・定休日は変更となる場合がございます。',
  );
  assert.equal(
    entry.segments.flatMap((segment) => segment.seatingTimes).length,
    0,
  );
  assert.deepEqual(entry.signature.closedDays, ['土', '日', '祝']);
  const bookingSlots = parseOperatingHours(
    '予約による２部制 ①15:00～ ②18:00～ ■ 定休日 日曜・祝日',
  );
  assert.deepEqual(bookingSlots.signature.unassigned, [
    'time=15:00',
    'time=18:00',
  ]);
  const distinctHolidayDays = parseOperatingHours(
    '月～土 18:00-22:30; 日・祝日 定休日; 祝前日・祝後日 18:00-22:30',
  );
  assert.notDeepEqual(
    distinctHolidayDays.signature.daySchedule.find(
      ([day]) => day === '祝前日',
    )[1],
    distinctHolidayDays.signature.daySchedule.find(([day]) => day === '祝')[1],
  );
});

test('exact source and an actual full ISO observation timestamp are required', () => {
  const hours = claim(
    expected.openingHours.value,
    'https://tabelog.com/neighbor/',
  );
  const stale = {
    ...claim(expected.openingHours.value),
    observedAt: '2026-10-04',
  };
  for (const openingHours of [hours, stale]) {
    assert.equal(
      scoreCatalogHoursCase(expected, {
        openingHours,
        regularClosingDays: claim(expected.regularClosingDays.value),
      }).pass,
      false,
    );
  }
});

test('unknown closure policy passes only when no closure claim is invented', () => {
  const unknown = {
    ...expected,
    weeklyClosureStatus: 'unavailable',
    regularClosingDays: undefined,
    unavailableReason: 'Full page checked; no explicit weekly rule.',
  };
  assert.equal(
    scoreCatalogHoursCase(unknown, {
      openingHours: claim(expected.openingHours.value),
    }).pass,
    true,
  );
  for (const value of ['定休日なし', '年中無休', '日曜日']) {
    const result = scoreCatalogHoursCase(unknown, {
      openingHours: claim(expected.openingHours.value),
      regularClosingDays: claim(value),
    });
    assert.equal(result.pass, false, value);
    assert.equal(result.checks.regularClosingDays.failure, 'unsupported');
  }
});

test('Sunday連休 exception preserves its meaning without inferring Monday as a rest day', () => {
  const expectedClosure = claim('日曜日（日月連休の場合い日曜日営業）');
  const sample = {
    ...expected,
    regularClosingDays: expectedClosure,
  };
  const observed = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('日 / 日月連休の場合い日曜日営業'),
  });
  assert.equal(observed.checks.regularClosingDays.pass, true);

  const droppedException = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('日曜日'),
  });
  assert.equal(
    droppedException.checks.regularClosingDays.failure,
    'closure_mismatch',
  );

  const falseMonday = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('日・月 / 日月連休の場合い日曜日営業'),
  });
  assert.equal(
    falseMonday.checks.regularClosingDays.failure,
    'closure_mismatch',
  );
});

test('holiday overlap keeps the weekly rest day closed without treating holidays as a rest day', () => {
  const sourceStyle = claim('火曜日・木曜日（祝日と重なっても休み）');
  const sample = { ...expected, regularClosingDays: sourceStyle };
  const equivalent = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim(
      '火・木 / ※定休日が祝日と重なった場合もお休みとなります。',
    ),
  });
  assert.equal(equivalent.checks.regularClosingDays.pass, true);

  const omitted = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('火・木'),
  });
  assert.equal(omitted.checks.regularClosingDays.failure, 'closure_mismatch');

  const reversed = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('火・木 / 祝日と重なった場合は営業します。'),
  });
  assert.equal(reversed.checks.regularClosingDays.failure, 'closure_mismatch');

  const wrongDay = scoreCatalogHoursCase(sample, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('火・水 / 祝日と重なっても休み'),
  });
  assert.equal(wrongDay.checks.regularClosingDays.failure, 'closure_mismatch');
});

test('optional closing notes pass only when their exact source quote supports them', () => {
  const seasonal = {
    ...expected,
    weeklyClosureStatus: 'unavailable',
    regularClosingDays: undefined,
    unavailableReason: 'Checked current branch page.',
    evidence: [
      {
        sourceUrl: expected.listingUrl,
        quote: '年末年始は休業します',
      },
    ],
  };
  const sourcedNote = claim('年末年始は休業します');
  assert.equal(
    scoreCatalogHoursCase(seasonal, {
      openingHours: claim(expected.openingHours.value),
      closingNotes: sourcedNote,
    }).pass,
    true,
  );
  const unsupported = claim('夏季休業します');
  const result = scoreCatalogHoursCase(seasonal, {
    openingHours: claim(expected.openingHours.value),
    closingNotes: unsupported,
  });
  assert.equal(result.checks.closingNotes.failure, 'unsupported');
});

test('a sourced no-fixed-rest-days claim is distinguished from irregular or seasonal closure', () => {
  const noFixed = {
    ...expected,
    weeklyClosureStatus: 'known',
    regularClosingDays: claim('定休日なし'),
  };
  const trueNoFixed = scoreCatalogHoursCase(noFixed, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('定休日なし'),
  });
  assert.equal(trueNoFixed.pass, true);
  const falseNoFixed = scoreCatalogHoursCase(noFixed, {
    openingHours: claim(expected.openingHours.value),
    regularClosingDays: claim('不定休'),
  });
  assert.equal(
    falseNoFixed.checks.regularClosingDays.failure,
    'closure_mismatch',
  );
  const onlySeason = {
    ...expected,
    weeklyClosureStatus: 'unavailable',
    regularClosingDays: undefined,
    closingNotes: {
      value: '年末年始休業',
      sourceUrl: expected.listingUrl,
      observedAt: timestamp,
    },
  };
  assert.equal(
    scoreCatalogHoursCase(onlySeason, {
      openingHours: claim(expected.openingHours.value),
      closingNotes: claim(onlySeason.closingNotes.value),
    }).pass,
    true,
  );
});

test('candidate selection requires exact normalized branch name and full address', () => {
  const item = {
    name: '牛たん 荒 新宿西口店',
    address: '東京都新宿区西新宿1-16-4 井門西新宿ビル B2F',
  };
  assert.equal(
    exactCandidateMatch(item, {
      transientName: item.name,
      transientAddress: item.address,
    }),
    true,
  );
  assert.equal(
    exactCandidateMatch(item, {
      transientName: item.name,
      transientAddress: '東京都新宿区西新宿1-16-5 井門西新宿ビル B2F',
    }),
    false,
  );
  assert.equal(
    exactCandidateMatch(item, {
      transientName: '牛たん 荒',
      transientAddress: item.address,
    }),
    false,
  );
  assert.equal(
    exactCandidateMatch(
      { name: 'Branch', address: '東京都新宿区西新宿3-4-11' },
      {
        transientName: 'Branch',
        transientAddress: '東京都新宿区西新宿3丁目4番11号',
      },
    ),
    true,
  );
  assert.equal(
    exactCandidateMatch(
      { name: 'Branch', address: '東京都新宿区西新宿3-41-11' },
      {
        transientName: 'Branch',
        transientAddress: '東京都新宿区西新宿3丁目4番12号',
      },
    ),
    false,
  );
  assert.equal(
    exactCandidateMatch(
      { name: 'Branch', address: '東京都新宿区西新宿3-4-11' },
      {
        transientName: 'Branch',
        transientAddress: '東京都渋谷区西新宿3丁目4番11号',
      },
    ),
    false,
  );
  const exact = {
    name: 'Branch',
    address: '東京都新宿区西新宿3-4-11',
  };
  assert.equal(
    exactProfileIdentityMatch(exact, {
      name: { value: 'Branch' },
      address: { value: '東京都新宿区西新宿3丁目4番11号' },
    }),
    true,
  );
  assert.equal(exactProfileIdentityMatch(exact, { name: 'Branch' }), false);
  assert.equal(
    exactProfileIdentityMatch(exact, {
      name: 'Branch',
      address: '東京都新宿区西新宿3-4-12',
    }),
    false,
  );
  const rodeo = {
    name: 'RODEO',
    address: '東京都目黒区中目黒３丁目５−１',
  };
  assert.equal(
    exactProfileIdentityMatch(rodeo, {
      name: { value: 'RODEO' },
      address: { value: '日本、〒153-0061 東京都目黒区中目黒３丁目５−１' },
    }),
    true,
  );
  assert.equal(
    exactProfileIdentityMatch(rodeo, {
      name: { value: 'RODEO' },
      address: {
        value: 'Japan, 〒153-0061 東京都目黒区中目黒3丁目5番1号 ビル2F',
      },
    }),
    true,
  );
  for (const address of [
    '日本、〒153-0061 東京都渋谷区中目黒３丁目５−１',
    '日本、〒153-0061 東京都目黒区中目黒３丁目５−２',
    '韓国、〒153-0061 東京都目黒区中目黒３丁目５−１',
  ]) {
    assert.equal(
      exactProfileIdentityMatch(rodeo, {
        name: { value: 'RODEO' },
        address: { value: address },
      }),
      false,
      address,
    );
  }
  assert.equal(
    exactProfileIdentityMatch(
      {
        name: 'すし酒場 さしす',
        address: '大阪府大阪市北区梅田１丁目１−３ 大阪駅前第3ビル B100 B1F-68',
      },
      {
        name: { value: 'すし酒場 さしす' },
        address: {
          value: '大阪府大阪市北区梅田1-1-3-B100 大阪駅前第3ビル B1F-68',
        },
      },
    ),
    true,
  );
  const gancon = {
    name: 'GANCON NOODLE',
    listingUrl: 'https://tabelog.com/tokyo/A1323/A132301/13147756/',
    address: '東京都北区中里1-3-3 板橋ビル 1F',
    verifiedNameAliases: [
      {
        value: 'ガンコンヌードル',
        sourceUrl: 'https://tabelog.com/tokyo/A1323/A132301/13147756/',
        evidenceQuote: 'ガンコンヌードル （GANCON NOODLE）',
      },
    ],
  };
  assert.equal(
    exactProfileIdentityMatch(gancon, {
      name: {
        value: 'ガンコンヌードル',
        sourceUrl: gancon.listingUrl,
      },
      address: { value: gancon.address },
    }),
    true,
  );
  assert.equal(
    exactProfileIdentityMatch(
      { ...gancon, listingUrl: 'https://tabelog.com/neighbor/' },
      {
        name: {
          value: 'ガンコンヌードル',
          sourceUrl: 'https://tabelog.com/neighbor/',
        },
        address: { value: gancon.address },
      },
    ),
    false,
  );
  assert.equal(
    exactProfileIdentityMatch(gancon, {
      name: {
        value: 'ガンコンヌードル',
        sourceUrl: gancon.listingUrl,
      },
      address: { value: gancon.address },
    }),
    true,
  );
  assert.equal(
    exactProfileIdentityMatch(
      {
        ...gancon,
        verifiedNameAliases: [
          {
            ...gancon.verifiedNameAliases[0],
            evidenceQuote: 'ガンコンヌードル',
          },
        ],
      },
      {
        name: { value: 'ガンコンヌードル', sourceUrl: gancon.listingUrl },
        address: { value: gancon.address },
      },
    ),
    false,
  );
  assert.equal(
    exactProfileIdentityMatch(
      {
        name: 'たん焼 忍',
        address: '東京都新宿区四谷三栄町１４−４ 松啓ビル 1Ｆ',
      },
      {
        name: { value: 'たん焼 忍' },
        address: { value: '東京都新宿区四谷三栄町14-4 松啓ビル 1F' },
      },
    ),
    true,
  );
  assert.equal(
    exactProfileIdentityMatch(
      {
        name: '松戸富田麺絆',
        address: '東京都千代田区丸の内２丁目７−２ KITTE丸の内 KITTE GRANCHE',
      },
      {
        name: { value: '松戸富田麺絆' },
        address: { value: '東京都千代田区丸の内2-7-2 KITTE丸の内 B1F' },
      },
    ),
    true,
  );
});

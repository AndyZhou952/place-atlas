import assert from 'node:assert/strict';
import test from 'node:test';

import { presentWechatCatalogIntake } from './wechat-catalog-intake-presenter.ts';

test('presents at most three bounded candidates without durable or internal identity', () => {
  const reply = presentWechatCatalogIntake({
    state: 'candidates',
    output: {
      status: 'candidates_ready',
      sessionId: 'secret-session',
      sessionVersion: 7,
      candidates: Array.from({ length: 4 }, (_, index) => ({
        ordinal: index + 4,
        transientName: `${'🍣'.repeat(90)}-${index}`,
        transientAddress: `${'東京都中央区銀座'.repeat(40)}-${index}`,
        attribution: {
          label: `Google Maps ${'地'.repeat(60)}`,
          url: `https://maps.example/secret-${index}`,
        },
      })),
      hasMore: true,
      expiresAt: '2026-09-24T12:00:00.000Z',
    },
  });

  assert.match(reply, /^Japan Atlas｜请选择餐厅\n\n4\. /u);
  assert.match(reply, /地址：/u);
  assert.match(reply, /来源：Google Maps/u);
  assert.match(reply, /回复：\/jpmap add select <编号>$/u);
  assert.doesNotMatch(reply, /secret-session|maps\.example|7\. /u);
  assert.equal(Array.from(reply).length <= 1_200, true);
  assert.equal((reply.match(/\n\d+\. /gu) ?? []).length, 3);
  assert.equal(reply.includes('6. '), true);
  assert.equal(reply.includes('7. '), false);
  assert.equal(reply.includes('…'), true);
});

test('preserves required candidate and preview rows at every legal schema maximum', () => {
  const candidateReply = presentWechatCatalogIntake({
    state: 'candidates',
    output: {
      status: 'candidates_ready',
      sessionId: 's'.repeat(200),
      sessionVersion: Number.MAX_SAFE_INTEGER,
      candidates: Array.from({ length: 3 }, (_, index) => ({
        ordinal: index + 1,
        transientName: String(index + 1).repeat(500),
        transientAddress: '地'.repeat(500),
        attribution: {
          label: '源'.repeat(120),
          url: `https://maps.example/${String(index + 1)}`,
        },
      })),
      hasMore: true,
      expiresAt: '9999-12-31T23:59:59.999Z',
    },
  });
  assert.equal(Array.from(candidateReply).length <= 1_200, true);
  assert.equal((candidateReply.match(/地址：/gu) ?? []).length, 3);
  assert.equal((candidateReply.match(/来源：/gu) ?? []).length, 3);
  assert.match(candidateReply, /回复：\/jpmap add select <编号>$/u);

  const schemaMaximumPreview = previewFixture({
    ownerFields: {
      title: '店'.repeat(200),
      area: '区'.repeat(120),
      address: '址'.repeat(500),
      coordinates: { latitude: 90, longitude: 180 },
    },
    tabelog: {
      status: 'known',
      score: 5,
      reviewCount: 2_147_483_647,
      url: 'https://tabelog.com/tokyo/A1/A1/1/',
      provenance: 'owner_asserted',
      assertedAt: '9999-12-31T23:59:59.999Z',
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: '予'.repeat(500),
      advanceDays: 3_650,
      bookingWindowLabel: '窓'.repeat(500),
      releaseNote: '注'.repeat(500),
      channel: '渠'.repeat(120),
      url: 'https://restaurant.example/reservations',
      provenance: 'owner_asserted',
      assertedAt: '9999-12-31T23:59:59.999Z',
      freshness: 'fresh',
    },
    unknownFields: [],
  });
  const ordinary = presentWechatCatalogIntake({
    state: 'preview',
    preview: schemaMaximumPreview,
  });
  assertRequiredPreviewRows(ordinary, '保存：');
  assert.equal(Array.from(ordinary).length <= 900, true);

  const warned = presentWechatCatalogIntake({
    state: 'conflict',
    preview: {
      ...schemaMaximumPreview,
      suspectedDuplicates: [
        {
          itemId: 'a'.repeat(200),
          title: '重'.repeat(200),
          address: '址'.repeat(500),
          match: 'strong',
        },
        {
          itemId: 'b'.repeat(200),
          title: '似'.repeat(200),
          address: '址'.repeat(500),
          match: 'weak',
        },
      ],
      warnings: [
        { code: 'source_conflict', message: '密'.repeat(500) },
        { code: 'needs_review', message: '密'.repeat(500) },
        { code: 'provider_unavailable', message: '密'.repeat(500) },
        { code: 'stale_evidence', message: '密'.repeat(500) },
      ],
    },
  });
  assertRequiredPreviewRows(warned, '同意新版：');
  assert.equal(Array.from(warned).length <= 1_200, true);
  assert.doesNotMatch(warned, /密{2}|a{20}|b{20}/u);
});

test('presents the compact preview allowlist with code-point bounds', () => {
  const reply = presentWechatCatalogIntake({
    state: 'preview',
    preview: previewFixture({
      ownerFields: {
        title: '🍣'.repeat(100),
        area: '銀座'.repeat(30),
        address: '東京都中央区銀座'.repeat(40),
      },
      reservation: {
        status: 'known',
        mode: 'reservation_required',
        label: '需要预约'.repeat(80),
        advanceDays: 365,
        bookingWindowLabel: '预约窗口'.repeat(80),
        releaseNote: '每月开放'.repeat(80),
        channel: '官方网站'.repeat(80),
        url: 'https://restaurant.example/private',
        provenance: 'agent_observed',
        observedAt: '2026-09-24T10:00:00.000Z',
        freshness: 'fresh',
      },
      unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
    }),
  });

  assert.match(reply, /^Japan Atlas｜请确认\n\n餐厅：/u);
  assert.match(reply, /\n区域：/u);
  assert.match(reply, /\n地址：/u);
  assert.match(reply, /\n地图定位：已确认/u);
  assert.match(reply, /\nTabelog：4\.21 · 321 条评价/u);
  assert.match(reply, /\n预约：需要预约需要预约/u);
  assert.match(reply, /\n\n待补充：地址，地图定位，Tabelog，预约/u);
  assert.match(
    reply,
    /\n\n保存：\/jpmap add confirm\n取消：\/jpmap add cancel$/u,
  );
  for (const forbidden of [
    'secret-session',
    'google_places',
    'place-secret',
    '35.671',
    '139.765',
    'evidenceDigest',
    'OpenStreetMap',
    'maps.example',
    'ODbL',
    'receipt',
  ]) {
    assert.equal(reply.includes(forbidden), false, forbidden);
  }
  for (const [label, maximum] of [
    ['餐厅：', 80],
    ['区域：', 40],
    ['地址：', 180],
    ['Tabelog：', 40],
    ['预约：', 140],
    ['待补充：', 120],
  ]) {
    const line = reply
      .split('\n')
      .find((candidate) => candidate.startsWith(label));
    assert.ok(line, label);
    assert.equal(Array.from(line.slice(label.length)).length <= maximum, true);
  }
  assert.equal(Array.from(reply).length <= 900, true);
});

test('prioritizes canonical warnings and makes a conflict explicitly no-write', () => {
  const reply = presentWechatCatalogIntake({
    state: 'conflict',
    preview: previewFixture({
      suspectedDuplicates: [
        { itemId: 'z', title: 'Weak first in source', match: 'weak' },
        { itemId: 'b', title: 'Strong B', match: 'strong' },
        { itemId: 'a', title: 'Strong A', match: 'strong' },
      ],
      warnings: [
        { code: 'stale_evidence', message: 'RAW STALE SECRET' },
        { code: 'provider_unavailable', message: 'RAW PROVIDER SECRET' },
        { code: 'needs_review', message: 'RAW REVIEW SECRET' },
        { code: 'source_conflict', message: 'RAW CONFLICT SECRET' },
      ],
    }),
  });

  assert.match(reply, /^资料有变化，本次尚未写入。/u);
  const strongA = reply.indexOf('可能与已有地点重复：Strong A');
  const strongB = reply.indexOf('可能与已有地点重复：Strong B');
  const sourceConflict = reply.indexOf('来源信息有冲突');
  assert.equal(
    strongA > 0 && strongA < strongB && strongB < sourceConflict,
    true,
  );
  assert.match(reply, /更多证据请在网页 Owner 预览查看/u);
  assert.doesNotMatch(reply, /RAW|Weak first|itemId/u);
  assert.match(
    reply,
    /同意新版：\/jpmap add confirm\n取消：\/jpmap add cancel$/u,
  );
  assert.equal(Array.from(reply).length <= 1_200, true);
});

test('covers success, cancel, expiry, failed-no-write, and operation failures with closed messages', () => {
  const cases = [
    [
      { state: 'success', status: 'committed_verified' },
      'Japan Atlas｜已保存并加入地图。',
    ],
    [
      { state: 'success', status: 'committed_needs_review' },
      'Japan Atlas｜已保存到 Owner 待审核；补全地址或定位后才会进入地图和 Nearby。',
    ],
    [
      { state: 'success', status: 'reused_existing' },
      'Japan Atlas｜已关联已有地点，没有重复建档。',
    ],
    [{ state: 'cancelled' }, 'Japan Atlas｜本次 Add 已取消。'],
    [
      { state: 'expired' },
      'Japan Atlas｜本次 Add 已过期，没有写入。请重新发送 /jpmap add <餐厅名>。',
    ],
    [
      { state: 'failed_no_write' },
      'Japan Atlas｜本次没有写入。请重新查看 preview 后重试，或发送 /jpmap add cancel。',
    ],
    [
      { state: 'operation_failure', kind: 'dependency_failure' },
      'Japan Atlas｜添加功能暂时不可用，请稍后重试。',
    ],
    [
      { state: 'operation_failure', kind: 'not_found' },
      'Japan Atlas｜当前对话没有可继续的 Add。请先发送 /jpmap add <餐厅名>。',
    ],
    [
      { state: 'operation_failure', kind: 'conflict' },
      'Japan Atlas｜Add 阶段已经变化，请按当前回复中的下一步指令操作。',
    ],
  ];

  for (const [input, expected] of cases) {
    assert.equal(presentWechatCatalogIntake(input), expected);
  }
});

test('presents authentication and throttling failures as closed channel-safe text', () => {
  for (const [kind, expected] of [
    ['unauthorized', 'Japan Atlas｜Owner 身份未通过验证，本次没有写入。'],
    ['forbidden', 'Japan Atlas｜Owner 身份未通过验证，本次没有写入。'],
    ['rate_limited', 'Japan Atlas｜添加功能暂时不可用，请稍后重试。'],
  ]) {
    const reply = presentWechatCatalogIntake({
      state: 'operation_failure',
      kind,
    });
    assert.equal(reply, expected);
    assert.doesNotMatch(reply, /unauthorized|forbidden|rate_limited|secret/iu);
  }
});

function assertRequiredPreviewRows(reply, commandPrefix) {
  for (const row of [
    '餐厅：',
    '区域：',
    '地址：',
    '地图定位：',
    'Tabelog：',
    '预约：',
  ]) {
    assert.match(reply, new RegExp(`(?:^|\\n)${row}`, 'u'), row);
  }
  assert.match(
    reply,
    new RegExp(
      `\\n\\n${commandPrefix}\\/jpmap add confirm\\n取消：\\/jpmap add cancel$`,
      'u',
    ),
  );
  assert.doesNotMatch(reply, /回复过长/u);
}

function previewFixture(overrides = {}) {
  return {
    sessionId: 'secret-session',
    previewVersion: 4,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google_places',
      placeId: 'place-secret',
    },
    ownerFields: { title: '鮨青空', area: '銀座' },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: '東京都中央区銀座1-1-1',
      sourceUrl: 'https://maps.example/private',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-24T10:00:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '東京都中央区銀座1-1-1',
      latitude: 35.671,
      longitude: 139.765,
      provider: 'Nominatim',
      sourceUrl: 'https://maps.example/private',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-24T10:00:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.21,
      reviewCount: 321,
      url: 'https://tabelog.example/private',
      provenance: 'agent_observed',
      observedAt: '2026-09-24T10:00:00.000Z',
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: '需要预约',
      advanceDays: 30,
      channel: '官网',
      url: 'https://restaurant.example/private',
      provenance: 'agent_observed',
      observedAt: '2026-09-24T10:00:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [],
    unknownFields: [],
    warnings: [],
    evidenceDigest: 'secret-evidence-digest',
    catalogRevision: 'secret-revision',
    expiresAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

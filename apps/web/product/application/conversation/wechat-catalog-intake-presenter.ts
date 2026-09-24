import type {
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakePreview,
  CatalogIntakeSelectOutput,
  CatalogIntakeWarning,
} from '../catalog-intake/catalog-intake-coordinator.ts';

export type WechatCatalogIntakeOperationFailureKind =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'dependency_failure'
  | 'rate_limited'
  | 'unexpected_failure';

export type WechatCatalogIntakePresentation =
  | {
      readonly state: 'candidates';
      readonly output: CatalogIntakeDiscoverOutput;
    }
  | { readonly state: 'no_candidates' }
  | {
      readonly state: 'clarification';
      readonly output: Extract<
        CatalogIntakeSelectOutput,
        { readonly status: 'clarification_required' }
      >;
    }
  | { readonly state: 'preview'; readonly preview: CatalogIntakePreview }
  | { readonly state: 'conflict'; readonly preview: CatalogIntakePreview }
  | {
      readonly state: 'success';
      readonly status: Extract<
        CatalogIntakeConfirmOutput,
        { readonly replayed: boolean }
      >['status'];
    }
  | { readonly state: 'cancelled' }
  | { readonly state: 'expired' }
  | { readonly state: 'failed_no_write' }
  | {
      readonly state: 'operation_failure';
      readonly kind: WechatCatalogIntakeOperationFailureKind;
    };

export interface WechatCatalogIntakePresenter {
  present(presentation: WechatCatalogIntakePresentation): string;
}

const fieldLimits = {
  candidateName: 80,
  candidateAddress: 240,
  attribution: 40,
  title: 80,
  area: 40,
  address: 180,
  tabelog: 40,
  reservation: 140,
  unknown: 120,
  clarification: 240,
  warning: 160,
} as const;

const replyLimits = {
  candidates: 1_200,
  preview: 900,
  warnedPreview: 1_200,
} as const;

export function presentWechatCatalogIntake(
  presentation: WechatCatalogIntakePresentation,
): string {
  switch (presentation.state) {
    case 'candidates':
      return presentCandidates(presentation.output);
    case 'no_candidates':
      return 'Japan Atlas｜没有找到明确候选。请补充分店、街区或完整地址后重新 Add。';
    case 'clarification':
      return `Japan Atlas｜需要补充信息\n\n${truncateCodePoints(
        presentation.output.clarification.prompt,
        fieldLimits.clarification,
      )}\n\n请补充后重新发送 /jpmap add <餐厅名 + 分店或街区>。`;
    case 'preview':
      return presentPreview(presentation.preview, false);
    case 'conflict':
      return presentPreview(presentation.preview, true);
    case 'success':
      return presentSuccess(presentation.status);
    case 'cancelled':
      return 'Japan Atlas｜本次 Add 已取消。';
    case 'expired':
      return 'Japan Atlas｜本次 Add 已过期，没有写入。请重新发送 /jpmap add <餐厅名>。';
    case 'failed_no_write':
      return 'Japan Atlas｜本次没有写入。请重新查看 preview 后重试，或发送 /jpmap add cancel。';
    case 'operation_failure':
      return presentOperationFailure(presentation.kind);
  }
}

export const wechatCatalogIntakePresenter: WechatCatalogIntakePresenter = {
  present: presentWechatCatalogIntake,
};

function presentCandidates(output: CatalogIntakeDiscoverOutput): string {
  if (!output.candidates.length) {
    return presentWechatCatalogIntake({ state: 'no_candidates' });
  }
  const candidates = output.candidates
    .slice(0, 3)
    .map((candidate) =>
      [
        `${candidate.ordinal}. ${truncateCodePoints(
          candidate.transientName,
          fieldLimits.candidateName,
        )}`,
        `   地址：${truncateCodePoints(
          candidate.transientAddress,
          fieldLimits.candidateAddress,
        )}`,
        `   来源：${truncateCodePoints(
          candidate.attribution.label,
          fieldLimits.attribution,
        )}`,
      ].join('\n'),
    );
  const reply = [
    'Japan Atlas｜请选择餐厅',
    ...candidates,
    '回复：/jpmap add select <编号>',
  ].join('\n\n');
  return requireBoundedReply(reply, replyLimits.candidates);
}

function presentPreview(
  preview: CatalogIntakePreview,
  conflict: boolean,
): string {
  const title =
    preview.ownerFields.title ?? preview.titleProposal?.value ?? '待补充';
  const area = preview.ownerFields.area;
  const address =
    preview.ownerFields.address ??
    preview.addressProposal?.value ??
    (preview.locationEvidence.status === 'known'
      ? 'normalizedAddress' in preview.locationEvidence
        ? preview.locationEvidence.normalizedAddress
        : preview.locationEvidence.address
      : undefined) ??
    '待补充';
  const facts = [
    'Japan Atlas｜请确认',
    '',
    `餐厅：${truncateCodePoints(title, fieldLimits.title)}`,
    ...(area ? [`区域：${truncateCodePoints(area, fieldLimits.area)}`] : []),
    `地址：${truncateCodePoints(address, fieldLimits.address)}`,
    `地图定位：${
      preview.locationEvidence.status === 'known' ? '已确认' : '待补充'
    }`,
    `Tabelog：${truncateCodePoints(
      tabelogValue(preview),
      fieldLimits.tabelog,
    )}`,
    `预约：${truncateCodePoints(
      reservationValue(preview),
      fieldLimits.reservation,
    )}`,
  ];
  if (preview.unknownFields.length) {
    facts.push(
      '',
      `待补充：${truncateCodePoints(
        preview.unknownFields.map(unknownFieldLabel).join('，'),
        fieldLimits.unknown,
      )}`,
    );
  }

  const commandLines = conflict
    ? ['同意新版：/jpmap add confirm', '取消：/jpmap add cancel']
    : ['保存：/jpmap add confirm', '取消：/jpmap add cancel'];
  const prefix = conflict ? ['资料有变化，本次尚未写入。', ''] : [];
  const warnings = prioritizedWarnings(preview);
  const hasWarnings = warnings.length > 0;
  const maximum =
    hasWarnings || conflict ? replyLimits.warnedPreview : replyLimits.preview;
  const selectedWarnings: string[] = [];
  for (const warning of warnings) {
    const candidate = [
      ...prefix,
      ...facts,
      '',
      ...selectedWarnings,
      warning,
      '',
      ...commandLines,
    ].join('\n');
    if (codePointLength(candidate) <= maximum) selectedWarnings.push(warning);
  }
  if (selectedWarnings.length < warnings.length) {
    const folded = '更多证据请在网页 Owner 预览查看';
    const candidate = [
      ...prefix,
      ...facts,
      '',
      ...selectedWarnings,
      folded,
      '',
      ...commandLines,
    ].join('\n');
    if (codePointLength(candidate) <= maximum) selectedWarnings.push(folded);
  }
  const reply = [
    ...prefix,
    ...facts,
    ...(selectedWarnings.length ? ['', ...selectedWarnings] : []),
    '',
    ...commandLines,
  ].join('\n');
  return requireBoundedReply(reply, maximum);
}

function tabelogValue(preview: CatalogIntakePreview): string {
  if (preview.tabelog.status === 'unknown') return '未找到';
  return `${preview.tabelog.score.toFixed(2)}${
    preview.tabelog.reviewCount === undefined
      ? ''
      : ` · ${preview.tabelog.reviewCount} 条评价`
  }`;
}

function reservationValue(preview: CatalogIntakePreview): string {
  if (preview.reservation.status === 'unknown') return '未知';
  return [
    preview.reservation.label,
    preview.reservation.advanceDays === undefined
      ? undefined
      : `建议提前 ${preview.reservation.advanceDays} 天`,
    preview.reservation.bookingWindowLabel,
    preview.reservation.releaseNote,
    preview.reservation.channel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function unknownFieldLabel(
  field: CatalogIntakePreview['unknownFields'][number],
): string {
  const labels = {
    address: '地址',
    coordinates: '地图定位',
    tabelog: 'Tabelog',
    reservation: '预约',
  } as const;
  return labels[field];
}

type PrioritizedWarning =
  | {
      readonly kind: 'duplicate';
      readonly match: 'strong' | 'weak';
      readonly itemId: string;
      readonly title: string;
    }
  | { readonly kind: 'warning'; readonly warning: CatalogIntakeWarning };

function prioritizedWarnings(preview: CatalogIntakePreview): readonly string[] {
  const duplicates = preview.suspectedDuplicates;
  const strong = duplicates
    .filter((duplicate) => duplicate.match === 'strong')
    .sort((left, right) => left.itemId.localeCompare(right.itemId))
    .map(
      (duplicate): PrioritizedWarning => ({
        kind: 'duplicate',
        match: 'strong',
        itemId: duplicate.itemId,
        title: duplicate.title,
      }),
    );
  const weak = duplicates
    .filter((duplicate) => duplicate.match === 'weak')
    .sort((left, right) => left.itemId.localeCompare(right.itemId))
    .map(
      (duplicate): PrioritizedWarning => ({
        kind: 'duplicate',
        match: 'weak',
        itemId: duplicate.itemId,
        title: duplicate.title,
      }),
    );
  const byCode = new Map(
    preview.warnings.map((warning) => [warning.code, warning]),
  );
  const warning = (code: CatalogIntakeWarning['code']) => {
    const match = byCode.get(code);
    return match
      ? ([{ kind: 'warning', warning: match }] satisfies PrioritizedWarning[])
      : [];
  };
  const ordered: readonly PrioritizedWarning[] = [
    ...strong,
    ...warning('source_conflict'),
    ...warning('needs_review'),
    ...warning('provider_unavailable'),
    ...weak,
    ...warning('stale_evidence'),
  ];
  return ordered
    .slice(0, 3)
    .map((item) =>
      truncateCodePoints(`⚠️ ${warningMessage(item)}`, fieldLimits.warning),
    )
    .concat(ordered.length > 3 ? ['更多证据请在网页 Owner 预览查看'] : []);
}

function warningMessage(item: PrioritizedWarning): string {
  if (item.kind === 'duplicate') {
    return `${
      item.match === 'strong' ? '可能与已有地点重复' : '可能存在相似地点'
    }：${truncateCodePoints(item.title, fieldLimits.title)}`;
  }
  const messages: Readonly<Record<CatalogIntakeWarning['code'], string>> = {
    source_conflict: '来源信息有冲突，请在网页 Owner 预览核对。',
    needs_review: '信息仍需 Owner 审核。',
    provider_unavailable: '部分资料来源暂时不可用。',
    stale_evidence: '部分资料可能已过期，请在网页 Owner 预览核对。',
  };
  return messages[item.warning.code];
}

function presentSuccess(
  status: Extract<
    CatalogIntakeConfirmOutput,
    { readonly replayed: boolean }
  >['status'],
): string {
  const replies = {
    committed_verified: 'Japan Atlas｜已保存并加入地图。',
    committed_needs_review:
      'Japan Atlas｜已保存到 Owner 待审核；补全地址或定位后才会进入地图和 Nearby。',
    reused_existing: 'Japan Atlas｜已关联已有地点，没有重复建档。',
  } as const;
  return replies[status];
}

function presentOperationFailure(
  kind: Extract<
    WechatCatalogIntakePresentation,
    { readonly state: 'operation_failure' }
  >['kind'],
): string {
  if (kind === 'dependency_failure' || kind === 'rate_limited') {
    return 'Japan Atlas｜添加功能暂时不可用，请稍后重试。';
  }
  if (kind === 'not_found') {
    return 'Japan Atlas｜当前对话没有可继续的 Add。请先发送 /jpmap add <餐厅名>。';
  }
  if (kind === 'conflict') {
    return 'Japan Atlas｜Add 阶段已经变化，请按当前回复中的下一步指令操作。';
  }
  if (kind === 'unauthorized' || kind === 'forbidden') {
    return 'Japan Atlas｜Owner 身份未通过验证，本次没有写入。';
  }
  if (kind === 'invalid_input') {
    return 'Japan Atlas｜Add 输入无效，本次没有写入。请检查命令后重试。';
  }
  return 'Japan Atlas｜Add 请求未能完成，本次没有写入。请稍后重试。';
}

export function truncateCodePoints(value: string, maximum: number): string {
  const points = Array.from(value.normalize('NFC').trim());
  if (points.length <= maximum) return points.join('');
  if (maximum <= 0) return '';
  return `${points.slice(0, Math.max(0, maximum - 1)).join('')}…`;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function requireBoundedReply(value: string, maximum: number): string {
  if (codePointLength(value) > maximum || value.length > 4_096) {
    return 'Japan Atlas｜Add 回复过长，本次没有写入。请在网页 Owner 预览查看。';
  }
  return value;
}

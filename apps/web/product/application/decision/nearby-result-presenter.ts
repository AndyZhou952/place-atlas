import type { EntryAccessSnapshot } from './entry-access.ts';
import { isEffectivelyVisited } from '../assessments/effective-visited.ts';

export interface NearbyRouteReceipt {
  readonly mode: 'walking' | 'direct_transit';
  readonly durationMinutes: number;
  readonly checkedAt: string;
  readonly source: { readonly label: string; readonly url: string };
}

export interface NearbyVisitReceipt {
  readonly manualVisited: boolean;
  readonly visitCount: number;
  readonly latestVisitAt?: string;
  readonly personalRating?: number;
}

export interface NearbyExternalRatingReceipt {
  readonly platform: string;
  readonly score: number;
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly reviewCount?: number;
}

export interface NearbyReceiptCandidate {
  readonly itemId: string;
  readonly name: string;
  readonly kind: string;
  readonly area: string;
  readonly address: string;
  readonly straightLineDistanceKm: number;
  readonly route?: NearbyRouteReceipt;
  readonly visit: NearbyVisitReceipt;
  readonly entryAccess: EntryAccessSnapshot;
  readonly reservation: { readonly label: string; readonly checkedAt: string };
  readonly externalRating?: NearbyExternalRatingReceipt;
  readonly reason: string;
  readonly warnings: readonly string[];
  readonly mapDeepLink: string;
}

export interface NearbyWechatReceipt {
  readonly resolvedLocation: string;
  readonly recommendations: readonly NearbyReceiptCandidate[];
}

export function presentNearbyWechatReceipt(
  result: NearbyWechatReceipt,
): string {
  const heading = `Japan Atlas｜附近推荐：${result.resolvedLocation}`;
  if (result.recommendations.length === 0) {
    return `${heading}\n暂时没有找到符合条件的地点。`;
  }
  return [
    heading,
    ...result.recommendations.slice(0, 5).map(presentCandidate),
  ].join('\n\n');
}

function presentCandidate(
  candidate: NearbyReceiptCandidate,
  index: number,
): string {
  const effectivelyVisited = isEffectivelyVisited(
    candidate.visit.manualVisited,
    candidate.visit.visitCount,
  );
  const lines = [
    `${index + 1}. ${candidate.name}（${candidate.kind} · ${candidate.area}）`,
    `条目：${candidate.itemId}`,
    `地址：${candidate.address}`,
    `直线距离：${candidate.straightLineDistanceKm.toFixed(1)} km`,
    presentRoute(candidate.route),
    presentVisit(candidate.visit, effectivelyVisited),
    presentPersonalRating(candidate.visit.personalRating, effectivelyVisited),
    presentExternalRating(candidate.externalRating),
    presentWalkIn(candidate.entryAccess),
    presentQueue(candidate.entryAccess),
    `预约：${candidate.reservation.label} · 核验：${candidate.reservation.checkedAt}`,
    `推荐理由：${candidate.reason}`,
    ...candidate.warnings.map((warning) => `警告：${warning}`),
    `地图：${candidate.mapDeepLink}`,
  ];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}

function presentRoute(route: NearbyRouteReceipt | undefined): string {
  if (!route) return '路线：未知';
  const label = route.mode === 'walking' ? '步行' : '电车直达';
  return `路线：${label} ${route.durationMinutes} 分钟 · 核验：${route.checkedAt} · 来源：${route.source.label} ${route.source.url}`;
}

function presentVisit(
  visit: NearbyVisitReceipt,
  effectivelyVisited: boolean,
): string {
  const status = effectivelyVisited ? '已到访' : '未到访';
  const latest = visit.latestVisitAt ? ` · 最近：${visit.latestVisitAt}` : '';
  return `到访：${status} · ${visit.visitCount} 次${latest}`;
}

function presentPersonalRating(
  rating: number | undefined,
  effectivelyVisited: boolean,
): string {
  if (!effectivelyVisited || rating === undefined) {
    return '个人评分：仅在到访后显示';
  }
  return `个人评分：${rating}/5`;
}

function presentExternalRating(
  rating: NearbyExternalRatingReceipt | undefined,
): string | undefined {
  if (!rating) return undefined;
  const reviewCount =
    rating.reviewCount === undefined ? '' : ` · ${rating.reviewCount} 条评论`;
  return `外部评分（${rating.platform}）：${rating.score}/5${reviewCount} · 来源：${rating.sourceUrl} · 核验：${rating.checkedAt}`;
}

function presentWalkIn(entryAccess: EntryAccessSnapshot): string {
  const assertion = entryAccess.walkInAssertion;
  const label =
    assertion.status === 'confirmed'
      ? '可直接到店'
      : assertion.status === 'reservation_required'
        ? '需要预约'
        : '未知';
  return presentAssertion('到店', label, assertion);
}

function presentQueue(entryAccess: EntryAccessSnapshot): string {
  const assertion = entryAccess.queueAssertion;
  const label =
    assertion.status === 'none_reported'
      ? '来源报告当前无需排队'
      : assertion.status === 'waiting_reported'
        ? assertion.waitingMinutes === undefined
          ? '已报告排队（时长未知）'
          : `已报告排队（约 ${assertion.waitingMinutes} 分钟）`
        : '未知';
  return presentAssertion('排队', label, assertion);
}

function presentAssertion(
  title: string,
  label: string,
  assertion: {
    readonly sourceUrl?: string;
    readonly checkedAt?: string;
    readonly warning?: string;
  },
): string {
  const provenance =
    assertion.sourceUrl && assertion.checkedAt
      ? ` · 来源：${assertion.sourceUrl} · 核验：${assertion.checkedAt}`
      : '';
  const warning = assertion.warning ? ` · 警告：${assertion.warning}` : '';
  return `${title}：${label}${provenance}${warning}`;
}

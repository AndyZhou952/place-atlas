import type {
  NearbyRecommendCandidate,
  NearbyRecommendResult,
} from '../decision/agent-nearby-operation.ts';
import { presentNearbyWechatReceipt } from '../decision/nearby-result-presenter.ts';

export function presentNearbyWechatResult(
  result: NearbyRecommendResult,
): string {
  if (result.status === 'ambiguous') {
    const choices = result.candidates
      .slice(0, 3)
      .map((candidate, index) => `${index + 1}. ${candidate.canonicalAddress}`);
    return [
      'Japan Atlas｜这个位置有多个可能，请选择更具体的地址：',
      ...choices,
      attributionLine(result),
    ].join('\n');
  }
  if (result.status === 'unresolved') {
    return [
      `Japan Atlas｜无法确认位置：${result.warning}`,
      result.provenance
        ? `位置查询：${result.provenance.sourceUrl} · 核验：${result.provenance.checkedAt} · 策略：${result.provenance.providerId}/${result.provenance.policyVersion}`
        : '位置来源：不可用（未获得本次查询的可审计来源）',
    ].join('\n');
  }
  return [
    attributionLine(result),
    presentNearbyWechatReceipt({
      resolvedLocation: result.resolvedLocation,
      recommendations: result.recommendations.map(toReceiptCandidate),
    }),
  ].join('\n');
}

function attributionLine(
  result: Extract<
    NearbyRecommendResult,
    { readonly status: 'resolved' | 'ambiguous' }
  >,
): string {
  return `位置来源：${result.attribution.label} · 查询：${result.provenance.sourceUrl} · 核验：${result.provenance.checkedAt} · 策略：${result.provenance.providerId}/${result.provenance.policyVersion}`;
}

function toReceiptCandidate(candidate: NearbyRecommendCandidate) {
  return candidate;
}

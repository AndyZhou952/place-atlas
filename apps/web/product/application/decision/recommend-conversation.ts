import type {
  RecommendDecisionSuggestion,
  RecommendReasonFact,
} from './recommend-decision.ts';

export interface RecommendConversationInput {
  readonly query: string;
  readonly replies: readonly string[];
  readonly originChoice?: {
    readonly hint: string;
    readonly id: string;
  };
}

export type RecommendClarificationKind =
  | 'origin'
  | 'exact_origin'
  | 'origin_choice'
  | 'branch'
  | 'unresolved_origin'
  | 'full_address_or_link'
  | 'travel_mode';

export interface RecommendClarificationOption {
  readonly id: string;
  readonly label: string;
}

export interface RecommendConversationItem extends RecommendDecisionSuggestion {
  readonly name: string;
  readonly address: string;
  readonly reasonFacts: readonly RecommendReasonFact[];
  readonly warnings: readonly string[];
  readonly entryEvidence?: {
    readonly mode: 'walk-in';
    readonly label: string;
    readonly url: string;
    readonly checkedAt: string;
  };
  readonly route?: {
    readonly mode: 'walk' | 'transit';
    readonly seconds: number;
    readonly checkedAt: string;
    readonly source: { readonly label: string; readonly url: string };
  };
}

export type RecommendConversationOutput =
  | {
      readonly status: 'clarify';
      readonly clarification: RecommendClarificationKind;
      readonly question: string;
      readonly options?: readonly RecommendClarificationOption[];
      readonly originHint?: string;
    }
  | {
      readonly status: 'recommend';
      readonly recommendations: readonly RecommendConversationItem[];
      readonly warnings: readonly string[];
    }
  | { readonly status: 'no_results'; readonly message: string }
  | {
      readonly status: 'unavailable';
      readonly message: string;
      readonly retryable: boolean;
    };

export function parseRecommendConversationInput(
  value: unknown,
): RecommendConversationInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.query !== 'string' ||
    !Array.isArray(record.replies) ||
    record.replies.length > 3
  )
    return undefined;
  const query = record.query.trim();
  if (!query || query.length > 1000) return undefined;
  const replies = record.replies.map((reply) =>
    typeof reply === 'string' ? reply.trim() : '',
  );
  if (replies.some((reply) => !reply || reply.length > 300)) return undefined;
  const rawChoice = record.originChoice;
  if (rawChoice !== undefined) {
    if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice))
      return undefined;
    const choice = rawChoice as Record<string, unknown>;
    if (
      typeof choice.hint !== 'string' ||
      typeof choice.id !== 'string' ||
      !choice.hint.trim() ||
      choice.hint.length > 200 ||
      !choice.id.trim() ||
      choice.id.length > 300 ||
      replies.at(-1) !== choice.id
    )
      return undefined;
    return {
      query,
      replies,
      originChoice: { hint: choice.hint.trim(), id: choice.id },
    };
  }
  return { query, replies };
}

export function appendRecommendReply(
  input: RecommendConversationInput,
  answer: string,
): RecommendConversationInput | undefined {
  return parseRecommendConversationInput({
    query: input.query,
    replies: [...input.replies, answer],
  });
}

export function appendRecommendChoice(
  input: RecommendConversationInput,
  hint: string,
  id: string,
): RecommendConversationInput | undefined {
  return parseRecommendConversationInput({
    query: input.query,
    replies: [...input.replies, id],
    originChoice: { hint, id },
  });
}

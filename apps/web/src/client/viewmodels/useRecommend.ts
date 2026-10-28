import { useState } from 'react';
import {
  type RecommendConversationInput,
  type RecommendConversationOutput,
  appendRecommendChoice,
  appendRecommendReply,
} from '../../shared/recommend-conversation.ts';
import { api } from '../api.ts';

/** Recommend view-model: one request plus any clarification replies, as a conversation. */
export function useRecommend() {
  const [query, setQueryValue] = useState('');
  const [active, setActive] = useState<RecommendConversationInput>();
  const [reply, setReply] = useState('');
  const [result, setResult] = useState<RecommendConversationOutput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(input: RecommendConversationInput) {
    setBusy(true);
    setError('');
    setActive(input);
    try {
      setResult(await api.recommend(input));
    } catch {
      setResult({
        status: 'unavailable',
        message: 'Recommendations are temporarily unavailable. Please retry.',
        retryable: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return {
    query,
    reply,
    result,
    busy,
    error,
    active,
    setReply,
    setQuery(value: string) {
      setQueryValue(value);
      if (active && value.trim() !== active.query) {
        setActive(undefined);
        setReply('');
        setResult(undefined);
      }
    },
    submitQuery() {
      const next = query.trim();
      if (!next) return setError('Enter a food, area, station or copied place.');
      setReply('');
      setResult(undefined);
      void ask({ query: next, replies: [] });
    },
    submitReply() {
      const next = active && appendRecommendReply(active, reply);
      if (!next) return setError('Enter a short answer to continue.');
      setReply('');
      void ask(next);
    },
    choose(option: { readonly id: string; readonly label: string }) {
      if (!active || result?.status !== 'clarify') return;
      const next = result.originHint
        ? appendRecommendChoice(active, result.originHint, option.id)
        : appendRecommendReply(active, option.label);
      if (next) void ask(next);
    },
    retry() {
      if (active) void ask(active);
    },
    restart() {
      setQueryValue('');
      setActive(undefined);
      setReply('');
      setResult(undefined);
      setError('');
    },
  };
}

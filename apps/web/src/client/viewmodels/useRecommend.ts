import { useState } from 'react';
import type { RecommendResult } from '../../shared/types.ts';
import { api } from '../api.ts';

export function useRecommend() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RecommendResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask() {
    if (!query.trim()) return setError('Describe what you would like to eat, and where.');
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      setResult(await api.recommend(query.trim()));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Recommendations are unavailable. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return { query, setQuery, result, busy, error, ask };
}

export type RecommendViewModel = ReturnType<typeof useRecommend>;

'use client';

import { type SyntheticEvent, useState } from 'react';
import { Clock3, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  appendRecommendReply,
  type RecommendConversationInput,
  type RecommendConversationOutput,
} from '@/product/application/decision/recommend-conversation';

import { browserAtlasApplication } from './atlas-api-client';

export function RecommendSearch({
  onSelect,
}: {
  readonly onSelect: (itemId: string) => void;
}) {
  const [query, setQuery] = useState('');
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
      setResult(
        await browserAtlasApplication.execute({ key: 'recommend.ask', input }),
      );
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

  function submitQuery(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    if (!next) {
      setError('Enter a food, area, station or copied place.');
      return;
    }
    setReply('');
    setResult(undefined);
    void ask({ query: next, replies: [] });
  }

  function submitReply(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const next = appendRecommendReply(active, reply);
    if (!next) {
      setError('Enter a short answer to continue.');
      return;
    }
    setReply('');
    void ask(next);
  }

  function restart() {
    setQuery('');
    setActive(undefined);
    setReply('');
    setResult(undefined);
    setError('');
    document.querySelector<HTMLInputElement>('#nearby-location')?.focus();
  }

  return (
    <section className="nearby-console" aria-labelledby="recommend-title">
      <header>
        <div>
          <p className="eyebrow">Saved catalog</p>
          <h3 id="recommend-title">Recommend a restaurant</h3>
        </div>
        <span>Ask in your own words</span>
      </header>
      <form className="nearby-search" onSubmit={submitQuery} aria-busy={busy}>
        <label htmlFor="nearby-location">
          What would you like to eat, and where?
        </label>
        <div className="nearby-search-row">
          <Input
            id="nearby-location"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (active && value.trim() !== active.query) {
                setActive(undefined);
                setReply('');
                setResult(undefined);
              }
            }}
            placeholder="e.g. 新宿で焼き鳥 or 銀座駅から徒歩10分の寿司"
            maxLength={1000}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !query.trim()}>
            <Sparkles data-icon="inline-start" />
            {busy ? 'Checking…' : 'Recommend'}
          </Button>
        </div>
        <small>
          Suggestions come from your saved restaurants. Route times appear only
          when checked.
        </small>
      </form>
      {busy ? (
        <output className="nearby-progress" aria-live="polite">
          <Clock3 aria-hidden="true" /> Checking your saved places…
        </output>
      ) : null}
      {error ? (
        <p className="nearby-error" role="alert">
          {error}
        </p>
      ) : null}
      {result?.status === 'clarify' ? (
        <div className="nearby-state" aria-live="polite">
          <strong>{result.question}</strong>
          {result.options?.length ? (
            <fieldset className="recommend-choices">
              <legend className="sr-only">Starting point choices</legend>
              {result.options.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="outline"
                  disabled={busy || !active}
                  onClick={() => {
                    if (!active) return;
                    const next = appendRecommendReply(active, option.label);
                    if (next) void ask(next);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </fieldset>
          ) : null}
          <form className="nearby-search" onSubmit={submitReply}>
            <label htmlFor="recommend-reply">Your answer</label>
            <div className="nearby-search-row">
              <Input
                id="recommend-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                maxLength={300}
                disabled={busy}
                placeholder="Station, address or branch"
              />
              <Button type="submit" disabled={busy || !reply.trim()}>
                Continue
              </Button>
            </div>
          </form>
          <Button type="button" variant="ghost" onClick={restart}>
            Start over
          </Button>
        </div>
      ) : null}
      {result?.status === 'unavailable' ? (
        <div className="nearby-state" role="alert">
          <strong>{result.message}</strong>
          <Button
            type="button"
            onClick={() => active && void ask(active)}
            disabled={busy || !active}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {result?.status === 'no_results' ? (
        <output className="nearby-state">
          <strong>{result.message}</strong>
          <span>Try a different food or area.</span>
        </output>
      ) : null}
      {result?.status === 'recommend' ? (
        <div className="nearby-resolved">
          <ol
            className="nearby-results"
            aria-label="Saved restaurant recommendations"
          >
            {result.recommendations.map((candidate, index) => (
              <li key={candidate.itemId}>
                <button
                  type="button"
                  className="nearby-candidate"
                  onClick={() => onSelect(candidate.detailTargetId)}
                >
                  <span className="nearby-order" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="nearby-candidate-copy">
                    <strong>{candidate.name}</strong>
                    <span>{candidate.address}</span>
                  </span>
                </button>
                <p className="nearby-reason">{candidate.reason}</p>
                {candidate.route ? (
                  <p className="nearby-evidence">
                    {candidate.route.mode === 'walk' ? 'Walk' : 'Direct train'}{' '}
                    · {Math.ceil(candidate.route.seconds / 60)} min ·{' '}
                    <a
                      href={candidate.route.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {candidate.route.source.label}
                    </a>{' '}
                    · checked{' '}
                    {new Date(candidate.route.checkedAt).toLocaleString()}
                  </p>
                ) : null}
                {candidate.warnings.length ? (
                  <ul className="nearby-warnings">
                    {candidate.warnings.map((warning) => (
                      <li key={warning}>{recommendWarningLabel(warning)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function recommendWarningLabel(code: string): string {
  switch (code) {
    case 'unverified_travel_time':
      return 'Travel time is not verified; distance is straight-line only.';
    case 'walk_in_unknown':
      return 'Walk-in and queue status are unknown.';
    default:
      return code.replaceAll('_', ' ');
  }
}

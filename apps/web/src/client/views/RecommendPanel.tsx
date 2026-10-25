import { Clock3, Sparkles } from 'lucide-react';
import { useRecommend } from '../viewmodels/useRecommend.ts';

/** Recommend from the saved catalog, asking for a starting point or branch when needed. */
export function RecommendPanel({ onSelect }: { readonly onSelect: (itemId: string) => void }) {
  const recommend = useRecommend();
  const { result, busy } = recommend;
  return (
    <section className="nearby-console" aria-labelledby="recommend-title">
      <header>
        <div>
          <p className="eyebrow">Saved catalog</p>
          <h3 id="recommend-title">Recommend a restaurant</h3>
        </div>
        <span>Ask in your own words</span>
      </header>
      <form
        className="nearby-search"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          recommend.submitQuery();
        }}
      >
        <label htmlFor="nearby-location">What would you like to eat, and where?</label>
        <div className="nearby-search-row">
          <input
            id="nearby-location"
            value={recommend.query}
            onChange={(event) => recommend.setQuery(event.target.value)}
            placeholder="e.g. 新宿で焼き鳥 or 銀座駅から徒歩10分の寿司"
            maxLength={1000}
            disabled={busy}
          />
          <button type="submit" className="button" disabled={busy || !recommend.query.trim()}>
            <Sparkles aria-hidden="true" />
            {busy ? 'Checking…' : 'Recommend'}
          </button>
        </div>
        <small>
          Suggestions come from your saved restaurants. Route times appear only when checked.
        </small>
      </form>
      {busy ? (
        <output className="nearby-progress" aria-live="polite">
          <Clock3 aria-hidden="true" /> Checking your saved places…
        </output>
      ) : null}
      {recommend.error ? (
        <p className="nearby-error" role="alert">
          {recommend.error}
        </p>
      ) : null}
      {result?.status === 'clarify' ? (
        <div className="nearby-state" aria-live="polite">
          <strong>{result.question}</strong>
          {result.options?.length ? (
            <fieldset className="recommend-choices">
              <legend className="sr-only">Starting point choices</legend>
              {result.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="button outline"
                  disabled={busy || !recommend.active}
                  onClick={() => recommend.choose(option)}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          ) : null}
          <form
            className="nearby-search"
            onSubmit={(event) => {
              event.preventDefault();
              recommend.submitReply();
            }}
          >
            <label htmlFor="recommend-reply">Your answer</label>
            <div className="nearby-search-row">
              <input
                id="recommend-reply"
                value={recommend.reply}
                onChange={(event) => recommend.setReply(event.target.value)}
                maxLength={300}
                disabled={busy}
                placeholder="Station, address or branch"
              />
              <button type="submit" className="button" disabled={busy || !recommend.reply.trim()}>
                Continue
              </button>
            </div>
          </form>
          <button type="button" className="button ghost" onClick={recommend.restart}>
            Start over
          </button>
        </div>
      ) : null}
      {result?.status === 'unavailable' ? (
        <div className="nearby-state" role="alert">
          <strong>{result.message}</strong>
          {result.retryable ? (
            <button
              type="button"
              className="button"
              onClick={recommend.retry}
              disabled={busy || !recommend.active}
            >
              Retry
            </button>
          ) : null}
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
          <ol className="nearby-results" aria-label="Saved restaurant recommendations">
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
                {candidate.entryEvidence ? (
                  <p className="nearby-evidence">
                    Saved walk-in rule ·{' '}
                    <a href={candidate.entryEvidence.url} target="_blank" rel="noreferrer">
                      {candidate.entryEvidence.label}
                    </a>{' '}
                    · checked {new Date(candidate.entryEvidence.checkedAt).toLocaleDateString()}
                  </p>
                ) : null}
                {candidate.route ? (
                  <p className="nearby-evidence">
                    {candidate.route.mode === 'walk' ? 'Walk' : 'Direct train'} ·{' '}
                    {Math.ceil(candidate.route.seconds / 60)} min ·{' '}
                    <a href={candidate.route.source.url} target="_blank" rel="noreferrer">
                      {candidate.route.source.label}
                    </a>{' '}
                    · checked {new Date(candidate.route.checkedAt).toLocaleString()}
                  </p>
                ) : null}
                {candidate.warnings.length ? (
                  <ul className="nearby-warnings">
                    {candidate.warnings.map((warning) => (
                      <li key={warning}>{warningLabel(warning)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          {result.recommendations.some(
            (candidate) => candidate.route?.source.label === 'Google Maps',
          ) ? (
            <p className="nearby-evidence">Powered by Google, ©{new Date().getFullYear()} Google</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function warningLabel(code: string): string {
  switch (code) {
    case 'unverified_travel_time':
      return 'Travel time is not verified; distance is straight-line only.';
    case 'walk_in_unknown':
      return 'Walk-in and queue status are unknown.';
    case 'current_availability_unknown':
      return 'Current availability and queue status are not verified.';
    default:
      return code.replaceAll('_', ' ');
  }
}

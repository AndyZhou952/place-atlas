import { Sparkles } from 'lucide-react';
import type { Restaurant } from '../../shared/types.ts';
import { useRecommend } from '../viewmodels/useRecommend.ts';

export function RecommendPanel({
  restaurants,
  onOpen,
}: {
  readonly restaurants: readonly Restaurant[];
  readonly onOpen: (id: string) => void;
}) {
  const recommend = useRecommend();
  const byId = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const origin = recommend.result?.origin;
  return (
    <section className="tool" aria-label="Recommend a restaurant">
      <h2>Recommend from your saved restaurants</h2>
      <form className="stack" onSubmit={(event) => (event.preventDefault(), void recommend.ask())}>
        <label>
          What would you like to eat, and where?
          <input
            value={recommend.query}
            maxLength={1000}
            placeholder="e.g. 新宿で焼き鳥, sushi near Ginza station I haven't tried"
            disabled={recommend.busy}
            onChange={(event) => recommend.setQuery(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button"
          disabled={recommend.busy || !recommend.query.trim()}
        >
          <Sparkles aria-hidden="true" /> {recommend.busy ? 'Thinking…' : 'Recommend'}
        </button>
        <small className="muted">
          Picks come only from your saved list. Distances are straight-line, not walking time.
        </small>
      </form>
      {recommend.error ? (
        <p className="error" role="alert">
          {recommend.error}
        </p>
      ) : null}
      {recommend.result?.message ? <p className="muted">{recommend.result.message}</p> : null}
      {origin ? <p className="muted">From {origin.label}</p> : null}
      <ol className="picks">
        {recommend.result?.picks.map((pick) => {
          const restaurant = byId.get(pick.id);
          if (!restaurant) return null;
          const directions =
            origin &&
            `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${origin.latitude},${origin.longitude}&destination=${restaurant.latitude},${restaurant.longitude}`;
          return (
            <li key={pick.id}>
              <button type="button" className="link" onClick={() => onOpen(pick.id)}>
                <strong>{restaurant.title}</strong>
              </button>
              <small>
                {restaurant.address}
                {pick.distanceKm === undefined ? '' : ` · ${pick.distanceKm} km`}
              </small>
              <p>{pick.reason}</p>
              {directions ? (
                <a href={directions} target="_blank" rel="noreferrer">
                  Walking directions
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

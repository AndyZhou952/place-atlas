import { X } from 'lucide-react';
import type { JournalSort } from '../viewmodels/selectors.ts';
import type { AtlasViewModel } from '../viewmodels/useAtlas.ts';
import { useJournalView } from '../viewmodels/useViews.ts';
import { VisitForm, VisitList } from './Visits.tsx';

const SORTS: [JournalSort, string][] = [
  ['visited-desc', 'Visit date · newest first'],
  ['visited-asc', 'Visit date · oldest first'],
  ['recorded-desc', 'Added · newest first'],
  ['recorded-asc', 'Added · oldest first'],
  ['score-desc', 'My score · highest first'],
  ['score-asc', 'My score · lowest first'],
];

export function JournalView({
  atlas,
  owner,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
}) {
  const journal = useJournalView(atlas.visits, atlas.restaurants);
  return (
    <section className="page">
      <header className="page-intro">
        <p className="eyebrow">Personal journal</p>
        <h2>Your journal</h2>
        <p>
          {owner
            ? 'Record a visit with a date, an optional note, rating, photos and videos.'
            : 'Visit notes, photos and videos.'}
        </p>
      </header>
      <div className={owner ? 'journal-grid' : undefined}>
        {owner ? (
          <section className="card">
            <h3>Add a visit</h3>
            <VisitForm atlas={atlas} />
          </section>
        ) : null}
        <div>
          <div className="filters">
            <label>
              Sort by
              <select
                value={journal.filter.sort}
                onChange={(event) => journal.update({ sort: event.target.value as JournalSort })}
              >
                {SORTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Restaurant
              <select
                value={journal.filter.restaurantId}
                onChange={(event) => journal.update({ restaurantId: event.target.value })}
              >
                <option value="all">All restaurants</option>
                {journal.visitedRestaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={journal.filter.from}
                onChange={(event) => journal.update({ from: event.target.value })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={journal.filter.to}
                onChange={(event) => journal.update({ to: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label="Clear filters"
              onClick={journal.clear}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          {journal.entries.map(({ visit, restaurant, number, total }) => (
            <article key={visit.id} className="card journal-entry">
              <header>
                <div>
                  <strong>{restaurant.title}</strong>
                  <small>
                    Visit {number} of {total}
                  </small>
                </div>
                <span className="score">{restaurant.rating ?? '—'}</span>
              </header>
              <VisitList
                atlas={atlas}
                owner={owner}
                visits={[visit]}
                numbers={new Map([[visit.id, number]])}
              />
            </article>
          ))}
          {!journal.entries.length ? (
            <p className="empty">
              {atlas.visits.length ? 'No visits match these filters.' : 'No visits recorded yet.'}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

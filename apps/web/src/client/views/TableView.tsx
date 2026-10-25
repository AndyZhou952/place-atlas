import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  CUISINE_OPTIONS,
  PREFECTURE_OPTIONS,
  cuisineLabel,
  prefectureLabel,
} from '../../shared/cuisine.ts';
import { type TableSort, restaurantLinks } from '../viewmodels/selectors.ts';
import type { AtlasViewModel } from '../viewmodels/useAtlas.ts';
import { useTableView } from '../viewmodels/useViews.ts';
import { OpeningHours } from './common.tsx';

const SORT_LABELS: Record<TableSort, string> = {
  name: 'Name',
  rating: 'My rating / 10',
  tabelog: 'Tabelog',
  google: 'Google',
  lastVisit: 'Last visit',
};

export function TableView({
  atlas,
  owner,
  onOpen,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly onOpen: (id: string) => void;
}) {
  const table = useTableView(atlas.restaurants, atlas.visits, atlas.googleRatings);
  const prefectures = PREFECTURE_OPTIONS.filter((option) =>
    atlas.restaurants.some((r) => r.prefecture === option.code),
  );
  const loadGoogle = async () => {
    const ids = table.rows
      .filter((row) => row.restaurant.googlePlaceId)
      .map((row) => row.restaurant.id);
    for (let start = 0; start < ids.length; start += 3) {
      await Promise.all(
        ids
          .slice(start, start + 3)
          .map((id) => atlas.refreshGoogleRating(id).catch(() => undefined)),
      );
    }
  };
  const heading = (sort: TableSort) => (
    <th
      scope="col"
      aria-sort={
        table.filter.sort === sort ? (table.filter.ascending ? 'ascending' : 'descending') : 'none'
      }
    >
      <button type="button" onClick={() => table.sortBy(sort)}>
        {SORT_LABELS[sort]}
        {table.filter.sort === sort ? (
          table.filter.ascending ? (
            <ArrowUp aria-hidden="true" />
          ) : (
            <ArrowDown aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );

  return (
    <section className="page">
      <header className="page-intro">
        <p className="eyebrow">Saved restaurants</p>
        <h2>Table</h2>
      </header>
      <div className="filters card">
        <label>
          Name or address
          <input
            type="search"
            value={table.filter.query}
            onChange={(event) => table.update({ query: event.target.value })}
          />
        </label>
        <label>
          Cuisine
          <select
            value={table.filter.cuisine}
            onChange={(event) => table.update({ cuisine: event.target.value })}
          >
            <option value="all">All cuisines</option>
            {CUISINE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value="unknown">Unclassified</option>
          </select>
        </label>
        <label>
          Prefecture
          <select
            value={table.filter.prefecture}
            onChange={(event) => table.update({ prefecture: event.target.value })}
          >
            <option value="all">All prefectures</option>
            {prefectures.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <button type="button" className="button ghost" onClick={table.clear}>
          Clear filters
        </button>
        {owner && atlas.restaurants.some((r) => r.googlePlaceId) ? (
          <button type="button" className="button outline" onClick={() => void loadGoogle()}>
            Refresh Google ratings
          </button>
        ) : null}
      </div>
      <p className="muted">
        {table.rows.length} / {atlas.restaurants.length} restaurants · unknown values sort last
      </p>
      {/* Focusable so keyboard users can scroll the wide table. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section className="table-scroll" tabIndex={0} aria-label="Restaurant table">
        <table>
          <thead>
            <tr>
              {heading('name')}
              <th scope="col">Cuisine</th>
              <th scope="col">Prefecture</th>
              <th scope="col">Area</th>
              {heading('rating')}
              {heading('tabelog')}
              {owner ? heading('google') : null}
              {heading('lastVisit')}
              <th scope="col">Visits</th>
              <th scope="col">Reservation</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map(({ restaurant, visits, lastVisit }) => {
              const google = atlas.googleRatings[restaurant.id];
              return (
                <tr key={restaurant.id}>
                  <th scope="row">
                    <button type="button" className="link" onClick={() => onOpen(restaurant.id)}>
                      {restaurant.title}
                    </button>
                    {restaurant.alternateTitle ? <small>{restaurant.alternateTitle}</small> : null}
                  </th>
                  <td>{restaurant.cuisines.map(cuisineLabel).join(' · ') || 'Unclassified'}</td>
                  <td>{prefectureLabel(restaurant.prefecture) ?? 'Unknown'}</td>
                  <td>{restaurant.area || 'Unknown'}</td>
                  <td>{restaurant.rating ?? 'Not rated'}</td>
                  <td>
                    {restaurant.tabelog?.score ? (
                      <a href={restaurant.tabelog.url} target="_blank" rel="noreferrer">
                        {restaurant.tabelog.score.toFixed(2)}
                      </a>
                    ) : (
                      'Unknown'
                    )}
                  </td>
                  {owner ? (
                    <td>
                      {google ? (
                        <a
                          href={google.url}
                          target="_blank"
                          rel="noreferrer"
                          title={`Observed ${google.observedAt.slice(0, 10)}`}
                        >
                          {google.score.toFixed(1)}
                        </a>
                      ) : restaurant.googlePlaceId ? (
                        'Not loaded'
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                  <td>{lastVisit ?? 'Not visited'}</td>
                  <td>{visits.length}</td>
                  <td>{restaurant.reservation.label || 'Unknown'}</td>
                  <td>
                    <details>
                      <summary aria-label={`Details for ${restaurant.title}`}>View</summary>
                      <dl className="details">
                        <dt>Address</dt>
                        <dd>{restaurant.address}</dd>
                        <dt>Description</dt>
                        <dd>{restaurant.description || '—'}</dd>
                        <dt>Tags</dt>
                        <dd>{restaurant.tags.join(' · ') || '—'}</dd>
                        <dt>Comment</dt>
                        <dd className="pre">{restaurant.comment ?? '—'}</dd>
                        <dt>営業時間</dt>
                        <dd>
                          <OpeningHours value={restaurant.openingHours?.value} />
                        </dd>
                        <dt>定休日</dt>
                        <dd>{restaurant.regularClosingDays?.value ?? 'Unavailable'}</dd>
                        {restaurant.reservation.note ? (
                          <>
                            <dt>Booking note</dt>
                            <dd>{restaurant.reservation.note}</dd>
                          </>
                        ) : null}
                        <dt>Links</dt>
                        <dd>
                          {restaurantLinks(restaurant).map((link) => (
                            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                              {link.label}{' '}
                            </a>
                          ))}
                        </dd>
                        <dt>Added</dt>
                        <dd>{restaurant.addedAt.slice(0, 10)}</dd>
                      </dl>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {!table.rows.length ? <p className="empty">No restaurants match these filters.</p> : null}
    </section>
  );
}

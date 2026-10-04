'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CUISINE_TAXONOMY,
  subdivisionDisplayName,
} from '@/product/application/catalog/restaurant-classification';
import type { AtlasItem, VisitRecord, VisitMediaRecord } from './model';
import {
  catalogTableRows,
  emptyTableFilters,
  type TableSort,
} from './catalog-table-policy';
import { ratingPlaceId } from '../../agent/google-rating-policy';
import { googleRatingIdentity } from './google-rating-display';
import { restaurantLinks } from './restaurant-links';
import type { useGoogleRatingDisplay } from './use-google-rating-display';
import './catalog-table.css';

const unknown = 'Unknown';
const sortLabels: Record<TableSort, string> = {
  lastVisit: 'Last visit',
  personalRating: 'My rating',
  tabelog: 'Tabelog rating',
  google: 'Google rating',
  name: 'Name',
};
const kindLabels = {
  food: 'Restaurant',
  event: 'Event',
  architecture: 'Architecture',
};
const countries = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code?: string) =>
  code ? (countries.of(code) ?? code) : unknown;

export function CatalogTable({
  items,
  visits,
  media,
  onSelect,
  googleRatings,
}: {
  readonly items: readonly AtlasItem[];
  readonly visits: readonly VisitRecord[];
  readonly media: readonly VisitMediaRecord[];
  readonly onSelect: (id: string) => void;
  readonly googleRatings: ReturnType<typeof useGoogleRatingDisplay>;
}) {
  const [filters, setFilters] = useState(emptyTableFilters);
  const [sort, setSort] = useState<TableSort>('lastVisit');
  const [ascending, setAscending] = useState(false);
  const rows = useMemo(
    () => catalogTableRows(items, visits, filters, sort, ascending),
    [items, visits, filters, sort, ascending],
  );
  const countryCodes = [
    ...new Set(
      items
        .map((item) => item.classification?.geography.countryCode)
        .filter((code): code is string => Boolean(code)),
    ),
  ].sort();
  const subdivisions = new Map(
    items
      .filter(
        (item) =>
          filters.country === 'all' ||
          item.classification?.geography.countryCode === filters.country,
      )
      .flatMap((item) => {
        const geo = item.classification?.geography;
        return geo?.subdivisionCode
          ? [
              [
                geo.subdivisionCode,
                subdivisionDisplayName(
                  geo.subdivisionCode,
                  geo.subdivisionName,
                ),
              ] as const,
            ]
          : [];
      }),
  );

  function changeSort(next: TableSort) {
    if (next === sort) setAscending(!ascending);
    else {
      setSort(next);
      setAscending(next === 'name');
    }
  }
  function sortHeading(key: TableSort) {
    return (
      <th
        scope="col"
        aria-sort={
          sort === key ? (ascending ? 'ascending' : 'descending') : 'none'
        }
      >
        <button type="button" onClick={() => changeSort(key)}>
          {sortLabels[key]}
          {sort === key ? (
            ascending ? (
              <ArrowUp aria-hidden="true" />
            ) : (
              <ArrowDown aria-hidden="true" />
            )
          ) : null}
        </button>
      </th>
    );
  }
  return (
    <section
      className="catalog-table-workspace"
      aria-labelledby="catalog-table-title"
    >
      <header>
        <p className="eyebrow">Saved database</p>
        <h2 id="catalog-table-title">Table</h2>
        <p>
          Browse place details, ratings and visits. Cuisine and administrative
          regions appear only in Table.
        </p>
      </header>
      <div className="catalog-table-filters" aria-label="Table filters">
        <label htmlFor="catalog-table-query">
          Name or address
          <Input
            id="catalog-table-query"
            type="search"
            value={filters.query}
            onChange={(event) =>
              setFilters({ ...filters, query: event.target.value })
            }
            placeholder="Type part of a name or address"
          />
        </label>
        <label>
          Record type
          <select
            value={filters.kind}
            onChange={(event) =>
              setFilters({ ...filters, kind: event.target.value })
            }
          >
            <option value="all">All types</option>
            {Object.entries(kindLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cuisine
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters({ ...filters, category: event.target.value })
            }
          >
            <option value="all">All cuisines</option>
            {CUISINE_TAXONOMY.flatMap((entry) => entry.categories).map(
              (entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ),
            )}
            <option value="unknown">Unclassified</option>
          </select>
        </label>
        <label>
          Country / region
          <select
            value={filters.country}
            onChange={(event) =>
              setFilters({
                ...filters,
                country: event.target.value,
                subdivision: 'all',
              })
            }
          >
            <option value="all">All countries / regions</option>
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {countryName(code)}
              </option>
            ))}
            <option value="unknown">Unknown country / region</option>
          </select>
        </label>
        <label>
          Province / prefecture / state
          <select
            value={filters.subdivision}
            onChange={(event) =>
              setFilters({ ...filters, subdivision: event.target.value })
            }
          >
            <option value="all">All subdivisions</option>
            {[...subdivisions]
              .sort((a, b) => a[1].localeCompare(b[1], 'en'))
              .map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            <option value="unknown">Unknown subdivision</option>
          </select>
        </label>
        <label>
          Sort by
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as TableSort;
              setSort(next);
              setAscending(next === 'name');
            }}
          >
            {Object.entries(sortLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => setAscending(!ascending)}
          aria-label="Change sort direction"
        >
          {ascending ? <ArrowUp /> : <ArrowDown />}
          {ascending ? 'Ascending' : 'Descending'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFilters(emptyTableFilters);
            setSort('lastVisit');
            setAscending(false);
          }}
        >
          Clear filters
        </Button>
      </div>
      {items.some(
        (item) => item.verificationStatus === 'verified' && ratingPlaceId(item),
      ) &&
        googleRatings.canQuery && (
          <div>
            <Button
              type="button"
              disabled={googleRatings.busy}
              onClick={() =>
                void googleRatings.loadMany(rows.map((row) => row.item.id))
              }
            >
              {googleRatings.busy
                ? 'Loading Google Maps ratings…'
                : 'Load Google ratings'}
            </Button>
            <p>
              Owner queries use the Google API. Ratings are shared with Map for
              this session. Save a reference explicitly to keep its score and
              observation date; later queries leave it unchanged.
            </p>
          </div>
        )}
      {googleRatings.error ? <p role="alert">{googleRatings.error}</p> : null}
      <output className="catalog-table-count" aria-live="polite">
        {rows.length} / {items.length} records · Unknown ratings and unvisited
        places appear last
      </output>
      <section
        className="catalog-table-scroll"
        aria-label="Place details table, scroll horizontally"
        // Scrollable tables need keyboard focus to reveal off-screen columns.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">Saved places and their visits</caption>
          <thead>
            <tr>
              {sortHeading('name')}
              <th scope="col">Type / status</th>
              <th scope="col">Cuisine</th>
              <th scope="col">Country / region</th>
              <th scope="col">Province / prefecture / state</th>
              <th scope="col">Area</th>
              {sortHeading('personalRating')}
              {sortHeading('tabelog')}
              {sortHeading('google')}
              {googleRatings.canQuery ? (
                <th scope="col">Google reference</th>
              ) : null}
              {sortHeading('lastVisit')}
              <th scope="col">Visits</th>
              <th scope="col">Reservation</th>
              <th scope="col">Description</th>
              <th scope="col">Full details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, visits: itemVisits, lastVisit }) => {
              const reference = googleRatings.references[item.id];
              const savedReference =
                reference && reference.placeId === ratingPlaceId(item)
                  ? reference
                  : undefined;
              const display = googleRatings.displays[item.id];
              const canSaveReference =
                display?.status === 'loaded' &&
                Boolean(display.rating) &&
                display.identity === googleRatingIdentity(item);
              const cuisine = item.classification?.cuisines ?? [];
              const geo = item.classification?.geography;
              const categoryLabels = cuisine
                .map(
                  (entry) =>
                    CUISINE_TAXONOMY.find(
                      (family) => family.id === entry.familyId,
                    )?.categories.find(
                      (category) => category.id === entry.categoryId,
                    )?.label,
                )
                .filter(Boolean);
              return (
                <tr key={item.id}>
                  <th scope="row">
                    {item.verificationStatus === 'verified' ? (
                      <button
                        type="button"
                        className="catalog-table-name"
                        onClick={() => onSelect(item.id)}
                      >
                        {item.title}
                      </button>
                    ) : (
                      <span className="catalog-table-name">{item.title}</span>
                    )}
                    {item.alternateTitle ? (
                      <small>{item.alternateTitle}</small>
                    ) : null}
                  </th>
                  <td>
                    {kindLabels[item.kind]}
                    <small>
                      {item.verificationStatus === 'verified'
                        ? 'Verified'
                        : 'Needs verification'}
                    </small>
                  </td>
                  <td>
                    {categoryLabels.join(' · ') ||
                      (item.kind === 'food' ? 'Unclassified' : '—')}
                  </td>
                  <td>{countryName(geo?.countryCode)}</td>
                  <td>
                    {geo?.subdivisionCode
                      ? subdivisionDisplayName(
                          geo.subdivisionCode,
                          geo.subdivisionName,
                        )
                      : unknown}
                  </td>
                  <td>{item.area || unknown}</td>
                  <td>{item.personalRating ?? 'Not rated'}</td>
                  <td>
                    {item.tabelog ? (
                      <a
                        href={item.tabelog.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.tabelog.score.toFixed(2)}
                      </a>
                    ) : (
                      unknown
                    )}
                  </td>
                  <td>
                    {item.googleRating ? (
                      <a
                        href={item.googleRating.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Google Maps ${item.googleRating.score.toFixed(1)}`}
                      >
                        {item.googleRating.score.toFixed(1)}{' '}
                        <small translate="no">Google Maps</small>
                      </a>
                    ) : !ratingPlaceId(item) ? (
                      'Not applicable / no source'
                    ) : googleRatings.displays[item.id]?.identity ===
                      googleRatingIdentity(item) ? (
                      googleRatings.displays[item.id]?.status === 'loading' ? (
                        'Loading'
                      ) : (
                        'Unavailable'
                      )
                    ) : (
                      'Not loaded'
                    )}
                  </td>
                  {googleRatings.canQuery ? (
                    <td>
                      {savedReference ? (
                        <>
                          <a
                            href={savedReference.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {savedReference.score.toFixed(1)}{' '}
                            <small translate="no">Google Maps</small>
                          </a>
                          <small>
                            Observed{' '}
                            {new Date(
                              savedReference.observedAt,
                            ).toLocaleDateString('en-CA')}
                          </small>
                          <small>
                            {savedReference.reviewCount ?? 'Unknown'} reviews ·
                            Google Places API
                          </small>
                          <small>
                            Saved{' '}
                            {new Date(
                              savedReference.capturedAt,
                            ).toLocaleDateString('en-CA')}
                          </small>
                        </>
                      ) : (
                        <small>No saved reference</small>
                      )}
                      {canSaveReference ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={googleRatings.saving[item.id]}
                          aria-label={`${item.title}: ${savedReference ? 'Replace' : 'Save'} Google reference`}
                          onClick={() =>
                            void googleRatings.saveReference(item, display)
                          }
                        >
                          {googleRatings.saving[item.id]
                            ? 'Saving…'
                            : savedReference
                              ? 'Replace reference'
                              : 'Save reference'}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                  <td>{lastVisit ?? 'Not visited'}</td>
                  <td>{itemVisits.length}</td>
                  <td>{item.reservation.label || unknown}</td>
                  <td className="catalog-table-description">
                    {item.description || 'No description'}
                  </td>
                  <td>
                    <details>
                      <summary aria-label={`${item.title}: View details`}>
                        View details
                      </summary>
                      <dl className="catalog-table-details">
                        <dt>Address</dt>
                        <dd>{item.address || unknown}</dd>
                        <dt>Original tags</dt>
                        <dd>{item.tags.join(' · ') || '—'}</dd>
                        <dt>Personal assessment</dt>
                        <dd>{item.overallComment || 'None'}</dd>
                        <dt>Favorite / visited</dt>
                        <dd>
                          {item.isFavorite ? 'Favorite' : 'Not favorited'} ·{' '}
                          {item.hasVisited ? 'Visited' : 'Not visited'}
                        </dd>
                        <dt>Reservation details</dt>
                        <dd>
                          {[
                            item.reservation.channel,
                            item.reservation.bookingWindowLabel,
                            item.reservation.advanceDays === undefined
                              ? undefined
                              : `${item.reservation.advanceDays} days in advance`,
                            item.reservation.releaseNote,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                          {item.kind !== 'food' && item.reservation.url ? (
                            <>
                              {' '}
                              ·{' '}
                              <a
                                href={item.reservation.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Reservation source
                              </a>
                            </>
                          ) : null}
                        </dd>
                        <dt>Location</dt>
                        <dd>
                          {item.verificationStatus === 'verified'
                            ? `${item.latitude}, ${item.longitude}`
                            : 'Needs verification'}
                        </dd>
                        <dt>Rating details</dt>
                        <dd>
                          {item.tabelog
                            ? `Tabelog ${item.tabelog.score} · ${item.tabelog.reviewCount ?? 'Unknown'} reviews · ${item.tabelog.checkedAt}`
                            : 'Tabelog Unknown'}
                          {item.googleRating ? (
                            <>
                              <br />
                              Google {item.googleRating.score} ·{' '}
                              {item.googleRating.reviewCount ?? 'Unknown'}{' '}
                              reviews · {item.googleRating.checkedAt}
                            </>
                          ) : null}
                        </dd>
                        <dt>Verified / updated</dt>
                        <dd>
                          {item.verifiedAt || 'Not verified'} ·{' '}
                          {item.updatedAt ?? 'Update time unknown'}
                        </dd>
                        {item.event ? (
                          <>
                            <dt>Event dates</dt>
                            <dd>
                              {item.event.displayDate} · {item.event.startDate}{' '}
                              — {item.event.endDate}
                            </dd>
                          </>
                        ) : null}
                        <dt>Sources</dt>
                        <dd>
                          {restaurantLinks(item).map((source, index) => (
                            <span key={`${source.url}-${index}`}>
                              {index > 0 ? ' · ' : ''}
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.label}
                              </a>
                            </span>
                          ))}
                        </dd>
                        <dt>Visits</dt>
                        <dd>
                          {itemVisits.length
                            ? itemVisits.map((visit) => (
                                <section key={visit.id}>
                                  <strong>{visit.visitedAt}</strong>
                                  {visit.createdAt.includes('T') ? (
                                    <small>Recorded {visit.createdAt}</small>
                                  ) : null}
                                  <p>{visit.note || 'No note'}</p>
                                  <div className="catalog-table-media">
                                    {media
                                      .filter(
                                        (entry) => entry.visitId === visit.id,
                                      )
                                      .map((entry) => (
                                        <figure key={entry.id}>
                                          {entry.contentType.startsWith(
                                            'video/',
                                          ) ? (
                                            // Personal uploads do not include a subtitle track.
                                            // oxlint-disable-next-line jsx-a11y/media-has-caption
                                            <video
                                              controls
                                              preload="metadata"
                                              src={entry.contentUrl}
                                              aria-label={
                                                entry.caption || 'Visit video'
                                              }
                                            />
                                          ) : (
                                            <a
                                              href={entry.contentUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              <Image
                                                src={entry.contentUrl}
                                                alt={
                                                  entry.caption || 'Visit photo'
                                                }
                                                width={128}
                                                height={96}
                                                unoptimized
                                              />
                                            </a>
                                          )}
                                          {entry.caption ? (
                                            <figcaption>
                                              {entry.caption}
                                            </figcaption>
                                          ) : null}
                                        </figure>
                                      ))}
                                  </div>
                                </section>
                              ))
                            : 'Not visited'}
                        </dd>
                      </dl>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {!rows.length ? (
        <p className="empty-state">
          No records match these filters. Clear the filters to try again.
        </p>
      ) : null}
    </section>
  );
}

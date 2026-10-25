import { ChevronRight, Circle, Heart, ListFilter, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Restaurant } from '../../shared/types.ts';
import type { AtlasViewModel } from '../viewmodels/useAtlas.ts';
import { useMapView } from '../viewmodels/useViews.ts';
import { ConfirmDialog } from './common.tsx';
import { LeafletMap } from './LeafletMap.tsx';
import { PlaceDetail } from './PlaceDetail.tsx';

export function MapView({
  atlas,
  owner,
  selectedId,
  onSelect,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly selectedId?: string;
  readonly onSelect: (id: string) => void;
}) {
  const view = useMapView(atlas.restaurants, selectedId);
  const [listOpen, setListOpen] = useState(true);
  const [deleting, setDeleting] = useState<Restaurant>();

  return (
    <section className={`map-layout${listOpen ? ' list-open' : ''}`} aria-label="Map">
      <LeafletMap items={view.items} selectedId={view.selected?.id} onSelect={onSelect} />
      <button
        type="button"
        className="button outline map-toggle"
        aria-expanded={listOpen}
        onClick={() => setListOpen(!listOpen)}
      >
        <ListFilter aria-hidden="true" /> {listOpen ? 'Hide list' : 'Show list'}
      </button>

      <aside className="place-panel" hidden={!listOpen} aria-label="Restaurants">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Japan</p>
            <h2>Restaurants</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close list"
            onClick={() => setListOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="summary">
          <span>
            <strong>{view.summary.saved}</strong> saved
          </span>
          <span>
            <strong>{view.summary.visited}</strong> visited
          </span>
          <span>
            <strong>{view.summary.favorites}</strong> favorites
          </span>
        </div>
        <fieldset className="chips">
          <legend className="sr-only">Filter by visit status</legend>
          {(
            [
              ['all', 'All'],
              ['unvisited', 'Not yet'],
              ['visited', '行った'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view.visit === value}
              onClick={() => view.setVisit(value)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={view.favoritesOnly}
            aria-label="お気に入り"
            title="お気に入り"
            onClick={() => view.setFavoritesOnly(!view.favoritesOnly)}
          >
            <Heart aria-hidden="true" fill={view.favoritesOnly ? 'currentColor' : 'none'} />
          </button>
        </fieldset>
        <div className="list-heading">
          <h3>{view.items.length} restaurants</h3>
          <label>
            Sort{' '}
            <select
              value={view.sort}
              onChange={(event) => view.setSort(event.target.value as 'added' | 'score')}
            >
              <option value="added">Added</option>
              <option value="score">Score</option>
            </select>
          </label>
        </div>
        <label className="search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search restaurant name"
            aria-label="Search restaurant name"
            value={view.query}
            onChange={(event) => view.setQuery(event.target.value)}
          />
        </label>
        <ul className="place-list">
          {view.items.map((restaurant) => (
            <PlaceRow
              key={restaurant.id}
              restaurant={restaurant}
              selected={restaurant.id === view.selected?.id}
              owner={owner}
              busy={atlas.isPending(restaurant.id)}
              onSelect={() => onSelect(restaurant.id)}
              onToggle={(patch) =>
                void atlas.updateRestaurant(restaurant.id, patch).catch(() => undefined)
              }
              onDelete={() => setDeleting(restaurant)}
            />
          ))}
          {!view.items.length ? (
            <li className="empty">No restaurant matches these filters.</li>
          ) : null}
        </ul>
      </aside>

      {view.selected ? (
        <PlaceDetail
          key={view.selected.id}
          restaurant={view.selected}
          atlas={atlas}
          owner={owner}
        />
      ) : (
        <div className="detail-card empty">No restaurant selected.</div>
      )}

      {deleting ? (
        <ConfirmDialog
          title="この場所を削除しますか？"
          body={`「${deleting.title}」と紐づく評価、訪問記録、写真が削除されます。`}
          action="削除"
          busy={atlas.isPending(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() =>
            void atlas.deleteRestaurant(deleting.id).then(
              () => setDeleting(undefined),
              () => undefined,
            )
          }
        />
      ) : null}
    </section>
  );
}

function PlaceRow({
  restaurant,
  selected,
  owner,
  busy,
  onSelect,
  onToggle,
  onDelete,
}: {
  readonly restaurant: Restaurant;
  readonly selected: boolean;
  readonly owner: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onToggle: (patch: { favorite?: boolean; visited?: boolean }) => void;
  readonly onDelete: () => void;
}) {
  const meta = [...restaurant.tags.slice(0, 3), restaurant.area, restaurant.reservation.label]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className={`place-row${selected ? ' is-selected' : ''}`}>
      <button type="button" className="place-main" aria-pressed={selected} onClick={onSelect}>
        <span className="seal small" aria-hidden="true">
          食
        </span>
        <span className="place-copy">
          <strong>{restaurant.title}</strong>
          {restaurant.alternateTitle ? <small>{restaurant.alternateTitle}</small> : null}
          <small>{meta}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      <span className="place-side">
        <span className="badges">
          {restaurant.rating === undefined ? null : (
            <span className="badge personal">マイ {restaurant.rating}</span>
          )}
          {restaurant.tabelog?.score ? (
            <span className="badge">食べログ {restaurant.tabelog.score.toFixed(2)}</span>
          ) : null}
        </span>
        {owner ? (
          <span className="row-actions">
            <button
              type="button"
              aria-label={`${restaurant.favorite ? 'お気に入りを解除' : 'お気に入りに追加'} ${restaurant.title}`}
              aria-pressed={restaurant.favorite}
              disabled={busy}
              onClick={() => onToggle({ favorite: !restaurant.favorite })}
            >
              <Heart aria-hidden="true" fill={restaurant.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              aria-label={`${restaurant.visited ? '未訪問に戻す' : '訪問済みにする'} ${restaurant.title}`}
              aria-pressed={restaurant.visited}
              disabled={busy}
              onClick={() => onToggle({ visited: !restaurant.visited })}
            >
              <Circle aria-hidden="true" fill={restaurant.visited ? 'currentColor' : 'none'} />{' '}
              行った
            </button>
            <button type="button" aria-label={`Delete ${restaurant.title}`} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </span>
    </li>
  );
}

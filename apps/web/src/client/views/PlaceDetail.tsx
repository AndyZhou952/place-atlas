import {
  Circle,
  ExternalLink,
  Heart,
  MapPin,
  NotebookPen,
  Pencil,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { prefectureLabel } from '../../shared/cuisine.ts';
import type { Restaurant } from '../../shared/types.ts';
import { restaurantLinks, sortVisits } from '../viewmodels/selectors.ts';
import type { AtlasViewModel } from '../viewmodels/useAtlas.ts';
import { OpeningHours, hostname } from './common.tsx';
import { VisitForm, VisitList } from './Visits.tsx';

const POLICY_LABEL = {
  reservable: '予約可',
  required: '要予約',
  not_reservable: '予約不可',
  unknown: 'Unknown',
};

export function PlaceDetail({
  restaurant,
  atlas,
  owner,
}: {
  readonly restaurant: Restaurant;
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const visits = sortVisits(
    atlas.visits.filter((visit) => visit.restaurantId === restaurant.id),
    'visited-desc',
  );
  const busy = atlas.isPending(restaurant.id);
  const google = atlas.googleRatings[restaurant.id];
  const update = (patch: Parameters<AtlasViewModel['updateRestaurant']>[1]) =>
    atlas.updateRestaurant(restaurant.id, patch).catch(() => undefined);

  return (
    <article className="detail-card">
      <header className="detail-header">
        <div>
          <p className="eyebrow">
            {[prefectureLabel(restaurant.prefecture), restaurant.area].filter(Boolean).join(' · ')}
          </p>
          <h2>{restaurant.title}</h2>
          {restaurant.alternateTitle ? <p className="muted">{restaurant.alternateTitle}</p> : null}
        </div>
        {owner ? (
          <div className="detail-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="お気に入り"
              aria-pressed={restaurant.favorite}
              disabled={busy}
              onClick={() => update({ favorite: !restaurant.favorite })}
            >
              <Heart aria-hidden="true" fill={restaurant.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="button outline small"
              aria-pressed={restaurant.visited}
              disabled={busy}
              onClick={() => update({ visited: !restaurant.visited })}
            >
              <Circle aria-hidden="true" fill={restaurant.visited ? 'currentColor' : 'none'} />{' '}
              行った
            </button>
            <button type="button" className="button outline small" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" /> Edit
            </button>
          </div>
        ) : null}
      </header>

      {editing ? (
        <EditForm
          restaurant={restaurant}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(patch) => update(patch).then(() => setEditing(false))}
        />
      ) : (
        <>
          <p>{restaurant.description}</p>
          <p className="address">
            <MapPin aria-hidden="true" /> {restaurant.address}
          </p>
          {restaurant.tags.length ? (
            <p className="tags">
              {restaurant.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </p>
          ) : null}
        </>
      )}

      <div className="rating-strip">
        <RatingEditor
          restaurant={restaurant}
          owner={owner}
          onSave={(rating) => update({ rating })}
        />
        {restaurant.tabelog ? (
          <a className="rating" href={restaurant.tabelog.url} target="_blank" rel="noreferrer">
            <span>食べログ</span>
            <strong>
              <Star aria-hidden="true" /> {restaurant.tabelog.score?.toFixed(2) ?? '—'}
            </strong>
          </a>
        ) : null}
        {owner && restaurant.googlePlaceId ? (
          <span className="rating">
            <span translate="no">Google Maps</span>
            {google ? (
              <a href={google.url} target="_blank" rel="noreferrer">
                <strong>{google.score.toFixed(1)}</strong>{' '}
                <small>{google.observedAt.slice(0, 10)}</small>
              </a>
            ) : (
              <small>Not loaded</small>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh Google rating"
              disabled={atlas.isPending(`google:${restaurant.id}`)}
              onClick={() => void atlas.refreshGoogleRating(restaurant.id).catch(() => undefined)}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </span>
        ) : null}
        <span className="muted">
          {visits.length} visits{visits[0] ? ` · Last ${visits[0].visitedOn}` : ''}
        </span>
      </div>

      <CommentEditor
        restaurant={restaurant}
        owner={owner}
        busy={busy}
        onSave={(comment) => update({ comment })}
      />

      {owner ? (
        <details className="add-visit">
          <summary>
            <NotebookPen aria-hidden="true" /> Add a visit
          </summary>
          <VisitForm atlas={atlas} restaurantId={restaurant.id} />
        </details>
      ) : null}

      <div className="facts">
        <div className="fact">
          <span>Reservation</span>
          <strong>
            {restaurant.reservation.label || POLICY_LABEL[restaurant.reservation.policy]}
          </strong>
          {restaurant.reservation.note ? <small>{restaurant.reservation.note}</small> : null}
        </div>
        <div className="fact">
          <span>営業時間</span>
          <OpeningHours value={restaurant.openingHours?.value} />
          {restaurant.openingHours ? <Source value={restaurant.openingHours} /> : null}
        </div>
        <div className="fact">
          <span>定休日</span>
          <strong>{restaurant.regularClosingDays?.value ?? 'Unavailable'}</strong>
          {restaurant.closingNotes ? <small>{restaurant.closingNotes.value}</small> : null}
          {restaurant.regularClosingDays ? <Source value={restaurant.regularClosingDays} /> : null}
        </div>
      </div>

      <section className="history">
        <h3>訪問記録</h3>
        {visits.length ? (
          <VisitList atlas={atlas} owner={owner} visits={visits} />
        ) : (
          <p className="muted">No visits recorded yet.</p>
        )}
      </section>

      <p className="links">
        {restaurantLinks(restaurant).map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
            {link.label} <ExternalLink aria-hidden="true" />
          </a>
        ))}
      </p>
    </article>
  );
}

function Source({ value }: { readonly value: { sourceUrl: string; observedAt: string } }) {
  return (
    <small>
      <a href={value.sourceUrl} target="_blank" rel="noreferrer">
        {hostname(value.sourceUrl)}
      </a>{' '}
      · {value.observedAt.slice(0, 10)}
    </small>
  );
}

function RatingEditor({
  restaurant,
  owner,
  onSave,
}: {
  readonly restaurant: Restaurant;
  readonly owner: boolean;
  readonly onSave: (rating: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const shown = restaurant.rating?.toString() ?? '未評価';
  if (!owner) {
    return (
      <span className="rating">
        <span>マイスコア</span>
        <strong>{shown}</strong>
      </span>
    );
  }
  if (draft === undefined) {
    return (
      <button
        type="button"
        className="rating"
        aria-label={`マイスコア ${shown}. Edit`}
        onClick={() => setDraft(restaurant.rating?.toString() ?? '')}
      >
        <span>マイスコア</span>
        <strong>{shown}</strong>
      </button>
    );
  }
  const commit = () => {
    const value = draft.trim() === '' ? null : Number(draft);
    setDraft(undefined);
    if (value === null || (value >= 0 && value <= 10)) onSave(value);
  };
  return (
    <form className="rating" onSubmit={(event) => (event.preventDefault(), commit())}>
      <label htmlFor="rating-input">マイスコア</label>
      <input
        id="rating-input"
        type="number"
        min="0"
        max="10"
        step="0.1"
        // Editing starts from the user's click, so focus follows it.
        ref={(node) => node?.focus()}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Escape' && setDraft(undefined)}
      />
    </form>
  );
}

function CommentEditor({
  restaurant,
  owner,
  busy,
  onSave,
}: {
  readonly restaurant: Restaurant;
  readonly owner: boolean;
  readonly busy: boolean;
  readonly onSave: (comment: string | null) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <section className="comment">
      <header>
        <h3>Overall comment</h3>
        {owner && draft === undefined ? (
          <button
            type="button"
            className="button ghost small"
            onClick={() => setDraft(restaurant.comment ?? '')}
          >
            <NotebookPen aria-hidden="true" /> {restaurant.comment ? 'Edit' : 'Add'}
          </button>
        ) : null}
      </header>
      {draft === undefined ? (
        <p className="pre">{restaurant.comment ?? 'No overall comment yet.'}</p>
      ) : (
        <form
          onSubmit={(event) => (
            event.preventDefault(),
            void onSave(draft.trim() || null).then(() => setDraft(undefined))
          )}
        >
          <textarea
            rows={5}
            value={draft}
            aria-label="Overall comment"
            placeholder="What stood out, and would you return?"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="actions">
            <button type="submit" className="button small" disabled={busy}>
              Save comment
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function EditForm({
  restaurant,
  busy,
  onSave,
  onCancel,
}: {
  readonly restaurant: Restaurant;
  readonly busy: boolean;
  readonly onSave: (patch: { title: string; description: string }) => void;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState(restaurant.title);
  const [description, setDescription] = useState(restaurant.description);
  return (
    <form
      className="stack"
      onSubmit={(event) => (event.preventDefault(), onSave({ title, description }))}
    >
      <label>
        Name
        <input
          value={title}
          required
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          rows={4}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="actions">
        <button type="submit" className="button small" disabled={busy || !title.trim()}>
          Save changes
        </button>
        <button type="button" className="button ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

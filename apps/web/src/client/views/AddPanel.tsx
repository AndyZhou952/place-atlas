import { CheckCircle2, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReservationPolicy } from '../../shared/types.ts';
import { type DraftForm, useAdd } from '../viewmodels/useAdd.ts';
import { OpeningHours } from './common.tsx';

const TEXT_FIELDS: [keyof DraftForm, string][] = [
  ['title', 'Name'],
  ['alternateTitle', 'Alternate name'],
  ['area', 'Area'],
  ['address', 'Address'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
  ['categories', 'Cuisine labels (comma separated)'],
  ['dishes', 'Signature dishes (comma separated)'],
  ['tabelogUrl', 'Tabelog listing URL'],
  ['tabelogScore', 'Tabelog score'],
  ['officialUrl', 'Official website'],
  ['bookingUrl', 'Booking URL'],
  ['reservationLabel', 'Reservation (as listed)'],
  ['reservationNote', 'Booking note'],
];

export function AddPanel({
  onSaved,
  onOpen,
}: {
  readonly onSaved: (id: string) => void;
  readonly onOpen: (id: string) => void;
}) {
  const add = useAdd(onSaved);
  const busy = add.stage === 'searching' || add.stage === 'previewing' || add.stage === 'saving';
  const same = add.preview?.duplicates.find((duplicate) => duplicate.match === 'same');
  const missingLocation = add.form && (!add.form.latitude.trim() || !add.form.longitude.trim());

  return (
    <section className="tool" aria-label="Add a restaurant">
      <h2>Add a restaurant</h2>
      <p className="muted">
        Search Tabelog by name, or paste a Tabelog listing URL. Nothing is saved until you confirm.
      </p>
      <form className="stack" onSubmit={(event) => (event.preventDefault(), void add.search())}>
        <div className="pair">
          <label>
            Restaurant name or Tabelog URL
            <input
              value={add.query}
              required
              disabled={busy}
              placeholder="e.g. 鮨 青空"
              onChange={(event) => add.setQuery(event.target.value)}
            />
          </label>
          <label>
            Area or branch (optional)
            <input
              value={add.area}
              disabled={busy}
              placeholder="e.g. 銀座"
              onChange={(event) => add.setArea(event.target.value)}
            />
          </label>
        </div>
        <button type="submit" className="button" disabled={busy || !add.query.trim()}>
          <Search aria-hidden="true" /> {add.stage === 'searching' ? 'Searching…' : 'Find matches'}
        </button>
      </form>

      {add.error ? (
        <p className="error" role="alert">
          {add.error}{' '}
          {add.retry ? (
            <button type="button" className="button outline small" onClick={add.retry}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      {add.stage === 'previewing' ? <Progress /> : null}

      {add.stage === 'candidates' || add.stage === 'previewing' ? (
        add.candidates.length ? (
          <ul className="candidates" aria-label="Matches">
            {add.candidates.map((candidate) => (
              <li key={candidate.ref}>
                <button type="button" disabled={busy} onClick={() => void add.choose(candidate)}>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.address}</small>
                  <small>
                    {[
                      candidate.categories.slice(0, 3).join(' · '),
                      candidate.score ? `食べログ ${candidate.score.toFixed(2)}` : '',
                      candidate.source === 'google' ? 'Google Maps' : 'Tabelog',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No match found. Add the area or a branch name, or paste the Tabelog URL.
          </p>
        )
      ) : null}

      {(add.stage === 'preview' || add.stage === 'saving') && add.form && add.preview ? (
        <form
          className="stack preview"
          onSubmit={(event) => (event.preventDefault(), void add.save())}
        >
          <h3>Review before saving</h3>
          {add.preview.notes.map((note) => (
            <p key={note} className="muted">
              {note}
            </p>
          ))}
          {add.preview.duplicates.map((duplicate) => (
            <p key={duplicate.id} className={duplicate.match === 'same' ? 'error' : 'muted'}>
              {duplicate.match === 'same' ? 'Already saved: ' : 'Possible duplicate nearby: '}
              <button type="button" className="link" onClick={() => onOpen(duplicate.id)}>
                {duplicate.title}
              </button>
            </p>
          ))}
          <div className="form-grid">
            {TEXT_FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={add.form![key]}
                  disabled={busy}
                  onChange={(event) => add.setField(key, event.target.value)}
                />
              </label>
            ))}
            <label>
              Reservation policy
              <select
                value={add.form.policy}
                disabled={busy}
                onChange={(event) =>
                  add.setField('policy', event.target.value as ReservationPolicy)
                }
              >
                <option value="reservable">Reservations accepted</option>
                <option value="required">Reservation required</option>
                <option value="not_reservable">No reservations</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
          </div>
          <label>
            Overview
            <textarea
              rows={3}
              value={add.form.description}
              disabled={busy}
              onChange={(event) => add.setField('description', event.target.value)}
            />
          </label>
          <label>
            営業時間 / Opening hours
            <textarea
              rows={4}
              value={add.form.openingHours}
              disabled={busy}
              onChange={(event) => add.setField('openingHours', event.target.value)}
            />
          </label>
          {add.form.openingHours.trim() ? <OpeningHours value={add.form.openingHours} /> : null}
          <div className="pair">
            <label>
              定休日 / Closing days
              <input
                value={add.form.regularClosingDays}
                disabled={busy}
                onChange={(event) => add.setField('regularClosingDays', event.target.value)}
              />
            </label>
            <label>
              Closure notes
              <input
                value={add.form.closingNotes}
                disabled={busy}
                onChange={(event) => add.setField('closingNotes', event.target.value)}
              />
            </label>
          </div>
          {missingLocation ? (
            <p className="error">Enter latitude and longitude before saving.</p>
          ) : null}
          <div className="actions">
            <button
              type="submit"
              className="button"
              disabled={busy || Boolean(same) || Boolean(missingLocation)}
            >
              {add.stage === 'saving' ? 'Saving…' : same ? 'Already saved' : 'Confirm and save'}
            </button>
            <button type="button" className="button ghost" disabled={busy} onClick={add.reset}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {add.stage === 'saved' && add.savedId ? (
        <output className="success">
          <CheckCircle2 aria-hidden="true" /> Saved.{' '}
          <button type="button" className="link" onClick={() => onOpen(add.savedId!)}>
            Open on the map
          </button>{' '}
          ·{' '}
          <button type="button" className="link" onClick={add.reset}>
            Add another
          </button>
        </output>
      ) : null}
    </section>
  );
}

function Progress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <output className="progress">
      <LoaderCircle aria-hidden="true" className="spin" /> Reading the listing and extracting
      details… {seconds}s
    </output>
  );
}

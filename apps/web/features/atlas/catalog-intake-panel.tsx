'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Plus,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { presentCatalogIntakePreview } from '@/product/application/catalog-intake/catalog-intake-preview-presenter';

import { useCatalogIntake } from './use-catalog-intake';
import {
  catalogIntakeLiveMessage,
  catalogIntakeManualCompletionError,
  catalogIntakePendingMessage,
} from './catalog-intake-ui-state';
import './catalog-intake-panel.css';

export function CatalogIntakePanel({
  onCommitted,
  onOpenSaved,
}: {
  readonly onCommitted?: () => void;
  readonly onOpenSaved: (itemId: string) => void;
}) {
  const intake = useCatalogIntake(onCommitted);
  const { state } = intake;
  const [submitted, setSubmitted] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const busy = state.stage === 'loading';
  const selectInProgress =
    busy &&
    state.lastOperation === 'select' &&
    (state.previousStage === 'candidates' ||
      state.previousStage === 'clarification');
  const confirmInProgress =
    busy &&
    state.lastOperation === 'confirm' &&
    (state.previousStage === 'preview' || state.previousStage === 'conflict');
  const queryInvalid = submitted && !state.query.trim();

  useEffect(() => {
    if (state.focusRevision === 0) return;
    if (state.stage === 'error') {
      retryRef.current?.focus();
      return;
    }
    stageHeadingRef.current?.focus();
  }, [state.focusRevision, state.stage]);

  function submitDiscover(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    void intake.discover();
  }

  return (
    <section
      className="catalog-intake"
      aria-labelledby="catalog-intake-title"
      aria-busy={busy}
    >
      <header className="catalog-intake-header">
        <div>
          <p className="eyebrow">Owner catalog desk</p>
          <h3 id="catalog-intake-title">Add a place</h3>
        </div>
        <span>Preview first</span>
      </header>
      <p className="catalog-intake-intro">
        Start with a restaurant name. Nothing enters your map until a later
        confirmed publish step.
      </p>

      <form className="catalog-intake-search" onSubmit={submitDiscover}>
        <label htmlFor="catalog-intake-query">Restaurant name or address</label>
        <div className="catalog-intake-search-row">
          <Input
            ref={queryRef}
            id="catalog-intake-query"
            value={state.query}
            onChange={(event) => intake.setField('query', event.target.value)}
            placeholder="e.g. 鮨青空, Ginza"
            aria-invalid={queryInvalid}
            aria-describedby={
              queryInvalid
                ? 'catalog-intake-query-help catalog-intake-query-error'
                : 'catalog-intake-query-help'
            }
            disabled={busy}
          />
          <Button type="submit" disabled={busy}>
            <Search data-icon="inline-start" />
            {busy && state.lastOperation === 'discover'
              ? catalogIntakePendingMessage('discover')
              : 'Find matches'}
          </Button>
        </div>
        <small id="catalog-intake-query-help">
          For chains or similar names, add an area below and search again. Keep
          the restaurant name; a full address is not required.
        </small>
        <label htmlFor="catalog-intake-search-area">
          Area, station or branch (optional)
        </label>
        <Input
          id="catalog-intake-search-area"
          value={state.searchArea}
          onChange={(event) =>
            intake.setField('searchArea', event.target.value)
          }
          placeholder="e.g. Shinjuku, Ikebukuro west exit"
          disabled={busy}
          aria-describedby="catalog-intake-query-help"
        />
        {queryInvalid ? (
          <small
            id="catalog-intake-query-error"
            className="catalog-field-error"
          >
            Enter a restaurant name or address.
          </small>
        ) : null}
      </form>

      <div
        className="catalog-intake-live"
        aria-live="polite"
        aria-atomic="true"
      >
        <p>{catalogIntakeLiveMessage(state)}</p>
      </div>

      {busy && state.lastOperation === 'select' ? <ResearchProgress /> : null}

      {state.stage === 'preview' &&
      state.preview?.locationEvidence.status === 'unknown' &&
      !state.preview.suspectedDuplicates.some(
        (item) => item.match === 'strong',
      ) ? (
        <div className="catalog-intake-state is-attention" role="alert">
          <p>
            The research did not produce a verified address and coordinates.
            Complete the place details below, or retry the lookup.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void intake.startFresh()}
          >
            Retry restaurant lookup
          </Button>
        </div>
      ) : null}

      {state.stage !== 'idle' && state.stage !== 'loading' ? (
        <h4
          ref={stageHeadingRef}
          className="catalog-intake-stage-title"
          tabIndex={-1}
        >
          {stageTitle(state.stage)}
        </h4>
      ) : null}

      {state.stage === 'empty' ? (
        <div className="catalog-intake-state">
          <strong>No clear place match yet.</strong>
          <p>Add a neighborhood or a complete address, then try again.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => queryRef.current?.focus()}
          >
            Refine the place
          </Button>
        </div>
      ) : null}

      {state.stage === 'error' ? (
        <div
          className="catalog-intake-state is-error"
          role="alert"
          tabIndex={-1}
        >
          <CircleAlert aria-hidden="true" />
          <strong>{state.error?.message ?? 'The Add request failed.'}</strong>
          <p>
            Your input is still here. Sign in as Owner if prompted, then retry.
          </p>
          <Button
            ref={retryRef}
            type="button"
            variant="outline"
            onClick={() => void intake.retry()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {state.stage === 'candidates' ||
      (selectInProgress && state.previousStage === 'candidates') ? (
        <CandidateStep intake={intake} busy={selectInProgress} />
      ) : null}

      {state.stage === 'clarification' ||
      (selectInProgress && state.previousStage === 'clarification') ? (
        <CandidateStep
          intake={intake}
          showClarification
          busy={selectInProgress}
        />
      ) : null}

      {(state.stage === 'preview' || confirmInProgress) && state.preview ? (
        <PreviewStep
          intake={intake}
          preview={state.preview}
          onConfirm={intake.confirm}
          onCancel={intake.cancel}
          onOpenSaved={onOpenSaved}
          busy={confirmInProgress}
          confirmLabel={
            confirmInProgress ? 'Confirming and saving…' : 'Confirm and save'
          }
        />
      ) : null}

      {state.stage === 'conflict' && state.preview ? (
        <div className="catalog-intake-conflict" role="alert">
          <CircleAlert aria-hidden="true" />
          <strong>Evidence changed during confirmation.</strong>
          <p>
            Review the refreshed facts below. Nothing new was saved; confirm
            again only if this version is correct.
          </p>
          <PreviewStep
            intake={intake}
            preview={state.preview}
            onConfirm={intake.confirm}
            onCancel={intake.cancel}
            onOpenSaved={onOpenSaved}
            confirmLabel="Review changed preview and confirm again"
          />
        </div>
      ) : null}

      {state.stage === 'expired' ? (
        <div className="catalog-intake-state is-attention" role="alert">
          <CircleAlert aria-hidden="true" />
          <strong>{state.error?.message ?? 'The preview expired.'}</strong>
          <p>Create a new preview from the retained Owner input.</p>
          <Button type="button" onClick={() => void intake.startFresh()}>
            Generate a new preview
          </Button>
        </div>
      ) : null}

      {state.stage === 'success' ? (
        <output className="catalog-intake-state is-success" aria-live="polite">
          <CheckCircle2 aria-hidden="true" />
          <strong>{successMessage(state.success?.status)}</strong>
          {state.success?.status === 'committed_needs_review' ? (
            <p>
              It is not visible on the public map or Nearby yet. Retry Add to
              complete the missing information.
            </p>
          ) : null}
          {state.success?.status !== 'already_saved' ? (
            <details className="catalog-intake-note">
              <summary>Save details</summary>
              <span className="catalog-intake-receipt">
                Receipt {state.success?.receiptRef}
              </span>
            </details>
          ) : null}
        </output>
      ) : null}
    </section>
  );
}

type IntakeController = ReturnType<typeof useCatalogIntake>;

function CandidateStep({
  intake,
  showClarification = false,
  busy = false,
}: {
  readonly intake: IntakeController;
  readonly showClarification?: boolean;
  readonly busy?: boolean;
}) {
  const { state } = intake;
  const [correctionsOpen, setCorrectionsOpen] = useState(showClarification);
  const clarificationId = showClarification
    ? 'catalog-intake-clarification'
    : undefined;
  const correctionDescription = clarificationId
    ? `catalog-intake-corrections-help ${clarificationId}`
    : 'catalog-intake-corrections-help';
  return (
    <div className="catalog-intake-step">
      {state.candidates.length ? (
        <fieldset className="catalog-intake-candidates">
          <legend>Choose the intended place</legend>
          {state.candidates.map((candidate) => (
            <div key={candidate.ordinal}>
              <label>
                <input
                  type="radio"
                  name="catalog-intake-candidate"
                  value={candidate.ordinal}
                  aria-label={`Select ${candidate.transientName}`}
                  checked={state.selectedOrdinal === candidate.ordinal}
                  onChange={() => intake.selectCandidate(candidate.ordinal)}
                  disabled={busy}
                />
                <span>
                  <strong>{candidate.transientName}</strong>
                  <small>{candidate.transientAddress}</small>
                </span>
              </label>
              <a
                className="catalog-intake-google-attribution"
                href={candidate.attribution.url}
                target="_blank"
                rel="noreferrer"
                translate="no"
              >
                {candidate.attribution.label}
              </a>
            </div>
          ))}
        </fieldset>
      ) : null}
      {state.hasMore ? (
        <p className="catalog-intake-note">
          Showing the three strongest matches. Refine the query to see others.
        </p>
      ) : null}
      {showClarification && state.clarification ? (
        <p
          id={clarificationId}
          className="catalog-intake-clarification"
          role="alert"
        >
          {state.clarification.prompt}
        </p>
      ) : null}
      <div className="catalog-intake-actions">
        <Button
          type="button"
          onClick={() => void intake.select()}
          disabled={busy || state.selectedOrdinal === undefined}
        >
          <Plus data-icon="inline-start" />
          {busy
            ? catalogIntakePendingMessage('select')
            : 'Review selected place'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void intake.cancel()}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      <details
        className="catalog-intake-corrections"
        open={correctionsOpen}
        onToggle={(event) => setCorrectionsOpen(event.currentTarget.open)}
      >
        <summary
          aria-expanded={correctionsOpen}
          aria-controls="catalog-intake-correction-fields"
          aria-describedby={clarificationId}
        >
          Correct details
          <span>Optional</span>
        </summary>
        <p id="catalog-intake-corrections-help">
          Only add a correction when the selected place needs one.
        </p>
        <div
          id="catalog-intake-correction-fields"
          className="catalog-intake-owner-fields"
        >
          <label htmlFor="catalog-intake-title-field">Confirmed name</label>
          <Input
            id="catalog-intake-title-field"
            value={state.title}
            onChange={(event) => intake.setField('title', event.target.value)}
            placeholder="Optional — the original query remains the proposal"
            aria-describedby={correctionDescription}
            disabled={busy}
            aria-invalid={
              showClarification && state.clarification?.fields.includes('title')
            }
          />
          <label htmlFor="catalog-intake-area-field">Area</label>
          <Input
            id="catalog-intake-area-field"
            value={state.area}
            onChange={(event) => intake.setField('area', event.target.value)}
            placeholder="e.g. Ginza"
            aria-describedby={correctionDescription}
            disabled={busy}
            aria-invalid={
              showClarification && state.clarification?.fields.includes('area')
            }
          />
          <label htmlFor="catalog-intake-address-field">Address</label>
          <Input
            id="catalog-intake-address-field"
            value={state.address}
            onChange={(event) => intake.setField('address', event.target.value)}
            placeholder="Optional full address"
            aria-describedby={correctionDescription}
            disabled={busy}
            aria-invalid={
              showClarification &&
              state.clarification?.fields.includes('address')
            }
          />
        </div>
      </details>
    </div>
  );
}

function PreviewStep({
  intake,
  preview,
  onConfirm,
  onCancel,
  onOpenSaved,
  confirmLabel = 'Confirm and save',
  busy = false,
}: {
  readonly intake: IntakeController;
  readonly preview: NonNullable<IntakeController['state']['preview']>;
  readonly onConfirm: () => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onOpenSaved: (itemId: string) => void;
  readonly confirmLabel?: string;
  readonly busy?: boolean;
}) {
  const presentation = presentCatalogIntakePreview(preview);
  const previewKey = `${preview.sessionId}:${preview.previewVersion}`;
  const hasStrongDuplicate = preview.suspectedDuplicates.some(
    (item) => item.match === 'strong',
  );
  const [fetchedGoogleRating, setFetchedGoogleRating] = useState<{
    readonly previewKey: string;
    readonly score: number;
    readonly reviewCount?: number;
    readonly url: string;
  }>();
  const [googleLookupCompleteKey, setGoogleLookupCompleteKey] = useState('');
  const liveGoogleRating =
    fetchedGoogleRating?.previewKey === previewKey
      ? fetchedGoogleRating
      : undefined;
  useEffect(() => {
    if (hasStrongDuplicate) return;
    const controller = new AbortController();
    void fetch(
      `/api/catalog-intake/google-rating?sessionId=${encodeURIComponent(preview.sessionId)}`,
      {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      },
    )
      .then(async (response) => {
        if (!response.ok || response.status === 204) return;
        const rating: unknown = await response.json();
        if (
          rating &&
          typeof rating === 'object' &&
          'score' in rating &&
          typeof rating.score === 'number' &&
          'url' in rating &&
          typeof rating.url === 'string'
        )
          setFetchedGoogleRating({
            previewKey,
            ...(rating as {
              readonly score: number;
              readonly reviewCount?: number;
              readonly url: string;
            }),
          });
      })
      .catch(() => {
        // A failed lookup leaves the rating unknown and does not prevent saving.
      })
      .finally(() => {
        if (!controller.signal.aborted) setGoogleLookupCompleteKey(previewKey);
      });
    return () => controller.abort();
  }, [preview.sessionId, previewKey, hasStrongDuplicate]);
  const manualError = catalogIntakeManualCompletionError(intake.state);
  const alreadySaved = presentation.duplicates.find(
    (item) => item.match === 'strong',
  );
  const hasManualInput = Boolean(
    intake.state.title.trim() ||
    intake.state.area.trim() ||
    intake.state.address.trim() ||
    intake.state.categories.trim() ||
    intake.state.signatureDishes.trim() ||
    intake.state.summary.trim() ||
    intake.state.latitude.trim() ||
    intake.state.longitude.trim() ||
    intake.state.tabelogScore.trim() ||
    intake.state.tabelogUrl.trim() ||
    intake.state.reservationMode !== 'unknown',
  );
  const groups = [
    {
      id: 'catalog-intake-preview-place',
      heading: 'Place',
      keys: ['identity', 'title'],
    },
    {
      id: 'catalog-intake-preview-location',
      heading: 'Location',
      keys: ['area', 'address', 'coordinates'],
    },
    {
      id: 'catalog-intake-preview-restaurant-facts',
      heading: 'Restaurant facts',
      keys: ['tabelog', 'reservation'],
    },
  ] as const;
  if (alreadySaved) {
    return (
      <div className="catalog-intake-preview">
        <div className="catalog-intake-state is-attention">
          <strong>Already saved</strong>
          <p>
            {alreadySaved.title}
            {alreadySaved.address ? ` · ${alreadySaved.address}` : ''} is
            already in your Atlas.
          </p>
          <Button
            type="button"
            onClick={() => {
              onOpenSaved(alreadySaved.itemId);
              void onCancel();
            }}
            disabled={busy}
          >
            View saved place
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void onCancel()}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="catalog-intake-preview">
      <p className="catalog-intake-note">{presentation.versionLabel}</p>
      <section
        className="catalog-intake-preview-group catalog-intake-owner-fields"
        aria-label="Restaurant profile"
      >
        <h5>Restaurant profile</h5>
        <label htmlFor="catalog-intake-preview-categories">
          Cuisine labels (separate with commas)
        </label>
        <Input
          id="catalog-intake-preview-categories"
          value={intake.state.categories}
          onChange={(event) =>
            intake.setField('categories', event.target.value)
          }
          placeholder="Unknown — add cuisine labels"
          disabled={busy}
        />
        <label htmlFor="catalog-intake-preview-signature-dishes">
          Signature dishes (separate with commas)
        </label>
        <Input
          id="catalog-intake-preview-signature-dishes"
          value={intake.state.signatureDishes}
          onChange={(event) =>
            intake.setField('signatureDishes', event.target.value)
          }
          placeholder="Optional menu items"
          disabled={busy}
        />
        <label htmlFor="catalog-intake-preview-summary">Short overview</label>
        <textarea
          id="catalog-intake-preview-summary"
          value={intake.state.summary}
          onChange={(event) => intake.setField('summary', event.target.value)}
          placeholder="Optional, in your preferred language"
          rows={3}
          disabled={busy}
        />
        {liveGoogleRating ? (
          <p>
            <a href={liveGoogleRating.url} target="_blank" rel="noreferrer">
              <span translate="no">Google Maps</span>
            </a>{' '}
            {liveGoogleRating.score.toFixed(1)}
            <small>
              Saved as a dated reference when you confirm this place.
            </small>
            {liveGoogleRating.reviewCount === undefined
              ? ''
              : ` (${liveGoogleRating.reviewCount} reviews)`}
          </p>
        ) : preview.profile?.googleRating ? (
          <p>Google: {preview.profile.googleRating.value.score.toFixed(1)}</p>
        ) : null}
        {preview.profile?.officialWebsite ? (
          <p>
            <a
              href={preview.profile.officialWebsite.value}
              target="_blank"
              rel="noreferrer"
            >
              Official website
            </a>
          </p>
        ) : null}
        {preview.profile?.bookingLink ? (
          <p>
            <a
              href={preview.profile.bookingLink.value}
              target="_blank"
              rel="noreferrer"
            >
              Booking
            </a>
          </p>
        ) : null}
      </section>
      {groups.map((group) => (
        <section
          key={group.id}
          className="catalog-intake-preview-group"
          aria-labelledby={group.id}
        >
          <h5 id={group.id}>{group.heading}</h5>
          <dl>
            {presentation.fields.map((item) =>
              group.keys.some((groupKey) => groupKey === item.key) ? (
                <div key={item.key}>
                  <dt>
                    {item.key === 'identity' ||
                    item.key === 'coordinates' ||
                    item.key === 'tabelog' ? (
                      item.label
                    ) : (
                      <label htmlFor={`catalog-intake-preview-${item.key}`}>
                        {item.label}
                      </label>
                    )}
                  </dt>
                  <dd className="catalog-intake-owner-fields">
                    {item.key === 'title' ||
                    item.key === 'area' ||
                    item.key === 'address' ? (
                      <Input
                        id={`catalog-intake-preview-${item.key}`}
                        value={intake.state[item.key]}
                        onChange={(event) =>
                          intake.setField(
                            item.key as 'title' | 'area' | 'address',
                            event.target.value,
                          )
                        }
                        placeholder={
                          item.value.startsWith('Unknown')
                            ? item.value
                            : undefined
                        }
                        disabled={busy}
                      />
                    ) : item.key === 'coordinates' ? (
                      <div
                        className="catalog-intake-coordinate-row"
                        id="catalog-intake-preview-coordinates"
                      >
                        <div>
                          <label htmlFor="catalog-intake-preview-latitude">
                            Latitude
                          </label>
                          <Input
                            id="catalog-intake-preview-latitude"
                            type="number"
                            step="any"
                            value={intake.state.latitude}
                            onChange={(event) =>
                              intake.setField('latitude', event.target.value)
                            }
                            placeholder="Unknown"
                            disabled={busy}
                          />
                        </div>
                        <div>
                          <label htmlFor="catalog-intake-preview-longitude">
                            Longitude
                          </label>
                          <Input
                            id="catalog-intake-preview-longitude"
                            type="number"
                            step="any"
                            value={intake.state.longitude}
                            onChange={(event) =>
                              intake.setField('longitude', event.target.value)
                            }
                            placeholder="Unknown"
                            disabled={busy}
                          />
                        </div>
                      </div>
                    ) : item.key === 'tabelog' ? (
                      <>
                        <label htmlFor="catalog-intake-preview-tabelog-score">
                          Tabelog score
                        </label>
                        <Input
                          id="catalog-intake-preview-tabelog-score"
                          type="number"
                          min="0"
                          max="5"
                          step="0.01"
                          value={intake.state.tabelogScore}
                          onChange={(event) =>
                            intake.setField('tabelogScore', event.target.value)
                          }
                          placeholder="Unknown"
                          disabled={busy}
                        />
                        <label htmlFor="catalog-intake-preview-tabelog-url">
                          Tabelog main listing URL
                        </label>
                        <Input
                          id="catalog-intake-preview-tabelog-url"
                          type="url"
                          value={intake.state.tabelogUrl}
                          onChange={(event) =>
                            intake.setField('tabelogUrl', event.target.value)
                          }
                          placeholder="https://tabelog.com/..."
                          disabled={busy}
                        />
                      </>
                    ) : item.key === 'reservation' ? (
                      <>
                        <select
                          id="catalog-intake-preview-reservation"
                          aria-label="Reservation rule"
                          value={intake.state.reservationMode}
                          onChange={(event) =>
                            intake.setField(
                              'reservationMode',
                              event.target.value,
                            )
                          }
                          disabled={busy}
                        >
                          <option value="unknown">Unknown</option>
                          <option value="reservable">
                            Reservations accepted
                          </option>
                          <option value="reservation_required">
                            Reservation required
                          </option>
                          <option value="not_reservable">
                            Reservations unavailable
                          </option>
                        </select>
                        <label htmlFor="catalog-intake-preview-reservation-label">
                          Source-supported explanation
                        </label>
                        <Input
                          id="catalog-intake-preview-reservation-label"
                          value={intake.state.reservationLabel}
                          onChange={(event) =>
                            intake.setField(
                              'reservationLabel',
                              event.target.value,
                            )
                          }
                          disabled={busy}
                        />
                        <label htmlFor="catalog-intake-preview-reservation-url">
                          Reservation source URL
                        </label>
                        <Input
                          id="catalog-intake-preview-reservation-url"
                          type="url"
                          value={intake.state.reservationUrl}
                          onChange={(event) =>
                            intake.setField(
                              'reservationUrl',
                              event.target.value,
                            )
                          }
                          placeholder="https://..."
                          disabled={busy}
                        />
                      </>
                    ) : (
                      item.value
                    )}
                  </dd>
                  <dd className="catalog-intake-source">
                    <details>
                      <summary>
                        {intake.state.previewNeedsRefresh
                          ? 'Evidence from previous preview'
                          : 'Evidence'}
                      </summary>
                      <span>
                        {item.evidence}
                        {item.evidenceAt
                          ? ` · ${formatTimestamp(item.evidenceAt)}`
                          : ''}
                        {item.license ? ` · ${item.license}` : ''}
                        {item.sourceUrl ? (
                          <>
                            {' · '}
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source
                            </a>
                          </>
                        ) : null}
                      </span>
                    </details>
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </section>
      ))}
      <section
        className="catalog-intake-preview-group catalog-intake-preview-warnings"
        aria-labelledby="catalog-intake-preview-warnings"
      >
        <h5 id="catalog-intake-preview-warnings">Warnings</h5>
        {presentation.duplicates.length ? (
          <div className="catalog-intake-state is-attention">
            <strong>
              {presentation.duplicates.some((item) => item.match === 'strong')
                ? 'Already saved'
                : 'Possible duplicates'}
            </strong>
            <ul>
              {presentation.duplicates.map((duplicate) => (
                <li key={duplicate.itemId}>
                  {duplicate.title}
                  {duplicate.address ? ` · ${duplicate.address}` : ''} ·{' '}
                  {duplicate.match === 'strong'
                    ? 'same restaurant'
                    : 'same location; check whether this is a different place'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {presentation.unknownFields.length ? (
          <p className="catalog-intake-note">
            Still unknown: {presentation.unknownFields.join(', ')}.
          </p>
        ) : null}
        {presentation.warnings.length ? (
          <ul className="catalog-intake-warning-list">
            {presentation.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        ) : null}
        {!presentation.duplicates.length &&
        !presentation.unknownFields.length &&
        !presentation.warnings.length ? (
          <p className="catalog-intake-note">No warnings in this preview.</p>
        ) : null}
      </section>
      <section
        className="catalog-intake-preview-group"
        aria-label="Update edited details"
      >
        <p className="catalog-intake-note">
          Edit the fields above, then update the preview before saving. Ratings
          and reservation rules can remain unknown. A changed address is looked
          up again; enter coordinates only if lookup fails.
        </p>
        {manualError ? (
          <p className="catalog-field-error" role="alert">
            {manualError}
          </p>
        ) : null}
        {intake.state.previewNeedsRefresh ? (
          <output className="catalog-intake-note">
            Your edits need to be checked. Update the preview before saving.
          </output>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => void intake.select()}
          disabled={busy || Boolean(manualError) || !hasManualInput}
        >
          Update preview
        </Button>
      </section>
      <div className="catalog-intake-actions">
        {preview.locationEvidence.status === 'unknown' ? (
          <p>
            Location is incomplete. Enter the correct address above and refresh
            the preview before saving.
          </p>
        ) : null}
        {preview.suspectedDuplicates.some((item) => item.match === 'strong') ? (
          <p>
            This restaurant is already in your Atlas. Nothing new is needed.
          </p>
        ) : null}
        <Button
          type="button"
          onClick={() => void onConfirm()}
          disabled={
            busy ||
            googleLookupCompleteKey !== previewKey ||
            intake.state.previewNeedsRefresh ||
            preview.locationEvidence.status === 'unknown' ||
            preview.suspectedDuplicates.some((item) => item.match === 'strong')
          }
        >
          {preview.suspectedDuplicates.some((item) => item.match === 'strong')
            ? 'Already saved'
            : googleLookupCompleteKey !== previewKey
              ? 'Checking Google rating…'
              : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void onCancel()}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function stageTitle(stage: IntakeController['state']['stage']): string {
  const titles = {
    idle: 'Add a place',
    loading: 'Working',
    empty: 'No match',
    candidates: 'Select a match',
    error: 'Add needs attention',
    clarification: 'Clarify this place',
    preview: 'Review the proposal',
    expired: 'Preview expired',
    conflict: 'Preview changed',
    success: 'Place saved',
  } as const;
  return titles[stage];
}

function ResearchProgress() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <output className="catalog-intake-research-progress" aria-live="polite">
      <LoaderCircle
        aria-hidden="true"
        className="catalog-intake-research-spinner"
      />
      <span>
        <strong>Agent is gathering info…</strong>
        <span className="catalog-intake-research-explanation">
          Checking the selected restaurant’s address, rating, specialties and
          reservation sources. This takes longer than finding a name.
        </span>
        <small aria-live="off">
          {elapsedSeconds}s elapsed ·{' '}
          {elapsedSeconds >= 20
            ? 'Still researching — please keep this page open.'
            : 'Nothing is saved until you confirm.'}
        </small>
      </span>
    </output>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function successMessage(
  status:
    | NonNullable<IntakeController['state']['success']>['status']
    | undefined,
): string {
  if (status === 'committed_verified') {
    return 'Place saved and available on the verified map and Nearby.';
  }
  if (status === 'committed_needs_review') {
    return 'This legacy save is not map-ready. Retry Add.';
  }
  if (status === 'already_saved') {
    return 'This restaurant is already saved. Nothing new was added.';
  }
  return 'Existing place reused; no duplicate was created.';
}

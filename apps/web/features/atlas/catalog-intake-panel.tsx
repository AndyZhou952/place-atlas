'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { CheckCircle2, CircleAlert, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useCatalogIntake } from './use-catalog-intake';

export function CatalogIntakePanel() {
  const intake = useCatalogIntake();
  const { state } = intake;
  const [submitted, setSubmitted] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const busy = state.stage === 'loading';
  const queryInvalid = submitted && !state.query.trim();

  useEffect(() => {
    if (state.focusRevision > 0) stageHeadingRef.current?.focus();
  }, [state.focusRevision]);

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
            Find matches
          </Button>
        </div>
        <small id="catalog-intake-query-help">
          Try a neighborhood or full copied address when the name is ambiguous.
        </small>
        {queryInvalid ? (
          <small
            id="catalog-intake-query-error"
            className="catalog-field-error"
          >
            Enter a restaurant name or address.
          </small>
        ) : null}
      </form>

      <div className="catalog-intake-live" aria-live="polite">
        {busy ? <p>Building the next Add step…</p> : null}
      </div>

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
            type="button"
            variant="outline"
            onClick={() => void intake.retry()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {state.stage === 'candidates' ? <CandidateStep intake={intake} /> : null}

      {state.stage === 'clarification' ? (
        <CandidateStep intake={intake} showClarification />
      ) : null}

      {state.stage === 'preview' && state.preview ? (
        <PreviewStep preview={state.preview} onCancel={intake.cancel} />
      ) : null}

      {state.stage === 'expired' || state.stage === 'conflict' ? (
        <div className="catalog-intake-state is-attention" role="alert">
          <CircleAlert aria-hidden="true" />
          <strong>{state.error?.message ?? 'The preview changed.'}</strong>
          <p>Create a new preview from the retained Owner input.</p>
          <Button type="button" onClick={() => void intake.startFresh()}>
            Generate a new preview
          </Button>
        </div>
      ) : null}

      {state.stage === 'success' ? (
        <output className="catalog-intake-state is-success" aria-live="polite">
          <CheckCircle2 aria-hidden="true" />
          <strong>Place saved to the Owner catalog.</strong>
          <span className="catalog-intake-note">
            Receipt {state.success?.receiptRef}
          </span>
        </output>
      ) : null}
    </section>
  );
}

type IntakeController = ReturnType<typeof useCatalogIntake>;

function CandidateStep({
  intake,
  showClarification = false,
}: {
  readonly intake: IntakeController;
  readonly showClarification?: boolean;
}) {
  const { state } = intake;
  const clarificationId = showClarification
    ? 'catalog-intake-clarification'
    : undefined;
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
                />
                <span>
                  <strong>{candidate.transientName}</strong>
                  <small>{candidate.transientAddress}</small>
                </span>
              </label>
              <a
                href={candidate.attribution.url}
                target="_blank"
                rel="noreferrer"
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
      <div className="catalog-intake-owner-fields">
        <label htmlFor="catalog-intake-title-field">Confirmed name</label>
        <Input
          id="catalog-intake-title-field"
          value={state.title}
          onChange={(event) => intake.setField('title', event.target.value)}
          placeholder="Optional — the original query remains the proposal"
          aria-describedby={clarificationId}
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
          aria-describedby={clarificationId}
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
          aria-describedby={clarificationId}
          aria-invalid={
            showClarification && state.clarification?.fields.includes('address')
          }
        />
      </div>
      <div className="catalog-intake-actions">
        <Button
          type="button"
          onClick={() => void intake.select()}
          disabled={state.selectedOrdinal === undefined}
        >
          <Plus data-icon="inline-start" />
          Build preview
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void intake.cancel()}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  preview,
  onCancel,
}: {
  readonly preview: NonNullable<IntakeController['state']['preview']>;
  readonly onCancel: () => Promise<void>;
}) {
  const title = preview.ownerFields.title ?? preview.titleProposal?.value;
  const address = preview.ownerFields.address ?? preview.addressProposal?.value;
  const location = preview.locationEvidence;
  return (
    <div className="catalog-intake-preview">
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{title ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{address ?? 'Unknown — needs review'}</dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>
            {location.status === 'known'
              ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
              : 'Unknown — excluded from Nearby'}
          </dd>
        </div>
      </dl>
      {location.status === 'known' &&
      location.provenance === 'durable_geocoder_observed' ? (
        <p className="catalog-intake-source">
          <a href={location.sourceUrl} target="_blank" rel="noreferrer">
            {location.provider} source
          </a>{' '}
          · {location.license} · checked {formatTimestamp(location.checkedAt)}
        </p>
      ) : null}
      {preview.unknownFields.length ? (
        <p className="catalog-intake-note">
          Still unknown: {preview.unknownFields.join(', ')}.
        </p>
      ) : null}
      {preview.warnings.length ? (
        <ul className="catalog-intake-warning-list">
          {preview.warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="catalog-intake-actions">
        <Button
          type="button"
          disabled
          aria-describedby="catalog-intake-confirm-disabled"
        >
          Confirm and save
        </Button>
        <Button type="button" variant="ghost" onClick={() => void onCancel()}>
          Cancel
        </Button>
      </div>
      <p id="catalog-intake-confirm-disabled" className="catalog-intake-note">
        Final catalog publishing is not connected yet.
      </p>
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

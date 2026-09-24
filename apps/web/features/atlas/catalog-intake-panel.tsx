'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { CheckCircle2, CircleAlert, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { presentCatalogIntakePreview } from '@/product/application/catalog-intake/catalog-intake-preview-presenter';

import { useCatalogIntake } from './use-catalog-intake';

export function CatalogIntakePanel({
  onCommitted,
}: {
  readonly onCommitted?: () => void;
}) {
  const intake = useCatalogIntake(onCommitted);
  const { state } = intake;
  const [submitted, setSubmitted] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const busy = state.stage === 'loading';
  const confirmInProgress =
    busy &&
    state.lastOperation === 'confirm' &&
    (state.previousStage === 'preview' || state.previousStage === 'conflict');
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
        {busy ? <p>{loadingMessage(state.lastOperation)}</p> : null}
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

      {(state.stage === 'preview' || confirmInProgress) && state.preview ? (
        <PreviewStep
          preview={state.preview}
          onConfirm={intake.confirm}
          onCancel={intake.cancel}
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
            preview={state.preview}
            onConfirm={intake.confirm}
            onCancel={intake.cancel}
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
              It is not visible on the public map or Nearby yet. Complete the
              missing evidence from Owner review.
            </p>
          ) : null}
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
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm and save',
  busy = false,
}: {
  readonly preview: NonNullable<IntakeController['state']['preview']>;
  readonly onConfirm: () => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly confirmLabel?: string;
  readonly busy?: boolean;
}) {
  const presentation = presentCatalogIntakePreview(preview);
  return (
    <div className="catalog-intake-preview">
      <p className="catalog-intake-note">{presentation.versionLabel}</p>
      <dl>
        {presentation.fields.map((item) => (
          <div key={item.key}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            <dd className="catalog-intake-source">
              {item.evidence}
              {item.evidenceAt ? ` · ${formatTimestamp(item.evidenceAt)}` : ''}
              {item.license ? ` · ${item.license}` : ''}
              {item.sourceUrl ? (
                <>
                  {' · '}
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {presentation.duplicates.length ? (
        <div className="catalog-intake-state is-attention">
          <strong>Possible duplicates</strong>
          <ul>
            {presentation.duplicates.map((duplicate) => (
              <li key={duplicate.itemId}>
                {duplicate.title}
                {duplicate.address ? ` · ${duplicate.address}` : ''} ·{' '}
                {duplicate.match} match
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
      <div className="catalog-intake-actions">
        <Button type="button" onClick={() => void onConfirm()} disabled={busy}>
          {confirmLabel}
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function loadingMessage(
  operation: IntakeController['state']['lastOperation'],
): string {
  const messages = {
    discover: 'Finding possible matches…',
    select: 'Building the review preview…',
    confirm: 'Confirming and saving…',
    cancel: 'Cancelling this Add session…',
  } as const;
  return operation ? messages[operation] : 'Building the next Add step…';
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
    return 'Place saved to Owner review.';
  }
  return 'Existing place reused; no duplicate was created.';
}

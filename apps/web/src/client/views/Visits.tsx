import { ChevronLeft, ChevronRight, ImagePlus, NotebookPen, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Media, Visit } from '../../shared/types.ts';
import { localDate } from '../viewmodels/selectors.ts';
import { type AtlasViewModel, MAX_FILES_PER_SELECTION } from '../viewmodels/useAtlas.ts';
import { ConfirmDialog, RestaurantPicker } from './common.tsx';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';

function parseRating(value: string): number | undefined | 'invalid' {
  if (!value.trim()) return undefined;
  const rating = Number(value);
  return rating >= 0 && rating <= 10 ? rating : 'invalid';
}

/** New visit; the rating updates the restaurant's overall score. */
export function VisitForm({
  atlas,
  restaurantId,
}: {
  readonly atlas: AtlasViewModel;
  readonly restaurantId?: string;
}) {
  const [chosenId, setChosenId] = useState('');
  const targetId = restaurantId ?? chosenId;
  const [visitedOn, setVisitedOn] = useState(localDate());
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // After a partial upload failure the visit exists; retrying reuses the same file ids.
  const [pendingUpload, setPendingUpload] = useState<{
    visitId: string;
    files: File[];
    ids: string[];
  }>();
  const busy =
    atlas.isPending('journal') ||
    Boolean(pendingUpload && atlas.isPending(`media:${pendingUpload.visitId}`));

  const upload = async (job: { visitId: string; files: File[]; ids: string[] }) => {
    try {
      await atlas.uploadMedia(job.visitId, job.files, job.ids);
      setPendingUpload(undefined);
      setSaved(true);
    } catch {
      setPendingUpload(job);
      setError(
        'The visit was saved, but some media did not upload. Retry; this will not create another visit.',
      );
    }
  };

  const submit = async () => {
    const parsed = parseRating(rating);
    if (parsed === 'invalid') return setError('Enter a rating from 0 to 10.');
    setError('');
    const visitId = await atlas
      .saveVisit(undefined, {
        restaurantId: targetId,
        visitedOn,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(parsed === undefined ? {} : { rating: parsed }),
      })
      .catch(() => undefined);
    if (!visitId) return;
    setNote('');
    setRating('');
    setFiles([]);
    if (files.length) await upload({ visitId, files, ids: files.map(() => crypto.randomUUID()) });
    else setSaved(true);
  };

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  return (
    <form className="stack" onSubmit={(event) => (event.preventDefault(), void submit())}>
      {restaurantId ? null : (
        <RestaurantPicker
          id="visit-restaurant"
          label="Restaurant"
          restaurants={atlas.restaurants}
          value={chosenId}
          onChange={setChosenId}
          disabled={busy}
        />
      )}
      <div className="pair">
        <label>
          Visited
          <input
            type="date"
            required
            value={visitedOn}
            disabled={busy}
            onChange={(event) => setVisitedOn(event.target.value)}
          />
        </label>
        <label>
          Overall マイスコア / 10
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            placeholder="Optional"
            value={rating}
            disabled={busy}
            onChange={(event) => setRating(event.target.value)}
          />
        </label>
      </div>
      <label>
        Note (optional)
        <textarea
          rows={4}
          value={note}
          disabled={busy}
          placeholder="What stood out? What would you order next time?"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label className="file-input">
        <ImagePlus aria-hidden="true" />{' '}
        {files.length ? `${files.length} selected` : 'Photos or videos (optional)'}
        <input
          type="file"
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            if (chosen.length > MAX_FILES_PER_SELECTION)
              setError(`Choose up to ${MAX_FILES_PER_SELECTION} files at a time.`);
            else setFiles(chosen);
            event.target.value = '';
          }}
        />
      </label>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <output className="success">Visit saved</output> : null}
      {pendingUpload ? (
        <div className="actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void upload(pendingUpload)}
          >
            Retry media upload
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => (setPendingUpload(undefined), setError(''))}
          >
            Continue without it
          </button>
        </div>
      ) : (
        <button type="submit" className="button" disabled={busy || !targetId || !visitedOn}>
          <NotebookPen aria-hidden="true" /> {busy ? 'Saving…' : 'Save visit'}
        </button>
      )}
    </form>
  );
}

export function VisitList({
  atlas,
  owner,
  visits,
  numbers,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly visits: readonly Visit[];
  readonly numbers?: ReadonlyMap<string, number>;
}) {
  const [deleting, setDeleting] = useState<Visit>();
  return (
    <ol className="visits">
      {visits.map((visit, index) => (
        <VisitItem
          key={visit.id}
          atlas={atlas}
          owner={owner}
          visit={visit}
          number={numbers?.get(visit.id) ?? visits.length - index}
          onDelete={() => setDeleting(visit)}
        />
      ))}
      {deleting ? (
        <ConfirmDialog
          title="Delete this visit?"
          body={`The visit from ${deleting.visitedOn} and its photos will be permanently removed.`}
          action="Delete"
          busy={atlas.isPending('journal')}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() =>
            void atlas.deleteVisit(deleting.id).then(
              () => setDeleting(undefined),
              () => undefined,
            )
          }
        />
      ) : null}
    </ol>
  );
}

function VisitItem({
  atlas,
  owner,
  visit,
  number,
  onDelete,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly visit: Visit;
  readonly number: number;
  readonly onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [restaurantId, setRestaurantId] = useState(visit.restaurantId);
  const [visitedOn, setVisitedOn] = useState(visit.visitedOn);
  const [note, setNote] = useState(visit.note ?? '');
  const busy = atlas.isPending('journal');

  if (editing) {
    return (
      <li className="visit">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void atlas
              .saveVisit(visit.id, {
                restaurantId,
                visitedOn,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
              .then(
                () => setEditing(false),
                () => undefined,
              );
          }}
        >
          <RestaurantPicker
            id={`visit-${visit.id}`}
            label="Restaurant"
            restaurants={atlas.restaurants}
            value={restaurantId}
            onChange={setRestaurantId}
            disabled={busy}
          />
          {restaurantId && restaurantId !== visit.restaurantId ? (
            <small>The note and photos move with this visit.</small>
          ) : null}
          <label>
            Visited
            <input
              type="date"
              required
              value={visitedOn}
              onChange={(event) => setVisitedOn(event.target.value)}
            />
          </label>
          <label>
            Note
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="actions">
            <button
              type="submit"
              className="button small"
              disabled={busy || !restaurantId || !visitedOn}
            >
              Save
            </button>
            <button type="button" className="button ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="visit">
      <div className="visit-heading">
        <span>
          {number}回目 · {visit.visitedOn}
        </span>
        {owner ? (
          <span className="row-actions">
            <button
              type="button"
              aria-label={`Edit visit ${number}`}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete visit ${number}`} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
      {visit.note ? <p className="pre">{visit.note}</p> : null}
      <MediaGallery atlas={atlas} owner={owner} visit={visit} />
    </li>
  );
}

function MediaGallery({
  atlas,
  owner,
  visit,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly visit: Visit;
}) {
  const [open, setOpen] = useState<number>();
  const uploading = atlas.isPending(`media:${visit.id}`);
  return (
    <div className="gallery">
      {visit.media.slice(0, 4).map((media, index) => (
        <button
          key={media.id}
          type="button"
          className="thumb"
          aria-label={`Open ${media.caption || 'photo'}`}
          onClick={() => setOpen(index)}
        >
          {media.contentType.startsWith('video/') ? (
            <span>▶ Video</span>
          ) : (
            <img src={media.url} alt={media.caption ?? 'Visit photo'} loading="lazy" />
          )}
        </button>
      ))}
      {visit.media.length > 4 ? (
        <button type="button" className="button ghost small" onClick={() => setOpen(0)}>
          View all {visit.media.length}
        </button>
      ) : null}
      {owner ? (
        <label className="file-input small">
          <ImagePlus aria-hidden="true" /> {uploading ? 'Uploading…' : 'Add photos'}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            disabled={uploading}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length) void atlas.uploadMedia(visit.id, files).catch(() => undefined);
            }}
          />
        </label>
      ) : null}
      {open !== undefined && visit.media.length ? (
        <Lightbox
          atlas={atlas}
          owner={owner}
          visit={visit}
          media={visit.media}
          start={open}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </div>
  );
}

function Lightbox({
  atlas,
  owner,
  visit,
  media,
  start,
  onClose,
}: {
  readonly atlas: AtlasViewModel;
  readonly owner: boolean;
  readonly visit: Visit;
  readonly media: readonly Media[];
  readonly start: number;
  readonly onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<number>(undefined);
  const current = media[Math.min(index, media.length - 1)];
  const move = (step: number) => setIndex((value) => (value + step + media.length) % media.length);
  useEffect(() => dialog.current?.showModal(), []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
  if (!current) return null;
  return (
    <dialog ref={dialog} className="lightbox" aria-label="Photo viewer" onClose={onClose}>
      <header>
        <span>
          {index + 1} / {media.length}
        </span>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div
        className="stage"
        onPointerDown={(event) => (swipe.current = event.clientX)}
        onPointerUp={(event) => {
          const delta = event.clientX - (swipe.current ?? event.clientX);
          if (Math.abs(delta) > 45 && media.length > 1) move(delta > 0 ? -1 : 1);
        }}
      >
        {current.contentType.startsWith('video/') ? (
          // Personal uploads have no caption track.
          // oxlint-disable-next-line jsx-a11y/media-has-caption
          <video key={current.id} src={current.url} controls playsInline preload="metadata" />
        ) : (
          <img
            key={current.id}
            src={current.url}
            alt={current.caption ?? 'Visit photo'}
            draggable={false}
          />
        )}
        {media.length > 1 ? (
          <>
            <button
              type="button"
              className="icon-button previous"
              aria-label="Previous"
              onClick={() => move(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button next"
              aria-label="Next"
              onClick={() => move(1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      <footer>
        {owner ? (
          <>
            <input
              key={current.id}
              defaultValue={current.caption ?? ''}
              maxLength={160}
              aria-label="Caption"
              placeholder="What is this?"
              onBlur={(event) => {
                if (event.target.value.trim() !== (current.caption ?? ''))
                  void atlas
                    .updateCaption(visit.id, current.id, event.target.value)
                    .catch(() => undefined);
              }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Delete this photo"
              onClick={() => {
                if (!window.confirm('Delete this photo or video?')) return;
                if (media.length === 1) onClose();
                void atlas.deleteMedia(visit.id, current.id).catch(() => undefined);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </>
        ) : (
          <p>{current.caption ?? ''}</p>
        )}
      </footer>
    </dialog>
  );
}

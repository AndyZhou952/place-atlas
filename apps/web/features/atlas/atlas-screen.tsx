'use client';

import { type SyntheticEvent, useState } from 'react';
import {
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Database,
  ExternalLink,
  Inbox,
  LocateFixed,
  MapPin,
  NotebookPen,
  Pencil,
  Search,
  Send,
  Sparkles,
  Star,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type {
  AtlasItem,
  AtlasItemKind,
  AtlasKindFilter,
  AtlasView,
  PersonalState,
} from './model';
import { useAtlasViewModel } from './use-atlas-view-model';

const filters: readonly {
  value: AtlasKindFilter;
  label: string;
  icon?: typeof Coffee;
}[] = [
  { value: 'all', label: 'All verified' },
  { value: 'food', label: 'Food', icon: Coffee },
  { value: 'event', label: 'Events', icon: CalendarDays },
  { value: 'architecture', label: 'Architecture', icon: Building2 },
];

const kindLabel: Record<AtlasItemKind, string> = {
  food: 'Food',
  event: 'Event',
  architecture: 'Architecture',
};

const navItems: readonly { value: AtlasView; label: string }[] = [
  { value: 'map', label: 'Map' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'journal', label: 'Journal' },
];

export function AtlasScreen() {
  const vm = useAtlasViewModel();

  return (
    <main className="atlas-shell">
      <header className="atlas-header">
        <div className="brand-lockup">
          <span className="brand-seal" aria-hidden="true">
            旅
          </span>
          <div>
            <p className="eyebrow">Private working atlas</p>
            <h1>Japan Atlas</h1>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.value}
              type="button"
              className={vm.view === item.value ? 'is-active' : undefined}
              aria-current={vm.view === item.value ? 'page' : undefined}
              onClick={() => vm.setView(item.value)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <Button
          className="ask-button"
          aria-label="Find nearby Atlas items"
          onClick={() => void vm.locateNearby()}
        >
          <Sparkles data-icon="inline-start" />
          Ask nearby
        </Button>
      </header>

      <section className="system-strip" aria-label="System status">
        <span>
          <Database aria-hidden="true" /> Durable Atlas database
        </span>
        <span>
          <Bot aria-hidden="true" /> Agent API + browser tools ready
        </span>
        <span className="status-pending">
          <Clock3 aria-hidden="true" /> WeChat/OpenClaw channel not connected
        </span>
      </section>

      {vm.notice ? <p className="notice-bar">{vm.notice}</p> : null}

      {vm.view === 'map' ? <MapWorkspace vm={vm} /> : null}
      {vm.view === 'inbox' ? <InboxWorkspace vm={vm} /> : null}
      {vm.view === 'journal' ? <JournalWorkspace vm={vm} /> : null}
    </main>
  );
}

type AtlasViewModel = ReturnType<typeof useAtlasViewModel>;

function MapWorkspace({ vm }: { readonly vm: AtlasViewModel }) {
  return (
    <>
      <section className="command-strip" aria-label="Search Atlas">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={vm.query}
            onChange={(event) => vm.setQuery(event.target.value)}
            placeholder="Search name, neighborhood, address, or tag"
            aria-label="Search Atlas items"
          />
        </div>
        <p>
          <CheckCircle2 aria-hidden="true" />
          Every visible record has a checked official or Tabelog source.
        </p>
      </section>

      <section className="atlas-workspace" id="map">
        <aside className="collection-panel" aria-label="Atlas collection">
          <div className="summary-row">
            <Summary label="Saved" value={vm.summary.saved} />
            <Summary
              label="Review"
              value={vm.summary.needsReview}
              tone="review"
            />
            <Summary label="Time-sensitive" value={vm.summary.timeSensitive} />
          </div>

          <div className="filter-row" aria-label="Filter by type">
            {filters.map((filter) => {
              const Icon = filter.icon;
              const active = vm.kind === filter.value;
              return (
                <Button
                  key={filter.value}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  aria-pressed={active}
                  onClick={() => vm.setKind(filter.value)}
                >
                  {Icon ? <Icon data-icon="inline-start" /> : null}
                  {filter.label}
                </Button>
              );
            })}
          </div>

          <div className="result-heading">
            <div>
              <p className="eyebrow">Tokyo · source checked 2026-09-06</p>
              <h2>{vm.visibleItems.length} real records</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void vm.locateNearby()}
            >
              <LocateFixed data-icon="inline-start" /> Near me
            </Button>
          </div>
          {vm.locationStatus ? (
            <p className="location-status">{vm.locationStatus}</p>
          ) : null}

          <div className="place-list" aria-live="polite">
            {vm.visibleItems.length ? (
              vm.visibleItems.map((item) => (
                <PlaceRow
                  key={item.id}
                  item={item}
                  selected={vm.selectedItem.id === item.id}
                  distance={vm.distances[item.id]}
                  onSelect={() => vm.selectItem(item.id)}
                />
              ))
            ) : (
              <div className="empty-state">
                <CircleHelp aria-hidden="true" />
                <strong>No verified item matches.</strong>
                <span>Try another neighborhood or clear the type filter.</span>
              </div>
            )}
          </div>
        </aside>

        <section className="map-panel" aria-label="Map and selected place">
          <iframe
            key={vm.selectedItem.id}
            title={`Map centered on ${vm.selectedItem.title}`}
            src={vm.mapUrl}
            className="map-frame"
            loading="eager"
          />
          <PlaceDetail key={vm.selectedItem.id} vm={vm} />
        </section>
      </section>
    </>
  );
}

function PlaceRow({
  item,
  selected,
  distance,
  onSelect,
}: {
  readonly item: AtlasItem;
  readonly selected: boolean;
  readonly distance?: number;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('place-row', selected && 'is-selected')}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={`kind-mark kind-${item.kind}`} aria-hidden="true">
        {item.kind === 'food' ? '食' : item.kind === 'event' ? '日' : '建'}
      </span>
      <span className="place-copy">
        <span className="place-title-line">
          <strong>{item.title}</strong>
          {item.tabelog ? (
            <span className="list-rating">
              食べログ {item.tabelog.score.toFixed(2)}
            </span>
          ) : (
            <span>{kindLabel[item.kind]}</span>
          )}
        </span>
        {item.alternateTitle ? (
          <span className="place-local">{item.alternateTitle}</span>
        ) : null}
        <span className="place-meta">
          {item.area} · {item.reservation.label}
          {distance === undefined ? '' : ` · ${distance.toFixed(1)} km`}
        </span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function PlaceDetail({ vm }: { readonly vm: AtlasViewModel }) {
  const item = vm.selectedItem;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [personalState, setPersonalState] = useState<PersonalState>(
    item.personalState,
  );

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await vm.saveItemEdit(item.id, { title, description, personalState });
      setEditing(false);
    } catch {
      // The view model presents the error in the notice bar.
    }
  }

  return (
    <Card className="detail-card">
      <CardHeader>
        <div className="detail-heading-row">
          <div>
            <p className="eyebrow">
              {kindLabel[item.kind]} · {item.area} · {item.verificationStatus}
            </p>
            <CardTitle>{item.title}</CardTitle>
            {item.alternateTitle ? (
              <p className="detail-local">{item.alternateTitle}</p>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil data-icon="inline-start" /> Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <form className="edit-form" onSubmit={submit}>
            <label htmlFor="edit-title">
              Display title
              <Input
                id="edit-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label htmlFor="edit-description">
              Personal description
              <textarea
                id="edit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
              />
            </label>
            <label htmlFor="edit-state">
              Personal state
              <select
                id="edit-state"
                value={personalState}
                onChange={(event) =>
                  setPersonalState(event.target.value as PersonalState)
                }
              >
                <option value="candidate">Candidate</option>
                <option value="saved">Saved</option>
                <option value="planned">Planned</option>
                <option value="visited">Visited</option>
              </select>
            </label>
            <div className="form-actions">
              <Button type="submit" size="sm" disabled={vm.busy}>
                Save changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                <X data-icon="inline-start" /> Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="detail-summary">{item.description}</p>
            <p className="address-line">
              <MapPin aria-hidden="true" /> {item.address}
            </p>

            <div className="fact-grid">
              {item.tabelog ? (
                <a
                  className="fact-card rating-card"
                  href={item.tabelog.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>食べログ</span>
                  <strong>
                    <Star aria-hidden="true" /> {item.tabelog.score.toFixed(2)}
                  </strong>
                  <small>
                    {item.tabelog.reviewCount?.toLocaleString()} reviews ·
                    checked {item.tabelog.checkedAt}
                  </small>
                </a>
              ) : null}
              <div className="fact-card">
                <span>Visit / booking</span>
                <strong>{item.reservation.label}</strong>
                <small>
                  {item.reservation.bookingWindowLabel ??
                    `Checked ${item.reservation.checkedAt}`}
                </small>
              </div>
              {item.event ? (
                <div className="fact-card event-card">
                  <span>Exhibition dates</span>
                  <strong>{item.event.displayDate}</strong>
                  <small>Official schedule · checked {item.verifiedAt}</small>
                </div>
              ) : null}
            </div>

            {item.reservation.releaseNote ? (
              <p className="reservation-note">
                <Clock3 aria-hidden="true" /> {item.reservation.releaseNote}
              </p>
            ) : null}

            <div className="source-links">
              {item.sources.map((source) => (
                <a
                  key={`${source.role}-${source.url}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.label} <ExternalLink aria-hidden="true" />
                </a>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InboxWorkspace({ vm }: { readonly vm: AtlasViewModel }) {
  const [creatorName, setCreatorName] = useState('');
  const [sourceRef, setSourceRef] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await vm.queueImport({ creatorName, sourceRef });
      setCreatorName('');
      setSourceRef('');
    } catch {
      // The view model presents the error in the notice bar.
    }
  }

  return (
    <section className="single-workspace" id="inbox">
      <div className="workspace-intro">
        <p className="eyebrow">Acquisition inbox</p>
        <h2>Queue a creator once, review the places later.</h2>
        <p>
          A job is persisted immediately. Web Access will run through a
          dedicated logged-in browser; uncertain identities must remain in
          review instead of entering the map.
        </p>
      </div>

      <div className="inbox-grid">
        <Card>
          <CardHeader>
            <CardTitle>New creator import</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="stacked-form" onSubmit={submit}>
              <label htmlFor="creator-name">
                Creator name
                <Input
                  id="creator-name"
                  value={creatorName}
                  onChange={(event) => setCreatorName(event.target.value)}
                  placeholder="e.g. 在日本摸鱼的小超人"
                  required
                />
              </label>
              <label htmlFor="source-ref">
                Profile, channel, post URL, or platform ID
                <Input
                  id="source-ref"
                  value={sourceRef}
                  onChange={(event) => setSourceRef(event.target.value)}
                  placeholder="rednote:274834935"
                  required
                />
              </label>
              <Button type="submit" disabled={vm.busy}>
                <Send data-icon="inline-start" /> Queue import
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collector status</CardTitle>
          </CardHeader>
          <CardContent className="collector-status">
            <div>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Intake database ready</strong>
                <small>Jobs and review counts persist in D1.</small>
              </span>
            </div>
            <div>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Agent endpoints ready</strong>
                <small>
                  Map, edit, queue, and journal actions share one API.
                </small>
              </span>
            </div>
            <div className="pending">
              <Clock3 aria-hidden="true" />
              <span>
                <strong>Collector worker pending</strong>
                <small>
                  Web Access is installed locally; browser login and worker
                  bridge are next.
                </small>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="job-section">
        <h3>Import jobs</h3>
        {vm.importJobs.length ? (
          <div className="job-list">
            {vm.importJobs.map((job) => (
              <article key={job.id} className="job-row">
                <Inbox aria-hidden="true" />
                <div>
                  <strong>{job.creatorName}</strong>
                  <span>
                    {job.platform} · {job.sourceRef}
                  </span>
                </div>
                <span className={`job-status status-${job.status}`}>
                  {job.status.replace('_', ' ')}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-panel">
            <Inbox aria-hidden="true" />
            <strong>No imports queued yet.</strong>
            <span>
              Add a creator above; this list contains real persisted jobs only.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function JournalWorkspace({ vm }: { readonly vm: AtlasViewModel }) {
  const [itemId, setItemId] = useState(vm.selectedItem.id);
  const [visitedAt, setVisitedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [rating, setRating] = useState('4');
  const [note, setNote] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await vm.addJournal({ itemId, visitedAt, rating: Number(rating), note });
      setNote('');
    } catch {
      // The view model presents the error in the notice bar.
    }
  }

  return (
    <section className="single-workspace" id="journal">
      <div className="workspace-intro">
        <p className="eyebrow">Personal journal</p>
        <h2>Your own rating remains separate from Tabelog.</h2>
        <p>
          Record a visit now; photo uploads will be added with object storage in
          the next slice.
        </p>
      </div>
      <div className="journal-grid">
        <Card>
          <CardHeader>
            <CardTitle>Add a visit</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="stacked-form" onSubmit={submit}>
              <label htmlFor="journal-place">
                Place
                <select
                  id="journal-place"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                >
                  {vm.visibleItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-pair">
                <label htmlFor="visited-at">
                  Visited
                  <Input
                    id="visited-at"
                    type="date"
                    value={visitedAt}
                    onChange={(event) => setVisitedAt(event.target.value)}
                    required
                  />
                </label>
                <label htmlFor="journal-rating">
                  My rating / 5
                  <Input
                    id="journal-rating"
                    type="number"
                    min="0"
                    max="5"
                    step="0.5"
                    value={rating}
                    onChange={(event) => setRating(event.target.value)}
                    required
                  />
                </label>
              </div>
              <label htmlFor="journal-note">
                Note
                <textarea
                  id="journal-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={5}
                  placeholder="What stood out? What would you order next time?"
                  required
                />
              </label>
              <Button type="submit" disabled={vm.busy}>
                <NotebookPen data-icon="inline-start" /> Save visit
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="journal-list">
          {vm.journalEntries.length ? (
            vm.journalEntries.map((entry) => (
              <article key={entry.id} className="journal-entry">
                <div>
                  <strong>{entry.itemTitle}</strong>
                  <span>{entry.visitedAt}</span>
                </div>
                <span className="personal-score">
                  {entry.rating.toFixed(1)}
                </span>
                <p>{entry.note}</p>
              </article>
            ))
          ) : (
            <div className="empty-panel">
              <NotebookPen aria-hidden="true" />
              <strong>No visits recorded yet.</strong>
              <span>
                Journal entries appear only after you save a real visit.
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'review';
}) {
  return (
    <div className={cn('summary-item', tone === 'review' && 'summary-review')}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

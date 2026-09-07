'use client';

import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Coffee,
  Database,
  ExternalLink,
  Heart,
  Inbox,
  ListFilter,
  LocateFixed,
  MapPin,
  NotebookPen,
  Pencil,
  Search,
  Send,
  Sparkles,
  Star,
  Trash2,
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
  VisitRecord,
} from './model';
import { AtlasMap } from './atlas-map';
import { filterJournalVisits } from './journal-filter';
import { normalizeRating, parseOptionalRating } from './rating';
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
type LayoutVariant = 'floating' | 'split' | 'bottom';

function MapWorkspace({ vm }: { readonly vm: AtlasViewModel }) {
  const [listOpen, setListOpen] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<AtlasItem>();
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>('split');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get(
        'layout',
      );
      if (
        requested === 'floating' ||
        requested === 'split' ||
        requested === 'bottom'
      ) {
        setLayoutVariant(requested);
        setListOpen(requested !== 'floating');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const layoutClass =
    layoutVariant === 'split'
      ? 'split-sidebar-layout'
      : layoutVariant === 'bottom'
        ? 'bottom-sheet-layout'
        : 'floating-drawer-layout';

  return (
    <section className="map-explorer" id="map">
      <section
        className={cn('map-panel', layoutClass, listOpen && 'is-list-open')}
        aria-label="Map and selected place"
      >
        <AtlasMap
          items={vm.visibleItems}
          selectedId={vm.selectedItem?.id ?? ''}
          onSelect={vm.selectItem}
        />

        <Button
          className="map-search-toggle"
          variant="outline"
          aria-expanded={listOpen}
          aria-controls="atlas-collection"
          onClick={() => setListOpen((open) => !open)}
        >
          <ListFilter data-icon="inline-start" />
          {listOpen ? 'Hide places' : 'Search places'}
        </Button>

        <aside
          id="atlas-collection"
          className={cn('collection-panel', listOpen && 'is-open')}
          aria-label="Atlas collection"
          aria-hidden={!listOpen}
        >
          <div className="collection-heading">
            <div>
              <p className="eyebrow">Tokyo Atlas</p>
              <h2>Places</h2>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close place list"
              onClick={() => setListOpen(false)}
            >
              <X />
            </Button>
          </div>

          <div className="search-field">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={vm.query}
              onChange={(event) => vm.setQuery(event.target.value)}
              placeholder="Search name, area, description, or tag"
              aria-label="Search Atlas items"
              tabIndex={listOpen ? 0 : -1}
            />
          </div>

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

          <div
            className="filter-row personal-filter-row"
            aria-label="Filter by visit and favourite status"
          >
            <Button
              size="sm"
              variant={
                vm.personalFilter === 'all' && !vm.favoriteOnly
                  ? 'default'
                  : 'outline'
              }
              aria-pressed={vm.personalFilter === 'all' && !vm.favoriteOnly}
              onClick={() => {
                vm.setPersonalFilter('all');
                vm.setFavoriteOnly(false);
              }}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={
                vm.personalFilter === 'unvisited' ? 'default' : 'outline'
              }
              aria-pressed={vm.personalFilter === 'unvisited'}
              onClick={() =>
                vm.setPersonalFilter(
                  vm.personalFilter === 'unvisited' ? 'all' : 'unvisited',
                )
              }
            >
              Not yet
            </Button>
            <Button
              size="sm"
              variant={vm.personalFilter === 'visited' ? 'default' : 'outline'}
              aria-pressed={vm.personalFilter === 'visited'}
              onClick={() =>
                vm.setPersonalFilter(
                  vm.personalFilter === 'visited' ? 'all' : 'visited',
                )
              }
            >
              行った
            </Button>
            <Button
              size="icon-sm"
              variant={vm.favoriteOnly ? 'default' : 'outline'}
              aria-label="お気に入り"
              title="お気に入り"
              aria-pressed={vm.favoriteOnly}
              onClick={() => vm.setFavoriteOnly(!vm.favoriteOnly)}
            >
              <Heart fill={vm.favoriteOnly ? 'currentColor' : 'none'} />
            </Button>
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
                  selected={vm.selectedItem?.id === item.id}
                  distance={vm.distances[item.id]}
                  onSelect={() => vm.selectItem(item.id)}
                  onToggleFavorite={() =>
                    void vm.saveAssessment(item.id, {
                      isFavorite: !item.isFavorite,
                    })
                  }
                  onToggleVisited={() =>
                    void vm.saveAssessment(item.id, {
                      hasVisited: !item.hasVisited,
                    })
                  }
                  onDelete={() => setPendingDelete(item)}
                  busy={vm.isItemPending(item.id)}
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
        {vm.selectedItem ? (
          <PlaceDetail key={vm.selectedItem.id} vm={vm} />
        ) : (
          <div className="detail-card detail-card-empty">
            <CircleHelp aria-hidden="true" />
            <strong>No places match the current filters.</strong>
            <span>Open the list to adjust search or filters.</span>
          </div>
        )}
      </section>

      <DeleteItemDialog
        item={pendingDelete}
        busy={pendingDelete ? vm.isItemPending(pendingDelete.id) : false}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await vm.removeItem(pendingDelete.id);
            setPendingDelete(undefined);
          } catch {
            // The view model presents the error in the notice bar.
          }
        }}
      />
    </section>
  );
}

function PlaceRow({
  item,
  selected,
  distance,
  onSelect,
  onToggleFavorite,
  onToggleVisited,
  onDelete,
  busy,
}: {
  readonly item: AtlasItem;
  readonly selected: boolean;
  readonly distance?: number;
  readonly onSelect: () => void;
  readonly onToggleFavorite: () => void;
  readonly onToggleVisited: () => void;
  readonly onDelete: () => void;
  readonly busy: boolean;
}) {
  return (
    <div className={cn('place-row', selected && 'is-selected')}>
      <button
        type="button"
        className="place-row-main"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className={`kind-mark kind-${item.kind}`} aria-hidden="true">
          {item.kind === 'food' ? '食' : item.kind === 'event' ? '日' : '建'}
        </span>
        <span className="place-copy">
          <span className="place-title-line">
            <strong title={item.title}>{item.title}</strong>
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
      <div className="place-row-side">
        <span className="list-rating-group" aria-label="Ratings">
          {item.personalRating === undefined ? null : (
            <span className="list-rating is-personal">
              マイ {item.personalRating.toString()}
            </span>
          )}
          {item.tabelog ? (
            <span className="list-rating">
              食べログ {item.tabelog.score.toFixed(2)}
            </span>
          ) : (
            <span className="list-kind-label">{kindLabel[item.kind]}</span>
          )}
        </span>
        <div className="place-row-actions">
          <button
            type="button"
            className={cn('place-row-action', item.isFavorite && 'is-active')}
            aria-label={
              item.isFavorite
                ? `お気に入りを解除 ${item.title}`
                : `お気に入りに追加 ${item.title}`
            }
            aria-pressed={Boolean(item.isFavorite)}
            title={item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
            onClick={onToggleFavorite}
            disabled={busy}
          >
            <Heart fill={item.isFavorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={cn(
              'place-row-action is-visited',
              item.hasVisited && 'is-active',
            )}
            aria-label={
              item.hasVisited
                ? `未訪問に戻す ${item.title}`
                : `訪問済みにする ${item.title}`
            }
            aria-pressed={Boolean(item.hasVisited)}
            title={item.hasVisited ? '未訪問に戻す' : '訪問済みにする'}
            onClick={onToggleVisited}
            disabled={busy}
          >
            <Circle fill={item.hasVisited ? 'currentColor' : 'none'} />
            <span>行った</span>
          </button>
          <button
            type="button"
            className="place-row-action is-delete"
            aria-label={`Delete ${item.title}`}
            title="削除"
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteItemDialog({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly item?: AtlasItem;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}) {
  if (!item) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <button
        type="button"
        className="dialog-dismiss"
        aria-label="Cancel deleting this place"
        onClick={onCancel}
      />
      <div
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <span className="delete-dialog-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2 id="delete-dialog-title">この場所を削除しますか？</h2>
        <p id="delete-dialog-description">
          「{item.title}」と紐づく個人ステータス、訪問記録が Atlas
          から削除されます。
        </p>
        <div className="form-actions">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            削除
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonalRatingInline({
  item,
  vm,
}: {
  readonly item: AtlasItem;
  readonly vm: AtlasViewModel;
}) {
  const [editing, setEditing] = useState(false);
  const cancelNextBlur = useRef(false);
  const editActivatedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(
    item.personalRating === undefined ? '' : item.personalRating.toString(),
  );

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function beginEditing() {
    editActivatedAt.current = performance.now();
    setEditing(true);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    let rating: number | null;
    try {
      rating = value === '' ? null : normalizeRating(Number(value));
    } catch {
      setDraft(
        item.personalRating === undefined ? '' : item.personalRating.toString(),
      );
      return;
    }

    setEditing(false);
    try {
      await vm.saveAssessment(item.id, { overallRating: rating });
    } catch {
      // The view model restores the previous value and presents the error.
    }
  }

  if (editing) {
    return (
      <form
        className="rating-strip-item personal-rating-editor"
        onSubmit={submit}
        noValidate
      >
        <label htmlFor={`personal-rating-${item.id}`}>マイスコア</label>
        <Input
          ref={inputRef}
          id={`personal-rating-${item.id}`}
          type="number"
          min="0"
          max="5"
          step="0.5"
          value={draft}
          aria-label="マイスコア"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            if (cancelNextBlur.current) {
              cancelNextBlur.current = false;
              return;
            }
            if (performance.now() - editActivatedAt.current < 300) {
              window.requestAnimationFrame(() => inputRef.current?.focus());
              return;
            }
            event.currentTarget.form?.requestSubmit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelNextBlur.current = true;
              setDraft(
                item.personalRating === undefined
                  ? ''
                  : item.personalRating.toString(),
              );
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }

  return (
    <button
      type="button"
      className="rating-strip-item personal-rating-inline"
      title="Click to edit"
      aria-label={`マイスコア ${item.personalRating ?? '未評価'}。Click to edit`}
      onClick={beginEditing}
      onDoubleClick={beginEditing}
      onKeyDown={(event) => {
        if (event.key === 'Enter') beginEditing();
      }}
    >
      <span>マイスコア</span>
      <strong>
        {item.personalRating === undefined
          ? '未評価'
          : item.personalRating.toString()}
      </strong>
    </button>
  );
}

function PlaceDetail({ vm }: { readonly vm: AtlasViewModel }) {
  const item = vm.selectedItem!;
  const itemVisits = vm.visits.filter((visit) => visit.itemId === item.id);
  const overallCheckedAt = [
    item.verifiedAt,
    item.tabelog?.checkedAt,
    item.reservation.checkedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
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
          <div className="detail-actions">
            <Button
              variant={item.isFavorite ? 'default' : 'outline'}
              size="icon-sm"
              aria-label={
                item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'
              }
              title={item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'}
              aria-pressed={Boolean(item.isFavorite)}
              onClick={() =>
                void vm.saveAssessment(item.id, {
                  isFavorite: !item.isFavorite,
                })
              }
              disabled={vm.isItemPending(item.id)}
            >
              <Heart fill={item.isFavorite ? 'currentColor' : 'none'} />
            </Button>
            <Button
              className="visited-toggle"
              variant="outline"
              size="sm"
              aria-label={item.hasVisited ? '未訪問に戻す' : '訪問済みにする'}
              title={item.hasVisited ? '未訪問に戻す' : '訪問済みにする'}
              aria-pressed={Boolean(item.hasVisited)}
              onClick={() =>
                void vm.saveAssessment(item.id, {
                  hasVisited: !item.hasVisited,
                })
              }
              disabled={vm.isItemPending(item.id)}
            >
              <Circle
                data-icon="inline-start"
                fill={item.hasVisited ? 'currentColor' : 'none'}
              />
              行った
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil data-icon="inline-start" /> Edit
            </Button>
          </div>
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
              <Button
                type="submit"
                size="sm"
                disabled={vm.isItemPending(item.id)}
              >
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
            <div className="tag-list" aria-label="Tags">
              {item.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>

            <div className="rating-strip" aria-label="Ratings">
              <PersonalRatingInline item={item} vm={vm} />
              {item.tabelog ? (
                <a
                  className="rating-strip-item tabelog-rating-inline"
                  href={item.tabelog.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>食べログ</span>
                  <strong>
                    <Star aria-hidden="true" /> {item.tabelog.score.toFixed(2)}
                  </strong>
                  <small>
                    {item.tabelog.reviewCount?.toLocaleString()} reviews
                  </small>
                </a>
              ) : null}
              <span className="rating-visit-count">
                {itemVisits.length} visits
                {itemVisits[0] ? ` · Last ${itemVisits[0].visitedAt}` : ''}
              </span>
            </div>

            <div className="fact-grid">
              <div className="fact-card">
                <span>Visit / booking</span>
                <strong>{item.reservation.label}</strong>
                <small>
                  {item.reservation.bookingWindowLabel ??
                    item.reservation.channel ??
                    'Details in source links'}
                </small>
              </div>
              {item.event ? (
                <div className="fact-card event-card">
                  <span>Exhibition dates</span>
                  <strong>{item.event.displayDate}</strong>
                  <small>Official schedule</small>
                </div>
              ) : null}
            </div>

            {item.reservation.releaseNote ? (
              <p className="reservation-note">
                <Clock3 aria-hidden="true" /> {item.reservation.releaseNote}
              </p>
            ) : null}

            {itemVisits.length ? (
              <section className="detail-visit-history">
                <h3>訪問記録</h3>
                <ol>
                  {itemVisits.slice(0, 3).map((visit, index) => (
                    <li key={visit.id}>
                      <span>
                        Visit {itemVisits.length - index} · {visit.visitedAt}
                      </span>
                      {visit.note ? <p>{visit.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
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
            {overallCheckedAt ? (
              <p className="source-checked-at">最終確認：{overallCheckedAt}</p>
            ) : null}
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
  const [itemId, setItemId] = useState(
    vm.selectedItem?.id ?? vm.items[0]?.id ?? '',
  );
  const [visitedAt, setVisitedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [rating, setRating] = useState('3');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [placeFilter, setPlaceFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VisitRecord>();

  const filteredVisits = filterJournalVisits(vm.visits, {
    placeId: placeFilter,
    fromDate,
    toDate,
  });
  const records = vm.items
    .map((item) => ({
      item,
      visits: filteredVisits.filter((visit) => visit.itemId === item.id),
    }))
    .filter((record) => record.visits.length > 0);
  const placesWithVisits = vm.items.filter((item) =>
    vm.visits.some((visit) => visit.itemId === item.id),
  );

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedRating = rating;
    const submittedNote = note;
    let normalizedRating: number | undefined;
    try {
      normalizedRating = parseOptionalRating(submittedRating);
      setFormError('');
    } catch {
      setFormError('Enter any number from 0 to 5. It will be saved to 0.1.');
      return;
    }
    setRating('3');
    setNote('');
    try {
      await vm.addVisit({
        itemId,
        visitedAt,
        ...(normalizedRating === undefined ? {} : { rating: normalizedRating }),
        ...(submittedNote.trim() ? { note: submittedNote.trim() } : {}),
      });
    } catch {
      setRating(submittedRating);
      setNote(submittedNote);
      // The view model presents the error in the notice bar.
    }
  }

  return (
    <section className="single-workspace" id="journal">
      <div className="workspace-intro">
        <p className="eyebrow">Personal journal</p>
        <h2>Your own rating remains separate from Tabelog.</h2>
        <p>
          Record a visit now. A rating by itself is enough; notes are optional,
          and photo uploads will be added with object storage in the next slice.
        </p>
      </div>
      <div className="journal-grid">
        <Card>
          <CardHeader>
            <CardTitle>Add a visit</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="stacked-form" onSubmit={submit} noValidate>
              <label htmlFor="journal-place">
                Place
                <select
                  id="journal-place"
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                >
                  {vm.items.map((item) => (
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
                  マイスコア / 5
                  <Input
                    id="journal-rating"
                    type="number"
                    min="0"
                    max="5"
                    step="0.5"
                    value={rating}
                    onChange={(event) => setRating(event.target.value)}
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
                />
              </label>
              {formError ? (
                <small className="form-error" role="alert">
                  {formError}
                </small>
              ) : null}
              <Button
                type="submit"
                disabled={
                  vm.journalBusy || !itemId || (!rating && !note.trim())
                }
              >
                <NotebookPen data-icon="inline-start" /> Save visit
              </Button>
            </form>
          </CardContent>
        </Card>
        <div className="journal-browser">
          <div className="journal-filters" aria-label="Journal filters">
            <label htmlFor="journal-place-filter">
              Place
              <select
                id="journal-place-filter"
                value={placeFilter}
                onChange={(event) => setPlaceFilter(event.target.value)}
              >
                <option value="all">All places</option>
                {placesWithVisits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="journal-from-date">
              From
              <Input
                id="journal-from-date"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label htmlFor="journal-to-date">
              To
              <Input
                id="journal-to-date"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              aria-label="Clear journal filters"
              title="Clear filters"
              onClick={() => {
                setPlaceFilter('all');
                setFromDate('');
                setToDate('');
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="journal-list" aria-live="polite">
            {records.length ? (
              records.map(({ item, visits }) => (
                <article key={item.id} className="journal-place-record">
                  <header>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {visits.length} visits · Last {visits[0]?.visitedAt}
                      </span>
                    </div>
                    <span className="personal-score is-persistent">
                      {item.personalRating === undefined
                        ? '—'
                        : item.personalRating.toString()}
                    </span>
                  </header>
                  <ol>
                    {visits.map((visit, index) => (
                      <JournalVisitRow
                        key={visit.id}
                        item={item}
                        visit={visit}
                        visitNumber={visits.length - index}
                        busy={vm.journalBusy}
                        onSave={vm.editVisit}
                        onDelete={() => setPendingDelete(visit)}
                      />
                    ))}
                  </ol>
                </article>
              ))
            ) : (
              <div className="empty-panel">
                <NotebookPen aria-hidden="true" />
                <strong>
                  {vm.visits.length
                    ? 'No visits match these filters.'
                    : 'No visits recorded yet.'}
                </strong>
                <span>
                  {vm.visits.length
                    ? 'Try another place or clear the date range.'
                    : 'Journal entries appear only after you save a real visit.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <DeleteVisitDialog
        visit={pendingDelete}
        busy={vm.journalBusy}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await vm.removeVisit(pendingDelete.id);
            setPendingDelete(undefined);
          } catch {
            // The view model restores the record and presents the error.
          }
        }}
      />
    </section>
  );
}

function JournalVisitRow({
  item,
  visit,
  visitNumber,
  busy,
  onSave,
  onDelete,
}: {
  readonly item: AtlasItem;
  readonly visit: VisitRecord;
  readonly visitNumber: number;
  readonly busy: boolean;
  readonly onSave: AtlasViewModel['editVisit'];
  readonly onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [visitedAt, setVisitedAt] = useState(visit.visitedAt);
  const [note, setNote] = useState(visit.note ?? '');
  const [rating, setRating] = useState(
    item.personalRating === undefined ? '' : item.personalRating.toString(),
  );
  const [error, setError] = useState('');

  function beginEditing() {
    setVisitedAt(visit.visitedAt);
    setNote(visit.note ?? '');
    setRating(
      item.personalRating === undefined ? '' : item.personalRating.toString(),
    );
    setError('');
    setEditing(true);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    let normalizedRating: number | undefined;
    try {
      normalizedRating = parseOptionalRating(rating);
      setError('');
    } catch {
      setError('Enter any number from 0 to 5.');
      return;
    }

    try {
      await onSave(visit.id, {
        visitedAt,
        note: note.trim() || undefined,
        rating: normalizedRating ?? null,
      });
      setEditing(false);
    } catch {
      // The view model restores the previous record and presents the error.
    }
  }

  if (editing) {
    return (
      <li className="journal-visit is-editing">
        <form className="journal-visit-form" onSubmit={submit} noValidate>
          <div className="form-pair">
            <label htmlFor={`visit-date-${visit.id}`}>
              Visited
              <Input
                id={`visit-date-${visit.id}`}
                type="date"
                value={visitedAt}
                onChange={(event) => setVisitedAt(event.target.value)}
                required
              />
            </label>
            <label htmlFor={`visit-rating-${visit.id}`}>
              マイスコア
              <Input
                id={`visit-rating-${visit.id}`}
                type="number"
                min="0"
                max="5"
                step="0.5"
                value={rating}
                onChange={(event) => setRating(event.target.value)}
              />
            </label>
          </div>
          <label htmlFor={`visit-note-${visit.id}`}>
            Note
            <textarea
              id={`visit-note-${visit.id}`}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? (
            <small className="form-error" role="alert">
              {error}
            </small>
          ) : null}
          <div className="form-actions">
            <Button type="submit" disabled={busy || !visitedAt}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setVisitedAt(visit.visitedAt);
                setNote(visit.note ?? '');
                setRating(
                  item.personalRating === undefined
                    ? ''
                    : item.personalRating.toString(),
                );
                setError('');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="journal-visit">
      <div className="journal-visit-copy">
        <span>
          {visitNumber}回目 · {visit.visitedAt}
        </span>
        {visit.note ? <p>{visit.note}</p> : null}
      </div>
      <div className="journal-visit-actions">
        <button
          type="button"
          aria-label={`Edit visit ${visitNumber}`}
          title="Edit visit"
          onClick={beginEditing}
        >
          <Pencil aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Delete visit ${visitNumber}`}
          title="Delete visit"
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function DeleteVisitDialog({
  visit,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly visit?: VisitRecord;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}) {
  if (!visit) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <button
        type="button"
        className="dialog-dismiss"
        aria-label="Cancel deleting this visit"
        onClick={onCancel}
      />
      <div
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-visit-title"
        aria-describedby="delete-visit-description"
      >
        <span className="delete-dialog-icon" aria-hidden="true">
          <Trash2 />
        </span>
        <h2 id="delete-visit-title">Delete this visit?</h2>
        <p id="delete-visit-description">
          The record from {visit.visitedAt} will be permanently removed.
        </p>
        <div className="form-actions">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
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

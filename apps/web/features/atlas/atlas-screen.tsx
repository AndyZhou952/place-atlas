'use client';

import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import {
  Bot,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Coffee,
  Database,
  ExternalLink,
  Heart,
  ImagePlus,
  ListFilter,
  MapPin,
  NotebookPen,
  Pencil,
  Plus,
  Search,
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
  VisitMediaRecord,
} from './model';
import { maxMediaFilesPerSelection } from './media-constraints';
import { restaurantLinks } from './restaurant-links';
import { AtlasMap } from './atlas-map';
import {
  filterJournalVisits,
  sortJournalVisits,
  type JournalSort,
} from './journal-filter';
import { normalizeRating, parseOptionalRating } from './rating';
import { searchCatalogRestaurantsByName } from '@/product/application/decision/search-policy';
import { useAtlasViewModel } from './use-atlas-view-model';
import { CatalogTable } from './catalog-table';
import { OwnerWorkspace, type OwnerWorkspaceTool } from './owner-workspace';
import { OwnerAccessButton, OwnerAccessPanel } from './owner-access';
import { useOwnerSession } from './use-owner-session';

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
  { value: 'table', label: 'Table' },
  { value: 'journal', label: 'Journal' },
];

export function AtlasScreen() {
  const owner = useOwnerSession();
  const canEdit = owner.state.authenticated === true;
  const vm = useAtlasViewModel(canEdit);
  const [activeTool, setActiveTool] = useState<OwnerWorkspaceTool>();
  function openSavedPlace(id: string) {
    vm.setView('map');
    vm.selectItem(id);
    setActiveTool(undefined);
  }

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

        <div className="header-actions">
          <OwnerAccessButton owner={owner} />
          {canEdit ? (
            <>
              <Button
                variant="outline"
                aria-label="Add a place"
                aria-haspopup="dialog"
                aria-controls="owner-workspace"
                onClick={() => setActiveTool('add')}
              >
                <Plus data-icon="inline-start" />
                <span className="header-action-label">Add place</span>
              </Button>
              <Button
                className="ask-button"
                aria-label="Ask for a saved restaurant recommendation"
                aria-haspopup="dialog"
                aria-controls="owner-workspace"
                onClick={() => setActiveTool('recommend')}
              >
                <Sparkles data-icon="inline-start" />
                <span className="header-action-label">Ask Recommend</span>
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <OwnerAccessPanel owner={owner} />
      {canEdit ? (
        <OwnerWorkspace
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onClose={() => setActiveTool(undefined)}
          onCommitted={vm.reloadCatalogViews}
          onSelect={openSavedPlace}
        />
      ) : null}

      <section className="system-strip" aria-label="System status">
        <span>
          <Database aria-hidden="true" /> Durable Atlas database
        </span>
        <span>
          <Bot aria-hidden="true" /> Agent API + browser tools ready
        </span>
      </section>

      {vm.notice ? <p className="notice-bar">{vm.notice}</p> : null}

      {vm.catalogLoading ? (
        <output className="notice-bar" aria-live="polite">
          {vm.catalogLoaded
            ? 'Refreshing Atlas records…'
            : 'Loading saved Atlas records…'}
        </output>
      ) : null}
      {vm.catalogError ? (
        <div className="notice-bar" role="alert">
          <span>{vm.catalogError}</span>{' '}
          <Button size="sm" variant="outline" onClick={vm.reloadCatalogViews}>
            Retry
          </Button>
        </div>
      ) : null}

      {vm.catalogLoaded ? (
        <>
          {vm.view === 'map' ? (
            <MapWorkspace vm={vm} canEdit={canEdit} />
          ) : null}
          {vm.view === 'journal' ? (
            <JournalWorkspace vm={vm} canEdit={canEdit} />
          ) : null}
          {vm.view === 'table' ? (
            <CatalogTable
              items={vm.items.filter(
                (item) => canEdit || item.verificationStatus === 'verified',
              )}
              visits={vm.visits}
              media={vm.media}
              onSelect={openSavedPlace}
              googleRatings={vm.googleRatings}
            />
          ) : null}
        </>
      ) : null}
      <footer className="site-footer">
        <span>Japan Atlas · personal field guide</span>
        <nav aria-label="Legal">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </main>
  );
}

type AtlasViewModel = ReturnType<typeof useAtlasViewModel>;
type LayoutVariant = 'floating' | 'split' | 'bottom';

function MapWorkspace({
  vm,
  canEdit,
}: {
  readonly vm: AtlasViewModel;
  readonly canEdit: boolean;
}) {
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
          inert={!listOpen}
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

          <div className="summary-row">
            <Summary label="Saved" value={vm.summary.saved} />
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
          </div>

          <div className="search-field">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={vm.query}
              onChange={(event) => vm.setQuery(event.target.value)}
              placeholder="Search place name"
              aria-label="Search Atlas items"
              tabIndex={listOpen ? 0 : -1}
            />
          </div>

          <div className="place-list" aria-live="polite">
            {vm.visibleItems.length ? (
              vm.visibleItems.map((item) => (
                <PlaceRow
                  key={item.id}
                  item={item}
                  selected={vm.selectedItem?.id === item.id}
                  canEdit={canEdit}
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
          <PlaceDetail key={vm.selectedItem.id} vm={vm} canEdit={canEdit} />
        ) : (
          <div className="detail-card detail-card-empty">
            <CircleHelp aria-hidden="true" />
            <strong>No places match the current filters.</strong>
            <span>Open the list to adjust search or filters.</span>
          </div>
        )}
      </section>

      {canEdit ? (
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
      ) : null}
    </section>
  );
}

function PlaceRow({
  item,
  selected,
  canEdit,
  distance,
  onSelect,
  onToggleFavorite,
  onToggleVisited,
  onDelete,
  busy,
}: {
  readonly item: AtlasItem;
  readonly selected: boolean;
  readonly canEdit: boolean;
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
            {item.tags.length ? `${item.tags.slice(0, 3).join(' · ')} · ` : ''}
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
        {canEdit ? (
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
        ) : null}
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
  canEdit,
}: {
  readonly item: AtlasItem;
  readonly vm: AtlasViewModel;
  readonly canEdit: boolean;
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

  if (editing && canEdit) {
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

  if (!canEdit)
    return (
      <span className="rating-strip-item personal-rating-inline">
        <span>マイスコア</span>
        <strong>{item.personalRating ?? '未評価'}</strong>
      </span>
    );

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

type OverallCommentStatus = 'idle' | 'saving' | 'error' | 'success';

function OverallCommentEditor({
  item,
  vm,
  canEdit,
}: {
  readonly item: AtlasItem;
  readonly vm: AtlasViewModel;
  readonly canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.overallComment ?? '');
  const [status, setStatus] = useState<OverallCommentStatus>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === 'saving' || vm.isItemPending(item.id);
  const feedbackId = `overall-comment-feedback-${item.id}`;

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function beginEditing() {
    setDraft(item.overallComment ?? '');
    setStatus('idle');
    setEditing(true);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draft.trim() || null;
    setStatus('saving');
    try {
      await vm.saveAssessment(item.id, { summary: normalized });
      setStatus('success');
      setEditing(false);
    } catch {
      setStatus('error');
    }
  }

  function cancel() {
    setDraft(item.overallComment ?? '');
    setStatus('idle');
    setEditing(false);
  }

  return (
    <section
      className="overall-comment"
      aria-labelledby={`overall-comment-title-${item.id}`}
    >
      <header>
        <div>
          <p className="eyebrow">Personal note</p>
          <h3 id={`overall-comment-title-${item.id}`}>Overall comment</h3>
        </div>
        {canEdit && !editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={beginEditing}
            disabled={busy}
          >
            <NotebookPen data-icon="inline-start" />
            {item.overallComment
              ? 'Edit overall comment'
              : 'Add overall comment'}
          </Button>
        ) : null}
      </header>

      {editing && canEdit ? (
        <form
          className="overall-comment-editor"
          aria-busy={status === 'saving'}
          onSubmit={submit}
        >
          <label htmlFor={`overall-comment-input-${item.id}`}>
            Your overall impression
          </label>
          <textarea
            ref={textareaRef}
            id={`overall-comment-input-${item.id}`}
            value={draft}
            rows={5}
            disabled={busy}
            aria-invalid={status === 'error'}
            aria-describedby={
              status === 'error' || status === 'success'
                ? feedbackId
                : undefined
            }
            placeholder="What stood out, and would you return?"
            onChange={(event) => setDraft(event.target.value)}
          />
          {status === 'error' ? (
            <p id={feedbackId} className="overall-comment-error" role="alert">
              Comment could not be saved. Log in as Owner and try again.
            </p>
          ) : null}
          <div className="overall-comment-actions">
            <Button type="submit" size="sm" disabled={busy}>
              {status === 'saving' ? 'Saving…' : 'Save comment'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="overall-comment-copy">
          {item.overallComment ?? 'No overall comment yet.'}
        </p>
      )}

      {status === 'success' ? (
        <output
          id={feedbackId}
          className="overall-comment-success"
          aria-live="polite"
        >
          Comment saved.
        </output>
      ) : null}
    </section>
  );
}

function PlaceDetail({
  vm,
  canEdit,
}: {
  readonly vm: AtlasViewModel;
  readonly canEdit: boolean;
}) {
  const item = vm.selectedItem!;
  const storedGoogleRating = item.googleRating;
  const loadGoogleRating = vm.googleRatings.load;
  useEffect(() => {
    if (canEdit) void loadGoogleRating(item);
  }, [canEdit, item, loadGoogleRating]);
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
  const [pendingVisitDelete, setPendingVisitDelete] = useState<VisitRecord>();

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
              {kindLabel[item.kind]} · {item.area}
              {item.kind !== 'food' && item.tags.length
                ? ` · ${item.tags.slice(0, 3).join(' · ')}`
                : ''}
            </p>
            <CardTitle>{item.title}</CardTitle>
            {item.alternateTitle ? (
              <p className="detail-local">{item.alternateTitle}</p>
            ) : null}
          </div>
          {canEdit ? (
            <div className="detail-actions">
              <Button
                variant={item.isFavorite ? 'default' : 'outline'}
                size="icon-sm"
                aria-label={
                  item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'
                }
                title={
                  item.isFavorite ? 'お気に入りを解除' : 'お気に入りに追加'
                }
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
                <Pencil data-icon="inline-start" /> Edit place
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {editing && canEdit ? (
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
              <PersonalRatingInline item={item} vm={vm} canEdit={canEdit} />
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
              {storedGoogleRating ? (
                <a
                  className="rating-strip-item"
                  href={storedGoogleRating!.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span translate="no">Google Maps</span>
                  <strong>{storedGoogleRating!.score.toFixed(1)}</strong>
                </a>
              ) : null}
              <span className="rating-visit-count">
                {itemVisits.length} visits
                {itemVisits[0] ? ` · Last ${itemVisits[0].visitedAt}` : ''}
              </span>
            </div>

            <OverallCommentEditor
              key={item.id}
              item={item}
              vm={vm}
              canEdit={canEdit}
            />

            {canEdit ? (
              <details className="detail-visit-recorder">
                <summary>
                  <NotebookPen aria-hidden="true" /> Add a visit
                </summary>
                <VisitComposer
                  key={item.id}
                  vm={vm}
                  itemId={item.id}
                  idPrefix={`detail-${item.id}`}
                  compact
                />
              </details>
            ) : null}

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
              {item.kind === 'food' ? (
                <div className="fact-card schedule-card">
                  <span>営業時間</span>
                  <strong>{item.openingHours?.value ?? 'Unavailable'}</strong>
                  {item.openingHours ? (
                    <small>
                      {new URL(item.openingHours.sourceUrl).hostname} ·{' '}
                      {item.openingHours.observedAt.slice(0, 10)}
                    </small>
                  ) : null}
                </div>
              ) : null}
              {item.kind === 'food' ? (
                <div className="fact-card schedule-card">
                  <span>定休日</span>
                  <strong>
                    {item.regularClosingDays?.value ?? 'Unavailable'}
                  </strong>
                  {item.closingNotes ? (
                    <small>{item.closingNotes.value}</small>
                  ) : null}
                  {item.regularClosingDays ? (
                    <small>
                      {new URL(item.regularClosingDays.sourceUrl).hostname} ·{' '}
                      {item.regularClosingDays.observedAt.slice(0, 10)}
                    </small>
                  ) : null}
                </div>
              ) : null}
            </div>

            {item.reservation.releaseNote ? (
              <p className="reservation-note">
                <Clock3 aria-hidden="true" /> {item.reservation.releaseNote}
              </p>
            ) : null}

            <section className="detail-visit-history">
              <h3>訪問記録</h3>
              {itemVisits.length ? (
                <ol>
                  {itemVisits.map((visit, index) => (
                    <JournalVisitRow
                      key={visit.id}
                      item={item}
                      items={vm.items}
                      visit={visit}
                      visitNumber={itemVisits.length - index}
                      busy={vm.journalBusy}
                      media={vm.media.filter(
                        (entry) => entry.visitId === visit.id,
                      )}
                      mediaBusy={vm.isMediaVisitPending(visit.id)}
                      canEdit={canEdit}
                      onSave={vm.editVisit}
                      onUpload={vm.addVisitMedia}
                      onSaveCaption={vm.saveMediaCaption}
                      onDeleteMedia={vm.removeMedia}
                      onDelete={() => setPendingVisitDelete(visit)}
                    />
                  ))}
                </ol>
              ) : (
                <p className="detail-visit-empty">
                  {canEdit
                    ? 'No visits yet. Add the first one above.'
                    : 'No visits recorded yet.'}
                </p>
              )}
            </section>

            <div className="source-links">
              {restaurantLinks(item).map((source) => (
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
            {canEdit ? (
              <DeleteVisitDialog
                visit={pendingVisitDelete}
                busy={vm.journalBusy}
                onCancel={() => setPendingVisitDelete(undefined)}
                onConfirm={async () => {
                  if (!pendingVisitDelete) return;
                  const visit = pendingVisitDelete;
                  setPendingVisitDelete(undefined);
                  try {
                    await vm.removeVisit(visit.id);
                  } catch {
                    setPendingVisitDelete(visit);
                  }
                }}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function JournalWorkspace({
  vm,
  canEdit,
}: {
  readonly vm: AtlasViewModel;
  readonly canEdit: boolean;
}) {
  const [placeFilter, setPlaceFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<JournalSort>('visited-desc');
  const [pendingDelete, setPendingDelete] = useState<VisitRecord>();

  const filteredVisits = filterJournalVisits(vm.visits, {
    placeId: placeFilter,
    fromDate,
    toDate,
  });
  const itemsById = new Map(vm.items.map((item) => [item.id, item]));
  const records = sortJournalVisits(filteredVisits, sort).flatMap((visit) => {
    const item = itemsById.get(visit.itemId);
    return item ? [{ item, visit }] : [];
  });
  const visitNumbers = new Map<string, number>();
  const visitCounts = new Map<string, number>();
  for (const visit of sortJournalVisits(vm.visits, 'visited-asc')) {
    const number = (visitCounts.get(visit.itemId) ?? 0) + 1;
    visitCounts.set(visit.itemId, number);
    visitNumbers.set(visit.id, number);
  }
  const placesWithVisits = vm.items.filter((item) =>
    vm.visits.some((visit) => visit.itemId === item.id),
  );

  return (
    <section className="single-workspace" id="journal">
      <div className="workspace-intro">
        <p className="eyebrow">Personal journal</p>
        <h2>Your journal</h2>
        <p>
          {canEdit
            ? 'Record a visit with just a date, or include photos, an optional note and your overall place rating. Add more photos later.'
            : 'Browse visit notes, photos and videos. Log in as Owner to add or edit a visit.'}
        </p>
      </div>
      <div className={cn('journal-grid', !canEdit && 'is-read-only')}>
        {canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>Add a visit</CardTitle>
            </CardHeader>
            <CardContent>
              <VisitComposer vm={vm} idPrefix="journal" />
            </CardContent>
          </Card>
        ) : null}
        <div className="journal-browser">
          <div className="journal-filters" aria-label="Journal filters">
            <label htmlFor="journal-sort">
              Sort by
              <select
                id="journal-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as JournalSort)}
              >
                <option value="visited-desc">Visit date · newest first</option>
                <option value="visited-asc">Visit date · oldest first</option>
                <option value="recorded-desc">Added · newest first</option>
                <option value="recorded-asc">Added · oldest first</option>
              </select>
            </label>
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
              records.map(({ item, visit }) => (
                <article key={visit.id} className="journal-place-record">
                  <header>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        Visit {visitNumbers.get(visit.id)} of{' '}
                        {visitCounts.get(item.id)}
                      </span>
                    </div>
                    <span className="personal-score is-persistent">
                      {item.personalRating === undefined
                        ? '—'
                        : item.personalRating.toString()}
                    </span>
                  </header>
                  <ol>
                    <JournalVisitRow
                      item={item}
                      items={vm.items}
                      visit={visit}
                      visitNumber={visitNumbers.get(visit.id) ?? 1}
                      busy={vm.journalBusy}
                      media={vm.media.filter(
                        (entry) => entry.visitId === visit.id,
                      )}
                      mediaBusy={vm.isMediaVisitPending(visit.id)}
                      canEdit={canEdit}
                      onSave={vm.editVisit}
                      onUpload={vm.addVisitMedia}
                      onSaveCaption={vm.saveMediaCaption}
                      onDeleteMedia={vm.removeMedia}
                      onDelete={() => setPendingDelete(visit)}
                    />
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
      {canEdit ? (
        <DeleteVisitDialog
          visit={pendingDelete}
          busy={vm.journalBusy}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={async () => {
            if (!pendingDelete) return;
            const visit = pendingDelete;
            setPendingDelete(undefined);
            try {
              await vm.removeVisit(visit.id);
            } catch {
              setPendingDelete(visit);
              // The view model restores the record and presents the error.
            }
          }}
        />
      ) : null}
    </section>
  );
}

// The input handles keyboard navigation for this ARIA combobox; native select
// and datalist cannot provide both full-list browsing and unambiguous filtering.
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/click-events-have-key-events */
function PlaceNamePicker({
  id,
  label,
  items,
  value,
  initialName = '',
  disabled = false,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly items: readonly AtlasItem[];
  readonly value: string;
  readonly initialName?: string;
  readonly disabled?: boolean;
  readonly onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState(initialName);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = searchCatalogRestaurantsByName(
    items,
    value && !filtering ? '' : query,
  );
  const listId = `${id}-options`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, id, open]);

  function choose(item: AtlasItem) {
    onChange(item.id);
    setQuery(item.title);
    setFiltering(false);
    setActiveIndex(-1);
    setOpen(false);
  }

  return (
    <div className="place-name-picker" ref={pickerRef}>
      <label htmlFor={`${id}-search`}>{label}</label>
      <div className="place-name-picker-control">
        <Input
          role="combobox"
          ref={inputRef}
          id={`${id}-search`}
          type="search"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 && matches[activeIndex]
              ? `${id}-option-${activeIndex}`
              : undefined
          }
          value={query}
          disabled={disabled}
          placeholder="Choose or type a name"
          autoComplete="off"
          onFocus={() => {
            setFiltering(!value && Boolean(query.trim()));
            setActiveIndex(-1);
            setOpen(true);
            if (value) inputRef.current?.select();
          }}
          onClick={() => {
            setOpen(true);
            if (value) inputRef.current?.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setFiltering(true);
            setActiveIndex(-1);
            setOpen(true);
            onChange('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key === 'Tab') {
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) =>
                event.key === 'ArrowDown'
                  ? Math.min(current + 1, matches.length - 1)
                  : current < 0
                    ? matches.length - 1
                    : Math.max(current - 1, 0),
              );
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault();
              const selected = matches[activeIndex];
              if (selected) choose(selected);
            }
          }}
        />
        <ChevronRight aria-hidden="true" />
      </div>
      {open && !disabled ? (
        <ul id={listId} className="place-name-picker-options" role="listbox">
          {matches.length ? (
            matches.map((item, index) => (
              <li
                role="option"
                key={item.id}
                id={`${id}-option-${index}`}
                data-place-id={item.id}
                aria-selected={value === item.id}
                className={cn(index === activeIndex && 'is-active')}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <span>{item.title}</span>
                {item.area ? <small>{item.area}</small> : null}
              </li>
            ))
          ) : (
            <li className="place-name-picker-empty">No matching restaurant</li>
          )}
        </ul>
      ) : null}
      {!value && query.trim() && !open ? (
        <small>Select a restaurant from the matching list.</small>
      ) : null}
    </div>
  );
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/click-events-have-key-events */
function VisitComposer({
  vm,
  itemId: fixedItemId,
  idPrefix,
  compact = false,
}: {
  readonly vm: AtlasViewModel;
  readonly itemId?: string;
  readonly idPrefix: string;
  readonly compact?: boolean;
}) {
  const [selectedItemId, setSelectedItemId] = useState(fixedItemId ?? '');
  const effectiveItemId = fixedItemId || selectedItemId;
  const selectedItem = vm.items.find((item) => item.id === effectiveItemId);
  const [visitedAt, setVisitedAt] = useState(localVisitDate());
  const [rating, setRating] = useState(
    selectedItem?.personalRating?.toString() ?? '',
  );
  const [note, setNote] = useState('');
  const [visitPhotos, setVisitPhotos] = useState<File[]>([]);
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const submitting = useRef(false);
  const [savedVisitId, setSavedVisitId] = useState<string>();
  const [retryUpload, setRetryUpload] = useState<{
    readonly files: readonly File[];
    readonly attemptId: string;
  }>();

  function readyForAnotherVisit() {
    setSavedVisitId(undefined);
    setStatus('idle');
    setFormError('');
    setRetryUpload(undefined);
    setVisitedAt(localVisitDate());
  }

  useEffect(() => {
    if (!savedVisitId || status !== 'success' || retryUpload || formError)
      return;
    const timer = window.setTimeout(() => {
      setSavedVisitId(undefined);
      setStatus('idle');
      setVisitedAt(localVisitDate());
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [savedVisitId, status, retryUpload, formError]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || savedVisitId || vm.journalBusy) return;
    let normalizedRating: number | undefined;
    try {
      normalizedRating = parseOptionalRating(rating);
      setFormError('');
    } catch {
      setFormError('Enter any number from 0 to 5. It will be saved to 0.1.');
      return;
    }

    submitting.current = true;
    setStatus('saving');
    try {
      const result = await vm.addVisit({
        itemId: effectiveItemId,
        visitedAt,
        ...(normalizedRating === undefined ? {} : { rating: normalizedRating }),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSavedVisitId(result.visit.id);
      const submittedPhotos = visitPhotos;
      setNote('');
      setVisitPhotos([]);
      if (submittedPhotos.length) {
        const attemptId = crypto.randomUUID();
        try {
          await vm.addVisitMedia(result.visit.id, submittedPhotos, attemptId);
        } catch {
          setRetryUpload({ files: submittedPhotos, attemptId });
          setFormError(
            'The visit was saved, but some media did not upload. Retry below; this will not create another visit.',
          );
          setStatus('success');
          return;
        }
      }
      setStatus('success');
    } catch {
      setStatus('idle');
      // The view model presents the request error in the notice bar.
    } finally {
      submitting.current = false;
    }
  }

  const feedbackId = `${idPrefix}-visit-feedback`;
  const busy = status === 'saving' || vm.journalBusy || Boolean(savedVisitId);

  async function retrySavedUpload() {
    if (!savedVisitId || !retryUpload || status === 'saving') return;
    setStatus('saving');
    setFormError('');
    try {
      await vm.addVisitMedia(
        savedVisitId,
        retryUpload.files,
        retryUpload.attemptId,
      );
      setRetryUpload(undefined);
      setStatus('success');
    } catch {
      setFormError(
        'Upload still failed. The visit is saved; retry the media upload.',
      );
      setStatus('success');
    }
  }

  return (
    <form
      className={cn('stacked-form visit-composer', compact && 'is-compact')}
      onSubmit={submit}
      noValidate
      aria-describedby={
        formError || status === 'success' ? feedbackId : undefined
      }
    >
      {!fixedItemId ? (
        <PlaceNamePicker
          id={`${idPrefix}-visit-place`}
          label="Place"
          items={vm.items}
          value={effectiveItemId}
          disabled={busy}
          onChange={(nextItemId) => {
            const nextItem = vm.items.find((item) => item.id === nextItemId);
            setSelectedItemId(nextItemId);
            setRating(nextItem?.personalRating?.toString() ?? '');
          }}
        />
      ) : null}
      <div className="form-pair">
        <label htmlFor={`${idPrefix}-visited-at`}>
          Visited
          <Input
            id={`${idPrefix}-visited-at`}
            type="date"
            value={visitedAt}
            disabled={busy}
            onChange={(event) => {
              setVisitedAt(event.target.value);
              setStatus('idle');
            }}
            required
          />
        </label>
        <label htmlFor={`${idPrefix}-visit-rating`}>
          Overall マイスコア / 5
          <Input
            id={`${idPrefix}-visit-rating`}
            type="number"
            min="0"
            max="5"
            step="0.1"
            value={rating}
            placeholder="Optional"
            disabled={busy}
            onChange={(event) => {
              setRating(event.target.value);
              setStatus('idle');
            }}
          />
        </label>
      </div>
      <small>
        This updates your overall place rating, not a separate visit score.
        Rating and note are optional.
      </small>
      <label htmlFor={`${idPrefix}-visit-note`}>
        Note (optional)
        <textarea
          id={`${idPrefix}-visit-note`}
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.target.value);
            setStatus('idle');
          }}
          rows={compact ? 3 : 5}
          placeholder="What stood out? What would you order next time?"
        />
      </label>
      <label className="journal-media-picker">
        <span>Photos or videos (optional)</span>
        <span className="media-upload-control">
          <ImagePlus aria-hidden="true" />
          {visitPhotos.length
            ? `${visitPhotos.length} selected`
            : 'Choose photos or videos'}
          <input
            key={visitPhotos.length ? 'selected' : 'empty'}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            multiple
            disabled={busy}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > maxMediaFilesPerSelection) {
                setFormError(
                  `Choose up to ${maxMediaFilesPerSelection} photos per batch. You can add another batch afterward.`,
                );
                event.target.value = '';
                return;
              }
              setVisitPhotos(files);
              setFormError('');
              setStatus('idle');
            }}
          />
        </span>
        <small>
          Up to {maxMediaFilesPerSelection} per selection; add more from the
          saved visit.
        </small>
      </label>
      {formError ? (
        <small id={feedbackId} className="form-error" role="alert">
          {formError}
        </small>
      ) : null}
      {status === 'success' && !formError && typeof document !== 'undefined'
        ? createPortal(
            <output id={feedbackId} className="visit-saved-toast">
              Visit saved
            </output>,
            document.body,
          )
        : null}
      <Button type="submit" disabled={busy || !effectiveItemId || !visitedAt}>
        <NotebookPen data-icon="inline-start" />
        {status === 'saving'
          ? 'Saving…'
          : savedVisitId
            ? 'Visit saved'
            : 'Save visit'}
      </Button>
      {savedVisitId && retryUpload ? (
        <Button
          type="button"
          variant="outline"
          disabled={status === 'saving' || vm.journalBusy}
          onClick={() => void retrySavedUpload()}
        >
          {status === 'saving' ? 'Retrying upload…' : 'Retry media upload'}
        </Button>
      ) : null}
      {savedVisitId && retryUpload ? (
        <Button
          type="button"
          variant="outline"
          disabled={status === 'saving' || vm.journalBusy}
          onClick={readyForAnotherVisit}
        >
          Continue without remaining media
        </Button>
      ) : null}
    </form>
  );
}

function localVisitDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function JournalVisitRow({
  item,
  items,
  visit,
  visitNumber,
  busy,
  media,
  mediaBusy,
  canEdit,
  onSave,
  onUpload,
  onSaveCaption,
  onDeleteMedia,
  onDelete,
}: {
  readonly item: AtlasItem;
  readonly items: readonly AtlasItem[];
  readonly visit: VisitRecord;
  readonly visitNumber: number;
  readonly busy: boolean;
  readonly media: readonly VisitMediaRecord[];
  readonly mediaBusy: boolean;
  readonly canEdit: boolean;
  readonly onSave: AtlasViewModel['editVisit'];
  readonly onUpload: AtlasViewModel['addVisitMedia'];
  readonly onSaveCaption: AtlasViewModel['saveMediaCaption'];
  readonly onDeleteMedia: AtlasViewModel['removeMedia'];
  readonly onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [visitedAt, setVisitedAt] = useState(visit.visitedAt);
  const [itemId, setItemId] = useState(visit.itemId);
  const [note, setNote] = useState(visit.note ?? '');
  const [rating, setRating] = useState(
    item.personalRating === undefined ? '' : item.personalRating.toString(),
  );
  const [error, setError] = useState('');

  function beginEditing() {
    setItemId(visit.itemId);
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
        itemId,
        visitedAt,
        note: note.trim() || undefined,
        ...(itemId === visit.itemId
          ? { rating: normalizedRating ?? null }
          : {}),
      });
      setEditing(false);
    } catch {
      // The view model restores the previous record and presents the error.
    }
  }

  if (editing && canEdit) {
    return (
      <li className="journal-visit is-editing">
        <form className="journal-visit-form" onSubmit={submit} noValidate>
          <PlaceNamePicker
            id={`visit-place-${visit.id}`}
            label="Restaurant for this visit"
            items={items}
            value={itemId}
            initialName={item.title}
            disabled={busy}
            onChange={setItemId}
          />
          {itemId && itemId !== visit.itemId ? (
            <small>
              The note and media will move with this visit. Overall restaurant
              scores stay where they are.
            </small>
          ) : null}
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
              Overall マイスコア
              <Input
                id={`visit-rating-${visit.id}`}
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={rating}
                disabled={itemId !== visit.itemId || busy}
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
            <Button type="submit" disabled={busy || !visitedAt || !itemId}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setVisitedAt(visit.visitedAt);
                setItemId(visit.itemId);
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
        {visit.note ? <p className="visit-note">{visit.note}</p> : null}
        <VisitMediaEditor
          visitId={visit.id}
          media={media}
          busy={mediaBusy}
          canEdit={canEdit}
          onUpload={onUpload}
          onSaveCaption={onSaveCaption}
          onDelete={onDeleteMedia}
        />
      </div>
      {canEdit ? (
        <div className="journal-visit-actions">
          <button
            type="button"
            aria-label={`Edit visit ${visitNumber} and restaurant`}
            title="Edit visit or change restaurant"
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
      ) : null}
    </li>
  );
}

function VisitMediaEditor({
  visitId,
  media,
  busy,
  canEdit,
  onUpload,
  onSaveCaption,
  onDelete,
}: {
  readonly visitId: string;
  readonly media: readonly VisitMediaRecord[];
  readonly busy: boolean;
  readonly canEdit: boolean;
  readonly onUpload: AtlasViewModel['addVisitMedia'];
  readonly onSaveCaption: AtlasViewModel['saveMediaCaption'];
  readonly onDelete: AtlasViewModel['removeMedia'];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number>();
  const visibleMedia = media.slice(0, 4);

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    try {
      await onUpload(visitId, files);
    } catch {
      // The view model presents the error in the notice bar.
    }
  }

  return (
    <div className="visit-media-editor">
      <div className={cn('visit-media-gallery', canEdit && 'is-editable')}>
        {visibleMedia.map((entry, index) => (
          <MediaCaptionEditor
            key={`${entry.id}:${entry.caption ?? ''}`}
            media={entry}
            canEdit={canEdit}
            onSave={onSaveCaption}
            onDelete={onDelete}
            onOpen={() => setLightboxIndex(index)}
          />
        ))}
      </div>
      <MediaBrowseButton
        count={media.length}
        onOpen={() => setLightboxIndex(0)}
      />
      {canEdit ? (
        <label className={cn('media-upload-control', busy && 'is-busy')}>
          <ImagePlus aria-hidden="true" />
          {busy ? 'Uploading…' : 'Add photos or videos'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            multiple
            disabled={busy}
            onChange={(event) => void selectFiles(event)}
          />
        </label>
      ) : null}
      {lightboxIndex !== undefined ? (
        <PhotoLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(undefined)}
          onSaveCaption={canEdit ? onSaveCaption : undefined}
          onDelete={
            canEdit
              ? async (id) => {
                  if (media.length === 1) setLightboxIndex(undefined);
                  return onDelete(id);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function MediaBrowseButton({
  count,
  onOpen,
}: {
  readonly count: number;
  readonly onOpen: () => void;
}) {
  if (count <= 4) return null;
  return (
    <button className="media-browse-button" type="button" onClick={onOpen}>
      View all {count} photos
    </button>
  );
}

function MediaCaptionEditor({
  media,
  canEdit,
  onSave,
  onDelete,
  onOpen,
}: {
  readonly media: VisitMediaRecord;
  readonly canEdit: boolean;
  readonly onSave: AtlasViewModel['saveMediaCaption'];
  readonly onDelete: AtlasViewModel['removeMedia'];
  readonly onOpen: () => void;
}) {
  const [caption, setCaption] = useState(media.caption ?? '');

  async function saveCaption() {
    if (caption.trim() === (media.caption ?? '')) return;
    try {
      await onSave(media.id, caption);
    } catch {
      setCaption(media.caption ?? '');
    }
  }

  return (
    <figure>
      <div className="media-thumbnail-frame">
        <button
          className="media-thumbnail-button"
          type="button"
          aria-label={`Open ${media.caption || media.originalFilename}`}
          onClick={onOpen}
        >
          {media.contentType.startsWith('video/') ? (
            <span className="media-video-tile">▶ Video</span>
          ) : (
            <Image
              src={media.contentUrl}
              alt={media.caption || media.originalFilename}
              width={640}
              height={480}
              sizes="(max-width: 600px) 50vw, 180px"
              unoptimized
              loading="lazy"
            />
          )}
        </button>
        {canEdit ? (
          <button
            className="media-thumbnail-delete"
            type="button"
            aria-label={`Delete ${media.originalFilename}`}
            title="Delete media"
            onClick={() => {
              const kind = media.contentType.startsWith('video/')
                ? 'video'
                : 'photo';
              if (window.confirm(`Delete this ${kind}?`))
                void onDelete(media.id);
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="media-caption-row">
          <Input
            value={caption}
            maxLength={160}
            aria-label={`Caption for ${media.originalFilename}`}
            placeholder="What is this?"
            onChange={(event) => setCaption(event.target.value)}
            onBlur={() => void saveCaption()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      ) : media.caption ? (
        <figcaption>{media.caption}</figcaption>
      ) : null}
    </figure>
  );
}

function PhotoLightbox({
  media,
  initialIndex,
  onClose,
  onSaveCaption,
  onDelete,
}: {
  readonly media: readonly VisitMediaRecord[];
  readonly initialIndex: number;
  readonly onClose: () => void;
  readonly onSaveCaption?: AtlasViewModel['saveMediaCaption'];
  readonly onDelete?: AtlasViewModel['removeMedia'];
}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const swipeStartX = useRef<number | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);
  const safeIndex = Math.min(activeIndex, Math.max(media.length - 1, 0));
  const active = media[safeIndex];

  const move = useCallback(
    (direction: -1 | 1) => {
      setActiveIndex(
        (current) => (current + direction + media.length) % media.length,
      );
    },
    [media.length],
  );

  useEffect(() => {
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && media.length > 1) move(-1);
      if (event.key === 'ArrowRight' && media.length > 1) move(1);
    }
    window.addEventListener('keydown', keyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keyDown);
    };
  }, [media.length, move, onClose]);

  useEffect(() => {
    if (media.length < 2) return;
    const neighbors = [
      media[(safeIndex + 1) % media.length],
      media[(safeIndex - 1 + media.length) % media.length],
    ];
    for (const entry of neighbors) {
      if (!entry) continue;
      const preload = new window.Image();
      preload.src = entry.contentUrl;
    }
  }, [media, safeIndex]);

  if (!active) return null;

  function pointerDown(event: ReactPointerEvent) {
    swipeStartX.current = event.clientX;
  }

  function pointerUp(event: ReactPointerEvent) {
    const start = swipeStartX.current;
    swipeStartX.current = undefined;
    if (start === undefined || media.length < 2) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < 45) return;
    move(delta > 0 ? -1 : 1);
  }

  return createPortal(
    <div className="photo-lightbox" role="presentation">
      <button
        className="photo-lightbox-dismiss"
        type="button"
        aria-label="Close photo viewer"
        onClick={onClose}
      />
      <dialog
        open
        className="photo-lightbox-panel"
        aria-modal="true"
        aria-label="Visit photo viewer"
      >
        <header>
          <span aria-live="polite">
            {safeIndex + 1} / {media.length}
          </span>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close photo viewer"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div
          className="photo-lightbox-stage"
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
        >
          {active.contentType.startsWith('video/') ? (
            // User videos do not have a caption track at upload time.
            // oxlint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={active.id}
              src={active.contentUrl}
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <Image
              key={active.id}
              src={active.contentUrl}
              alt={active.caption || active.originalFilename}
              width={1600}
              height={1200}
              sizes="100vw"
              unoptimized
              priority
              draggable={false}
            />
          )}
          {media.length > 1 ? (
            <>
              <button
                className="photo-lightbox-previous"
                type="button"
                aria-label="Previous photo"
                onClick={() => move(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <button
                className="photo-lightbox-next"
                type="button"
                aria-label="Next photo"
                onClick={() => move(1)}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
        <footer>
          {onSaveCaption ? (
            <LightboxCaptionEditor
              key={`${active.id}:${active.caption ?? ''}`}
              media={active}
              onSave={onSaveCaption}
            />
          ) : active.caption ? (
            <p>{active.caption}</p>
          ) : (
            <span>No caption</span>
          )}
          {onDelete ? (
            <button
              className="photo-lightbox-delete"
              type="button"
              aria-label={`Delete ${active.originalFilename}`}
              onClick={() => {
                if (window.confirm('Delete this photo?')) {
                  void onDelete(active.id);
                }
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
        </footer>
      </dialog>
    </div>,
    document.body,
  );
}

function LightboxCaptionEditor({
  media,
  onSave,
}: {
  readonly media: VisitMediaRecord;
  readonly onSave: AtlasViewModel['saveMediaCaption'];
}) {
  const [caption, setCaption] = useState(media.caption ?? '');

  async function saveCaption() {
    if (caption.trim() === (media.caption ?? '')) return;
    try {
      await onSave(media.id, caption);
    } catch {
      setCaption(media.caption ?? '');
    }
  }

  return (
    <Input
      value={caption}
      maxLength={160}
      aria-label={`Caption for ${media.originalFilename}`}
      placeholder="What is this?"
      onChange={(event) => setCaption(event.target.value)}
      onBlur={() => void saveCaption()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
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
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="summary-item">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

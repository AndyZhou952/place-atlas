'use client';

import {
  Building2,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Coffee,
  LocateFixed,
  MapPin,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { AtlasItemKind, AtlasKindFilter } from './model';
import { useAtlasViewModel } from './use-atlas-view-model';

const filters: readonly {
  value: AtlasKindFilter;
  label: string;
  icon?: typeof Coffee;
}[] = [
  { value: 'all', label: 'All saved' },
  { value: 'food', label: 'Food', icon: Coffee },
  { value: 'event', label: 'Events', icon: CalendarDays },
  { value: 'architecture', label: 'Architecture', icon: Building2 },
];

const kindLabel: Record<AtlasItemKind, string> = {
  food: 'Food',
  event: 'Event',
  architecture: 'Architecture',
};

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
            <p className="eyebrow">Foundation preview · sample records</p>
            <h1>Japan Atlas</h1>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <a href="#map" aria-current="page">
            Map
          </a>
          <a href="#inbox">Inbox</a>
          <a href="#journal">Journal</a>
        </nav>

        <Button className="ask-button" aria-label="Ask the assistant">
          <Sparkles data-icon="inline-start" />
          Ask nearby
        </Button>
      </header>

      <section className="command-strip" aria-label="Quick capture and search">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={vm.query}
            onChange={(event) => vm.setQuery(event.target.value)}
            placeholder="Search a place, neighborhood, or tag"
            aria-label="Search saved items"
          />
        </div>
        <p>
          <Send aria-hidden="true" />
          Send a link, photo, voice note, or location in WeChat. It lands in
          your inbox first.
        </p>
      </section>

      <section className="atlas-workspace" id="map">
        <aside className="collection-panel" aria-label="Saved collection">
          <div className="summary-row">
            <Summary label="Saved" value={vm.summary.saved} />
            <Summary
              label="Review"
              value={vm.summary.needsReview}
              tone="review"
            />
            <Summary label="Time-sensitive" value={vm.summary.openingSoon} />
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
              <p className="eyebrow">Tokyo and nearby</p>
              <h2>{vm.visibleItems.length} places in view</h2>
            </div>
            <Button variant="ghost" size="sm">
              <LocateFixed data-icon="inline-start" /> Near me
            </Button>
          </div>

          <div className="place-list" aria-live="polite">
            {vm.visibleItems.length ? (
              vm.visibleItems.map((item) => {
                const selected = vm.selectedItem.id === item.id;

                return (
                  <button
                    type="button"
                    className={cn('place-row', selected && 'is-selected')}
                    key={item.id}
                    onClick={() => vm.selectItem(item.id)}
                    aria-pressed={selected}
                  >
                    <span
                      className={`kind-mark kind-${item.kind}`}
                      aria-hidden="true"
                    >
                      {item.kind === 'food'
                        ? '食'
                        : item.kind === 'event'
                          ? '日'
                          : '建'}
                    </span>
                    <span className="place-copy">
                      <span className="place-title-line">
                        <strong>{item.name}</strong>
                        <span>{kindLabel[item.kind]}</span>
                      </span>
                      <span className="place-local">{item.localName}</span>
                      <span className="place-meta">
                        {item.area} · {item.reservationLabel}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                );
              })
            ) : (
              <div className="empty-state">
                <CircleHelp aria-hidden="true" />
                <strong>No saved item matches.</strong>
                <span>Try another neighborhood or clear a type filter.</span>
              </div>
            )}
          </div>
        </aside>

        <section className="map-panel" aria-label="Map and selected place">
          <iframe
            key={vm.selectedItem.id}
            title={`Map centered on ${vm.selectedItem.name}`}
            src={vm.mapUrl}
            className="map-frame"
            loading="eager"
          />

          <Card className="detail-card">
            <CardHeader>
              <p className="eyebrow">
                {kindLabel[vm.selectedItem.kind]} · {vm.selectedItem.area}
              </p>
              <CardTitle>{vm.selectedItem.name}</CardTitle>
              <p className="detail-local">{vm.selectedItem.localName}</p>
              <CardAction>
                {vm.selectedItem.personalRating ? (
                  <span
                    className="rating-seal"
                    aria-label={`${vm.selectedItem.personalRating} out of 5`}
                  >
                    {vm.selectedItem.personalRating}
                  </span>
                ) : (
                  <span className="status-pill">
                    {vm.selectedItem.personalState}
                  </span>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="detail-summary">{vm.selectedItem.summary}</p>
              <div className="evidence-line">
                <MapPin aria-hidden="true" />
                <span>
                  {vm.selectedItem.sourceCount} sources ·{' '}
                  {vm.selectedItem.sourceLabel}
                </span>
              </div>
              <div className="detail-footer">
                <span>{vm.selectedItem.freshnessLabel}</span>
                <Button size="sm" variant="outline">
                  Open details <ChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </section>
    </main>
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

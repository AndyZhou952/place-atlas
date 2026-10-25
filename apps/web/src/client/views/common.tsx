import { useEffect, useRef, useState } from 'react';
import { presentOpeningHours } from '../../shared/hours.ts';
import type { Restaurant } from '../../shared/types.ts';
import { searchRestaurants } from '../viewmodels/selectors.ts';

export function OpeningHours({ value }: { readonly value?: string }) {
  const { lines, notes } = value ? presentOpeningHours(value) : { lines: [], notes: [] };
  return (
    <div className="hours">
      {lines.length ? (
        <ul>
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : (
        <span className="muted">Unavailable</span>
      )}
      {notes.length ? (
        <details>
          <summary>注意事項</summary>
          {notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </details>
      ) : null}
    </div>
  );
}

/** Searchable restaurant chooser: an ARIA combobox, since <select> cannot filter as you type. */
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role */
export function RestaurantPicker({
  id,
  label,
  restaurants,
  value,
  onChange,
  disabled,
}: {
  readonly id: string;
  readonly label: string;
  readonly restaurants: readonly Restaurant[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean;
}) {
  const selected = restaurants.find((r) => r.id === value);
  const [query, setQuery] = useState(selected?.title ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const matches = searchRestaurants(
    restaurants,
    selected && query === selected.title ? '' : query,
  ).slice(0, 50);

  useEffect(() => {
    const close = (event: PointerEvent) =>
      !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (restaurant: Restaurant) => {
    onChange(restaurant.id);
    setQuery(restaurant.title);
    setOpen(false);
  };

  return (
    <div className="picker" ref={root}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        placeholder="Choose or type a name"
        value={query}
        disabled={disabled}
        onFocus={(event) => (setOpen(true), event.currentTarget.select())}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
          onChange('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => Math.max(0, Math.min(matches.length - 1, current + step)));
          } else if (event.key === 'Enter' && open && matches[active]) {
            event.preventDefault();
            choose(matches[active]);
          } else if (event.key === 'Escape' || event.key === 'Tab') setOpen(false);
        }}
      />
      {open && !disabled ? (
        <ul id={`${id}-list`} role="listbox" className="picker-list">
          {matches.length ? (
            matches.map((restaurant, index) => (
              <li
                key={restaurant.id}
                id={`${id}-${index}`}
                role="option"
                aria-selected={restaurant.id === value}
                className={index === active ? 'is-active' : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(restaurant)}
                onKeyDown={() => undefined}
              >
                {restaurant.title} <small>{restaurant.area}</small>
              </li>
            ))
          ) : (
            <li className="muted">No matching restaurant</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role */

export function ConfirmDialog({
  title,
  body,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog
      ref={dialog}
      className="confirm"
      role="alertdialog"
      aria-label={title}
      onClose={onCancel}
    >
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="actions">
        <button type="button" className="button outline" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </dialog>
  );
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

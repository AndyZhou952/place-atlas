'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AtlasItem } from './model';
import { useGoogleRatingReferences } from './use-google-rating-references';
import { ratingPlaceId } from '../../agent/google-rating-policy';
import {
  googleRatingIdentity,
  parseGoogleRating,
  withDisplayedGoogleRatings,
  type GoogleRatingDisplay,
} from './google-rating-display';

const emptyDisplays: Readonly<Record<string, GoogleRatingDisplay>> = {};

export function useGoogleRatingDisplay(
  items: readonly AtlasItem[],
  canEdit: boolean,
) {
  const references = useGoogleRatingReferences(canEdit, items);
  const [displays, setDisplays] = useState<Record<string, GoogleRatingDisplay>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(new Map<string, Promise<void>>());
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setDisplays({});
        setBusy(false);
      }
    });
    inFlight.current.clear();
    return () => controller.abort();
  }, [canEdit]);
  const load = useCallback(
    async (item: AtlasItem, retry = false) => {
      if (
        !canEdit ||
        item.verificationStatus !== 'verified' ||
        !ratingPlaceId(item)
      )
        return;
      if (
        !retry &&
        (!references.referencesReady ||
          references.references[item.id]?.placeId === ratingPlaceId(item))
      )
        return;
      const identity = googleRatingIdentity(item);
      const pending = inFlight.current.get(identity);
      if (pending) return pending;
      if (
        displays[item.id]?.identity === identity &&
        ((!retry && displays[item.id]?.status === 'loaded') ||
          (!retry && displays[item.id]?.status === 'unavailable'))
      )
        return;
      const signal = lifetime.current.signal;
      const request = (async () => {
        setDisplays((current) => ({
          ...current,
          [item.id]: {
            identity,
            status: 'loading',
            rating:
              current[item.id]?.identity === identity
                ? current[item.id]?.rating
                : undefined,
          },
        }));
        const rating = await (async () => {
          try {
            const response = await fetch(
              `/api/items/${encodeURIComponent(item.id)}/google-rating`,
              { signal, cache: 'no-store' },
            );
            if (response.status === 200) {
              const value = await response.json();
              const checkedAt =
                value &&
                typeof value === 'object' &&
                'checkedAt' in value &&
                typeof value.checkedAt === 'string'
                  ? value.checkedAt
                  : undefined;
              return checkedAt && Number.isFinite(Date.parse(checkedAt))
                ? parseGoogleRating(value, checkedAt)
                : undefined;
            }
          } catch {
            /* A failed source read must not replace a known score. */
          }
          return undefined;
        })();
        if (!signal.aborted)
          setDisplays((current) => ({
            ...current,
            [item.id]: {
              identity,
              status: rating ? 'loaded' : 'unavailable',
              rating:
                rating ??
                (current[item.id]?.identity === identity
                  ? current[item.id]?.rating
                  : undefined),
            },
          }));
      })();
      inFlight.current.set(identity, request);
      await request;
      if (inFlight.current.get(identity) === request)
        inFlight.current.delete(identity);
    },
    [canEdit, displays, references.referencesReady, references.references],
  );
  const loadMany = async (ids: readonly string[]) => {
    if (!canEdit || busy) return;
    const targets = items.filter((item) => ids.includes(item.id));
    const signal = lifetime.current.signal;
    setBusy(true);
    try {
      for (
        let offset = 0;
        offset < targets.length && !signal.aborted;
        offset += 3
      ) {
        await Promise.all(
          targets.slice(offset, offset + 3).map((item) => load(item, true)),
        );
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const activeDisplays = canEdit ? displays : emptyDisplays;
  return {
    ...references,
    canQuery: canEdit,
    items: useMemo(
      () =>
        withDisplayedGoogleRatings(
          items,
          activeDisplays,
          references.references,
        ),
      [items, activeDisplays, references.references],
    ),
    displays: activeDisplays,
    busy: canEdit && busy,
    load,
    loadMany,
  };
}

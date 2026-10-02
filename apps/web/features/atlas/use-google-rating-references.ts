'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AtlasItem } from './model';
import type { GoogleRatingReference } from '../../product/application/catalog/google-rating-reference-operations';
import { ratingPlaceId } from '../../agent/google-rating-policy';
import {
  googleRatingIdentity,
  type GoogleRatingDisplay,
} from './google-rating-display';
import { publishOwnerLoginRequired } from './owner-session-client';

export function useGoogleRatingReferences(
  canEdit: boolean,
  items: readonly AtlasItem[],
) {
  const catalogIds = items
    .map((item) => item.id)
    .sort()
    .join('\n');
  const [references, setReferences] = useState<
    Record<string, GoogleRatingReference>
  >({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const lifetime = useRef(new AbortController());
  const pending = useRef(
    new Map<string, { body: string; mutationId: string }>(),
  );
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    pending.current.clear();
    inFlight.current.clear();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setReferences({});
        setSaving({});
        setError('');
        setReady(!canEdit);
      }
    });
    if (canEdit)
      void (async () => {
        try {
          const response = await fetch('/api/google-rating-references', {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (response.status === 401) publishOwnerLoginRequired();
          if (!response.ok) throw new Error();
          const rows: GoogleRatingReference[] = await response.json();
          if (!controller.signal.aborted)
            setReferences((current) => ({
              ...Object.fromEntries(rows.map((row) => [row.itemId, row])),
              ...current,
            }));
        } catch {
          if (!controller.signal.aborted)
            setError(
              'Saved Google references could not be loaded. Refresh to retry.',
            );
        }
      })().finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, [canEdit, catalogIds]);

  const saveReference = useCallback(
    async (item: AtlasItem, display?: GoogleRatingDisplay) => {
      const placeId = ratingPlaceId(item);
      if (
        !canEdit ||
        inFlight.current.has(item.id) ||
        !placeId ||
        !display?.rating ||
        display.status !== 'loaded' ||
        display.identity !== googleRatingIdentity(item)
      )
        return;
      const signal = lifetime.current.signal;
      const { score, reviewCount, url, checkedAt } = display.rating;
      const body = JSON.stringify({
        placeId,
        score,
        reviewCount,
        url,
        observedAt: checkedAt,
      });
      const earlier = pending.current.get(item.id);
      const request =
        earlier?.body === body
          ? earlier
          : { body, mutationId: crypto.randomUUID() };
      pending.current.set(item.id, request);
      inFlight.current.add(item.id);
      setSaving((current) => ({ ...current, [item.id]: true }));
      setError('');
      try {
        const response = await fetch(
          `/api/items/${encodeURIComponent(item.id)}/google-rating-reference`,
          {
            method: 'POST',
            signal,
            headers: {
              'Content-Type': 'application/json',
              'x-atlas-mutation-id': request.mutationId,
            },
            body,
          },
        );
        if (response.status === 401) publishOwnerLoginRequired();
        if (!response.ok) throw new Error();
        const result: { result: GoogleRatingReference } = await response.json();
        if (!signal.aborted) {
          setReferences((current) => ({
            ...current,
            [item.id]: result.result,
          }));
          pending.current.delete(item.id);
        }
      } catch {
        if (!signal.aborted)
          setError(
            'The Google reference could not be saved. Retry the same save to recover it.',
          );
      } finally {
        if (!signal.aborted) {
          inFlight.current.delete(item.id);
          setSaving((current) => ({ ...current, [item.id]: false }));
        }
      }
    },
    [canEdit],
  );
  return {
    referencesReady: !canEdit || ready,
    references: canEdit ? references : {},
    saving: canEdit ? saving : {},
    error: canEdit ? error : '',
    saveReference,
  };
}

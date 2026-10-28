import { useCallback, useEffect, useState } from 'react';
import type {
  GoogleRating,
  Media,
  Restaurant,
  RestaurantPatch,
  Visit,
  VisitInput,
} from '../../shared/types.ts';
import { api } from '../api.ts';

export const MAX_FILES_PER_SELECTION = 24;

/** Saved restaurants, visits and media, with the Owner's mutations. */
export function useAtlas(owner: boolean) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [googleRatings, setGoogleRatings] = useState<Record<string, GoogleRating>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [nextRestaurants, nextVisits] = await Promise.all([api.restaurants(), api.visits()]);
      setRestaurants(nextRestaurants);
      setVisits(nextVisits);
      setStatus('ready');
    } catch (error) {
      setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      setNotice(error instanceof Error ? error.message : 'Could not load the atlas.');
    }
  }, []);

  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (!owner) return setGoogleRatings({});
    api.googleRatings().then(setGoogleRatings, () => undefined);
  }, [owner]);

  /** Runs an Owner action, tracking it as pending and reporting failures in the notice bar. */
  const run = useCallback(async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    setPending((current) => new Set(current).add(key));
    setNotice('');
    try {
      return await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The change could not be saved.');
      throw error;
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const replace = (updated: Restaurant) =>
    setRestaurants((current) => current.map((r) => (r.id === updated.id ? updated : r)));

  const updateRestaurant = (id: string, patch: RestaurantPatch) => {
    const previous = restaurants.find((r) => r.id === id);
    if (!previous) return Promise.reject(new Error('Restaurant not found.'));
    // Show the change immediately; the server response (or the previous value) replaces it.
    replace({
      ...previous,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.favorite === undefined ? {} : { favorite: patch.favorite }),
      ...(patch.visited === undefined ? {} : { visited: patch.visited }),
      ...(patch.rating === undefined ? {} : { rating: patch.rating ?? undefined }),
      ...(patch.comment === undefined ? {} : { comment: patch.comment ?? undefined }),
    });
    return run(id, () => api.updateRestaurant(id, patch)).then(replace, (error) => {
      replace(previous);
      throw error;
    });
  };

  const deleteRestaurant = (id: string) =>
    run(id, async () => {
      await api.deleteRestaurant(id);
      setRestaurants((current) => current.filter((r) => r.id !== id));
      setVisits((current) => current.filter((visit) => visit.restaurantId !== id));
    });

  /** Creates (id undefined) or updates a visit, then rereads the affected records. */
  const saveVisit = (id: string | undefined, input: VisitInput) =>
    run('journal', async () => {
      const visitId = id ?? crypto.randomUUID();
      if (id) await api.updateVisit(id, input);
      else await api.createVisit(visitId, input);
      await reload();
      return visitId;
    });

  const deleteVisit = (id: string) =>
    run('journal', async () => {
      await api.deleteVisit(id);
      await reload();
    });

  const setMedia = (visitId: string, update: (media: readonly Media[]) => readonly Media[]) =>
    setVisits((current) =>
      current.map((visit) =>
        visit.id === visitId ? { ...visit, media: update(visit.media) } : visit,
      ),
    );

  /**
   * Uploads in small requests (each video alone). The ids are stable, so retrying the same
   * selection after a failure does not duplicate already-stored files.
   */
  const uploadMedia = (
    visitId: string,
    files: readonly File[],
    ids: readonly string[] = files.map(() => crypto.randomUUID()),
  ) =>
    run(`media:${visitId}`, async () => {
      if (files.length > MAX_FILES_PER_SELECTION)
        throw new Error(`Choose up to ${MAX_FILES_PER_SELECTION} files at a time.`);
      const size = files.some((file) => file.type.startsWith('video/')) ? 1 : 4;
      for (let start = 0; start < files.length; start += size) {
        const added = await api.uploadMedia(
          visitId,
          files.slice(start, start + size),
          ids.slice(start, start + size),
        );
        setMedia(visitId, (media) => [
          ...media.filter((entry) => !added.some((a) => a.id === entry.id)),
          ...added,
        ]);
      }
    });

  const updateCaption = (visitId: string, mediaId: string, caption: string) =>
    run(mediaId, async () => {
      await api.updateCaption(mediaId, caption);
      setMedia(visitId, (media) =>
        media.map((entry) =>
          entry.id === mediaId ? { ...entry, caption: caption.trim() || undefined } : entry,
        ),
      );
    });

  const deleteMedia = (visitId: string, mediaId: string) =>
    run(mediaId, async () => {
      await api.deleteMedia(mediaId);
      setMedia(visitId, (media) => media.filter((entry) => entry.id !== mediaId));
    });

  const refreshGoogleRating = (id: string) =>
    run(`google:${id}`, async () => {
      const rating = await api.refreshGoogleRating(id);
      setGoogleRatings((current) => ({ ...current, [id]: rating }));
    });

  return {
    restaurants,
    visits,
    googleRatings,
    status,
    notice,
    setNotice,
    isPending: (key: string) => pending.has(key),
    reload,
    updateRestaurant,
    deleteRestaurant,
    saveVisit,
    deleteVisit,
    uploadMedia,
    updateCaption,
    deleteMedia,
    refreshGoogleRating,
  };
}

export type AtlasViewModel = ReturnType<typeof useAtlas>;

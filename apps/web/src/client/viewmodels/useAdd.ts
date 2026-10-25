import { useState } from 'react';
import type { AddCandidate, AddDraft, AddPreview, ReservationPolicy } from '../../shared/types.ts';
import { api } from '../api.ts';

export type AddStage =
  | 'idle'
  | 'searching'
  | 'candidates'
  | 'previewing'
  | 'preview'
  | 'saving'
  | 'saved';

/** Editable string form of a draft; converted back to an AddDraft on save. */
export interface DraftForm {
  title: string;
  alternateTitle: string;
  area: string;
  address: string;
  latitude: string;
  longitude: string;
  description: string;
  categories: string;
  dishes: string;
  tabelogUrl: string;
  tabelogScore: string;
  officialUrl: string;
  policy: ReservationPolicy;
  reservationLabel: string;
  bookingUrl: string;
  reservationNote: string;
  openingHours: string;
  regularClosingDays: string;
  closingNotes: string;
}

const list = (value: string) =>
  value
    .split(/[,、，]/u)
    .map((entry) => entry.trim())
    .filter(Boolean);

export function toForm(draft: AddDraft): DraftForm {
  return {
    title: draft.title,
    alternateTitle: draft.alternateTitle ?? '',
    area: draft.area,
    address: draft.address,
    latitude: draft.latitude?.toString() ?? '',
    longitude: draft.longitude?.toString() ?? '',
    description: draft.description,
    categories: draft.categories.join(', '),
    dishes: draft.dishes.join(', '),
    tabelogUrl: draft.tabelog?.url ?? '',
    tabelogScore: draft.tabelog?.score?.toFixed(2) ?? '',
    officialUrl: draft.officialUrl ?? '',
    policy: draft.reservation.policy,
    reservationLabel: draft.reservation.label,
    bookingUrl: draft.reservation.bookingUrl ?? '',
    reservationNote: draft.reservation.note ?? '',
    openingHours: draft.openingHours ?? '',
    regularClosingDays: draft.regularClosingDays ?? '',
    closingNotes: draft.closingNotes ?? '',
  };
}

export function fromForm(base: AddDraft, form: DraftForm): AddDraft {
  const optional = (key: string, value: string) => (value.trim() ? { [key]: value.trim() } : {});
  const number = (value: string) => (value.trim() === '' ? null : Number(value));
  return {
    id: base.id,
    title: form.title.trim(),
    ...optional('alternateTitle', form.alternateTitle),
    area: form.area.trim(),
    address: form.address.trim(),
    latitude: number(form.latitude),
    longitude: number(form.longitude),
    description: form.description.trim(),
    categories: list(form.categories),
    dishes: list(form.dishes),
    ...(form.tabelogUrl.trim()
      ? {
          tabelog: {
            url: form.tabelogUrl.trim(),
            ...(form.tabelogScore.trim() ? { score: Number(form.tabelogScore) } : {}),
          },
        }
      : {}),
    ...(base.googlePlaceId ? { googlePlaceId: base.googlePlaceId } : {}),
    ...optional('officialUrl', form.officialUrl),
    reservation: {
      policy: form.policy,
      label: form.reservationLabel.trim(),
      ...optional('bookingUrl', form.bookingUrl),
      ...optional('note', form.reservationNote),
    },
    ...optional('openingHours', form.openingHours),
    ...optional('regularClosingDays', form.regularClosingDays),
    ...optional('closingNotes', form.closingNotes),
    ...(base.scheduleSourceUrl ? { scheduleSourceUrl: base.scheduleSourceUrl } : {}),
  };
}

/** Add workflow: search → pick a candidate → review the editable draft → save. */
export function useAdd(onSaved: (id: string) => void) {
  const [stage, setStage] = useState<AddStage>('idle');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [candidates, setCandidates] = useState<AddCandidate[]>([]);
  const [preview, setPreview] = useState<AddPreview>();
  const [form, setForm] = useState<DraftForm>();
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<string>();
  const [retry, setRetry] = useState<() => void>();

  async function step(
    next: AddStage,
    back: AddStage,
    action: () => Promise<void>,
    again: () => void,
  ) {
    setStage(next);
    setError('');
    setRetry(undefined);
    try {
      await action();
    } catch (failure) {
      setStage(back);
      setError(failure instanceof Error ? failure.message : 'The request failed.');
      setRetry(() => again);
    }
  }

  const search = () =>
    step(
      'searching',
      'idle',
      async () => {
        const found = await api.addSearch(query.trim(), area.trim());
        setCandidates(found);
        setStage('candidates');
      },
      search,
    );

  const choose = (candidate: AddCandidate) =>
    step(
      'previewing',
      'candidates',
      async () => {
        const result = await api.addPreview(candidate);
        setPreview(result);
        setForm(toForm(result.draft));
        setStage('preview');
      },
      () => choose(candidate),
    );

  const save = () =>
    preview && form
      ? step(
          'saving',
          'preview',
          async () => {
            const { id } = await api.addSave(fromForm(preview.draft, form));
            setSavedId(id);
            setStage('saved');
            onSaved(id);
          },
          save,
        )
      : Promise.resolve();

  const reset = () => {
    setStage('idle');
    setCandidates([]);
    setPreview(undefined);
    setForm(undefined);
    setError('');
    setSavedId(undefined);
  };

  return {
    stage,
    query,
    area,
    setQuery,
    setArea,
    candidates,
    preview,
    form,
    setField: <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
      setForm((current) => current && { ...current, [key]: value }),
    error,
    retry,
    savedId,
    search,
    choose,
    save,
    reset,
  };
}

export type AddViewModel = ReturnType<typeof useAdd>;

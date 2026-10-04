import type {
  CatalogIntakePreview,
  CatalogIntakeOwnerFields,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';

export function catalogIntakeEditorValues(preview: CatalogIntakePreview) {
  const owner = preview.ownerFields;
  const location = preview.locationEvidence;
  const coordinates =
    owner.coordinates ?? (location.status === 'known' ? location : undefined);
  return {
    title: owner.title ?? preview.titleProposal?.value ?? '',
    area: owner.area ?? preview.profile?.area?.value ?? '',
    address:
      owner.address ??
      preview.addressProposal?.value ??
      (location.status === 'known'
        ? 'normalizedAddress' in location
          ? location.normalizedAddress
          : location.address
        : ''),
    categories: (
      owner.categories ??
      preview.profile?.categories?.value ??
      []
    ).join(', '),
    signatureDishes: (
      owner.signatureDishes ??
      preview.profile?.signatureDishes?.value ??
      []
    ).join(', '),
    summary: owner.summary ?? preview.profile?.summary?.value ?? '',
    openingHours:
      owner.openingHours?.value ?? preview.profile?.openingHours?.value ?? '',
    openingHoursSourceUrl:
      owner.openingHours?.sourceUrl ??
      preview.profile?.openingHours?.sourceUrl ??
      '',
    regularClosingDays:
      owner.regularClosingDays?.value ??
      preview.profile?.regularClosingDays?.value ??
      '',
    regularClosingDaysSourceUrl:
      owner.regularClosingDays?.sourceUrl ??
      preview.profile?.regularClosingDays?.sourceUrl ??
      '',
    latitude: coordinates ? String(coordinates.latitude) : '',
    longitude: coordinates ? String(coordinates.longitude) : '',
    tabelogScore:
      preview.tabelog.status === 'known' ? String(preview.tabelog.score) : '',
    tabelogUrl: preview.tabelog.status === 'known' ? preview.tabelog.url : '',
    reservationMode:
      preview.reservation.status === 'known'
        ? preview.reservation.mode
        : 'unknown',
    reservationLabel:
      preview.reservation.status === 'known' ? preview.reservation.label : '',
    reservationUrl:
      preview.reservation.status === 'known' ? preview.reservation.url : '',
  } as const;
}

export function catalogIntakeManualLabels(value: string): string[] {
  return value
    .split(/[,，、]/u)
    .map((entry) => entry.normalize('NFC').trim())
    .filter(Boolean);
}

// Prefilling a sourced fact is not an Owner assertion. Send only changed fields
// and retain previously confirmed Owner overrides across preview refreshes.
export function catalogIntakeSelectionDetails(
  state: ReturnType<typeof catalogIntakeEditorValues> & {
    readonly preview?: CatalogIntakePreview;
  },
) {
  const original = state.preview
    ? catalogIntakeEditorValues(state.preview)
    : undefined;
  const changed = (key: keyof ReturnType<typeof catalogIntakeEditorValues>) =>
    original
      ? state[key] !== original[key]
      : Boolean(state[key] && state[key] !== 'unknown');
  const fields: Record<string, unknown> = { ...state.preview?.ownerFields };
  for (const key of ['title', 'area', 'address', 'summary'] as const) {
    if (!changed(key)) continue;
    delete fields[key];
    const value = state[key].normalize('NFC').trim();
    if (value || key === 'area') fields[key] = value;
  }
  for (const key of ['categories', 'signatureDishes'] as const) {
    if (!changed(key)) continue;
    delete fields[key];
    const value = catalogIntakeManualLabels(state[key]);
    if (value.length) fields[key] = value;
  }
  if (changed('address') || changed('latitude') || changed('longitude')) {
    delete fields.coordinates;
    if (state.latitude.trim() && state.longitude.trim())
      fields.coordinates = {
        latitude: Number(state.latitude),
        longitude: Number(state.longitude),
      };
  }
  const ownerFields = fields as CatalogIntakeOwnerFields;
  for (const [key, urlKey] of [
    ['openingHours', 'openingHoursSourceUrl'],
    ['regularClosingDays', 'regularClosingDaysSourceUrl'],
  ] as const) {
    if (!changed(key) && !changed(urlKey)) continue;
    delete fields[key];
    if (state[key].trim() && state[urlKey].trim())
      fields[key] = {
        value: state[key].normalize('NFC').trim(),
        sourceUrl: state[urlKey].trim(),
      };
  }
  const tabelogChanged = changed('tabelogScore') || changed('tabelogUrl');
  const reservationChanged =
    changed('reservationMode') ||
    changed('reservationLabel') ||
    changed('reservationUrl');
  return {
    ownerFields,
    ...(tabelogChanged
      ? {
          tabelog:
            state.tabelogScore.trim() && state.tabelogUrl.trim()
              ? {
                  score: Number(state.tabelogScore),
                  url: state.tabelogUrl.trim(),
                }
              : ('unknown' as const),
        }
      : {}),
    ...(reservationChanged
      ? {
          reservation:
            state.reservationMode !== 'unknown'
              ? {
                  mode: state.reservationMode,
                  label: state.reservationLabel.trim(),
                  url: state.reservationUrl.trim(),
                }
              : ('unknown' as const),
        }
      : {}),
  };
}

import type {
  CatalogIntakePreview,
  CatalogIntakeSuspectedDuplicate,
  CatalogIntakeWarning,
} from './catalog-intake-coordinator.ts';

export interface CatalogIntakePreviewFieldPresentation {
  readonly key:
    | 'identity'
    | 'title'
    | 'area'
    | 'address'
    | 'coordinates'
    | 'tabelog'
    | 'reservation';
  readonly label: string;
  readonly value: string;
  readonly evidence: string;
  readonly sourceUrl?: string;
  readonly evidenceAt?: string;
  readonly license?: string;
}

export interface CatalogIntakePreviewPresentation {
  readonly versionLabel: string;
  readonly fields: readonly CatalogIntakePreviewFieldPresentation[];
  readonly duplicates: readonly CatalogIntakeSuspectedDuplicate[];
  readonly unknownFields: CatalogIntakePreview['unknownFields'];
  readonly warnings: readonly CatalogIntakeWarning[];
}

export function presentCatalogIntakePreview(
  preview: CatalogIntakePreview,
): CatalogIntakePreviewPresentation {
  const title = preview.ownerFields.title
    ? field('title', 'Name', preview.ownerFields.title, 'Owner asserted')
    : preview.titleProposal
      ? field(
          'title',
          'Name',
          preview.titleProposal.value,
          evidenceLabel(preview.titleProposal.provenance),
          preview.titleProposal.provenance === 'agent_observed'
            ? {
                sourceUrl: preview.titleProposal.sourceUrl,
                evidenceAt: preview.titleProposal.observedAt,
              }
            : undefined,
        )
      : field('title', 'Name', 'Unknown', 'No durable evidence');
  const address = preview.ownerFields.address
    ? field('address', 'Address', preview.ownerFields.address, 'Owner asserted')
    : preview.addressProposal
      ? field(
          'address',
          'Address',
          preview.addressProposal.value,
          evidenceLabel(preview.addressProposal.provenance),
          preview.addressProposal.provenance === 'agent_observed'
            ? {
                sourceUrl: preview.addressProposal.sourceUrl,
                evidenceAt: preview.addressProposal.observedAt,
              }
            : {
                sourceUrl: preview.addressProposal.sourceUrl,
                evidenceAt: preview.addressProposal.checkedAt,
                license: preview.addressProposal.license,
              },
        )
      : field(
          'address',
          'Address',
          'Unknown — needs review',
          'No durable evidence',
        );
  const location = preview.locationEvidence;
  const coordinates =
    location.status === 'known'
      ? field(
          'coordinates',
          'Coordinates',
          `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
          evidenceLabel(location.provenance),
          location.provenance === 'owner_asserted'
            ? {
                sourceUrl: location.sourceUrl,
                evidenceAt: location.assertedAt,
              }
            : location.provenance === 'agent_observed'
              ? {
                  sourceUrl: location.sourceUrl,
                  evidenceAt: location.observedAt,
                }
              : {
                  sourceUrl: location.sourceUrl,
                  evidenceAt: location.checkedAt,
                  license: location.license,
                },
        )
      : field(
          'coordinates',
          'Coordinates',
          'Unknown — excluded from Nearby',
          'No durable evidence',
        );
  const tabelog =
    preview.tabelog.status === 'known'
      ? field(
          'tabelog',
          'Tabelog',
          `${preview.tabelog.score.toFixed(2)}${
            preview.tabelog.reviewCount === undefined
              ? ''
              : ` · ${preview.tabelog.reviewCount} reviews`
          }`,
          `${evidenceLabel(preview.tabelog.provenance)} · ${preview.tabelog.freshness}`,
          {
            sourceUrl: preview.tabelog.url,
            evidenceAt:
              preview.tabelog.provenance === 'owner_asserted'
                ? preview.tabelog.assertedAt
                : preview.tabelog.observedAt,
          },
        )
      : field('tabelog', 'Tabelog', 'Unknown', 'No durable evidence');
  const reservation =
    preview.reservation.status === 'known'
      ? field(
          'reservation',
          'Reservation',
          reservationValue(preview.reservation),
          `${evidenceLabel(preview.reservation.provenance)} · ${preview.reservation.freshness}`,
          {
            sourceUrl: preview.reservation.url,
            evidenceAt:
              preview.reservation.provenance === 'owner_asserted'
                ? preview.reservation.assertedAt
                : preview.reservation.observedAt,
          },
        )
      : field('reservation', 'Reservation', 'Unknown', 'No durable evidence');

  return {
    versionLabel: `Preview v${preview.previewVersion}`,
    fields: [
      field(
        'identity',
        'Place identity',
        `${preview.candidateIdentity.providerNamespace} / ${preview.candidateIdentity.placeId}`,
        preview.candidateIdentity.providerNamespace === 'google-places'
          ? 'Google identity'
          : 'Source identity',
      ),
      title,
      field(
        'area',
        'Area',
        preview.ownerFields.area ?? preview.profile?.area?.value ?? 'Unknown',
        preview.ownerFields.area
          ? 'Owner asserted'
          : preview.profile?.area
            ? 'Agent observed'
            : 'No durable evidence',
      ),
      address,
      coordinates,
      tabelog,
      reservation,
    ],
    duplicates: preview.suspectedDuplicates,
    unknownFields: preview.unknownFields,
    warnings: preview.warnings,
  };
}

export function presentCatalogIntakePreviewText(
  preview: CatalogIntakePreview,
): string {
  const presentation = presentCatalogIntakePreview(preview);
  const lines = [presentation.versionLabel];
  for (const item of presentation.fields) {
    lines.push(`${item.label}: ${item.value}`);
    lines.push(
      `  Evidence: ${item.evidence}${item.evidenceAt ? ` · ${item.evidenceAt}` : ''}${
        item.license ? ` · ${item.license}` : ''
      }${item.sourceUrl ? ` · ${item.sourceUrl}` : ''}`,
    );
  }
  for (const duplicate of presentation.duplicates) {
    lines.push(
      `Possible duplicate (${duplicate.match}): ${duplicate.title}${
        duplicate.address ? ` · ${duplicate.address}` : ''
      } · ${duplicate.itemId}`,
    );
  }
  if (presentation.unknownFields.length) {
    lines.push(`Still unknown: ${presentation.unknownFields.join(', ')}`);
  }
  for (const warning of presentation.warnings) {
    lines.push(`Warning: ${warning.message}`);
  }
  return lines.join('\n');
}

function field(
  key: CatalogIntakePreviewFieldPresentation['key'],
  label: string,
  value: string,
  evidence: string,
  details?: Pick<
    CatalogIntakePreviewFieldPresentation,
    'sourceUrl' | 'evidenceAt' | 'license'
  >,
): CatalogIntakePreviewFieldPresentation {
  return { key, label, value, evidence, ...definedDetails(details) };
}

function definedDetails(
  details:
    | Pick<
        CatalogIntakePreviewFieldPresentation,
        'sourceUrl' | 'evidenceAt' | 'license'
      >
    | undefined,
) {
  if (!details) return {};
  return {
    ...(details.sourceUrl ? { sourceUrl: details.sourceUrl } : {}),
    ...(details.evidenceAt ? { evidenceAt: details.evidenceAt } : {}),
    ...(details.license ? { license: details.license } : {}),
  };
}

function evidenceLabel(provenance: string): string {
  const labels: Readonly<Record<string, string>> = {
    owner_asserted: 'Owner asserted',
    owner_query: 'Owner query',
    agent_observed: 'Agent observed',
    durable_geocoder_observed: 'Durable geocoder observed',
  };
  return labels[provenance] ?? provenance;
}

function reservationValue(
  reservation: Extract<
    CatalogIntakePreview['reservation'],
    { readonly status: 'known' }
  >,
): string {
  return [
    reservation.label,
    reservation.advanceDays === undefined
      ? undefined
      : `${reservation.advanceDays} days ahead`,
    reservation.bookingWindowLabel,
    reservation.releaseNote,
    reservation.channel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

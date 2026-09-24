import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import satori from 'satori';
import sharp from '../node_modules/sharp/dist/index.mjs';

import { presentCatalogIntakePreview } from '../product/application/catalog-intake/catalog-intake-preview-presenter.ts';

const palette = {
  paper: '#f4f0e7',
  raised: '#fbf8f1',
  ink: '#1f211d',
  soft: '#62655b',
  line: '#d8d2c4',
  vermilion: '#bd4025',
  vermilionDark: '#91301e',
  moss: '#4e6657',
  muted: '#ebe6dc',
};

const outputDirectory = fileURLToPath(
  new URL(
    '../../../features/005-owner-poc-unified-api/evidence/ui/t17/',
    import.meta.url,
  ),
);
const regular = await readFile(
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
);
const bold = await readFile(
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
);
await mkdir(outputDirectory, { recursive: true });

const preview = presentCatalogIntakePreview(fullPreview());
const renders = [
  ['t17-add-desktop-preview.png', 1440, 1260, 'preview'],
  ['t17-add-mobile-preview.png', 390, 1900, 'preview'],
  ['t17-add-desktop-confirm-loading.png', 1440, 1260, 'loading'],
  ['t17-add-desktop-retryable-error.png', 1440, 800, 'error'],
  ['t17-add-desktop-verified-success.png', 1440, 800, 'verified'],
  ['t17-add-desktop-needs-review-success.png', 1440, 800, 'needs-review'],
  ['t17-add-desktop-confirm-conflict.png', 1440, 1380, 'conflict'],
];

for (const [file, width, height, state] of renders) {
  const svg = await satori(renderPage({ width, state }), {
    width,
    height,
    fonts: [
      { name: 'Atlas Sans', data: regular, weight: 400 },
      { name: 'Atlas Sans', data: bold, weight: 700 },
    ],
  });
  await sharp(Buffer.from(svg)).png().toFile(`${outputDirectory}/${file}`);
}

function renderPage({ width, state }) {
  const mobile = width <= 480;
  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: palette.paper,
        color: palette.ink,
        fontFamily: 'Atlas Sans',
        padding: mobile ? '22px 12px' : '48px 72px',
      },
    },
    h(
      'header',
      {
        style: {
          display: 'flex',
          flexShrink: 0,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          width: '100%',
          paddingBottom: mobile ? 16 : 24,
          borderBottom: `1px solid ${palette.line}`,
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: eyebrowStyle() }, 'Japan Atlas'),
        h(
          'span',
          {
            style: {
              fontFamily: 'Atlas Sans',
              fontWeight: 700,
              fontSize: mobile ? 27 : 38,
              marginTop: 4,
            },
          },
          'Owner map',
        ),
      ),
      h(
        'span',
        { style: { color: palette.moss, fontSize: mobile ? 11 : 13 } },
        'PRIVATE WORKSPACE',
      ),
    ),
    h(
      'main',
      {
        style: {
          width: '100%',
          display: 'flex',
          flexShrink: 0,
          justifyContent: 'center',
          paddingTop: mobile ? 18 : 34,
        },
      },
      renderPanel({ mobile, state }),
    ),
  );
}

function renderPanel({ mobile, state }) {
  const showsPreview = ['preview', 'loading', 'conflict'].includes(state);
  return h(
    'section',
    {
      style: {
        width: mobile ? '100%' : 840,
        display: 'flex',
        flexShrink: 0,
        flexDirection: 'column',
        gap: mobile ? 12 : 14,
        padding: mobile ? 16 : 22,
        border: `1px solid ${palette.line}`,
        borderTop: `3px solid ${palette.vermilion}`,
        borderRadius: 7,
        backgroundColor: palette.raised,
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { style: eyebrowStyle() }, 'Owner catalog desk'),
        h(
          'span',
          { style: { fontSize: mobile ? 21 : 24, fontWeight: 700 } },
          'Add a place',
        ),
      ),
      h(
        'span',
        {
          style: {
            color: palette.moss,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.7,
          },
        },
        'PREVIEW FIRST',
      ),
    ),
    h(
      'p',
      { style: bodyStyle() },
      'Start with a restaurant name. Nothing enters your map until a confirmed publish step.',
    ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
      h(
        'span',
        { style: { fontSize: 13, fontWeight: 700 } },
        'Restaurant name or address',
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: mobile ? 'column' : 'row',
            gap: 9,
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              ...(mobile ? { width: '100%' } : { flex: 1 }),
              minHeight: 44,
              padding: '0 12px',
              border: `1px solid ${palette.line}`,
              borderRadius: 7,
              color: state === 'loading' ? '#969489' : palette.ink,
              backgroundColor: state === 'loading' ? palette.muted : '#fffdf7',
              fontSize: 14,
            },
          },
          'Sushi Aozora, Ginza',
        ),
        button('Find matches', state === 'loading', mobile),
      ),
      h(
        'span',
        { style: { color: palette.soft, fontSize: 11 } },
        'Try a neighborhood or full copied address when the name is ambiguous.',
      ),
    ),
    state === 'loading'
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              color: palette.moss,
              fontSize: 13,
              fontWeight: 700,
            },
          },
          'Confirming and saving…',
        )
      : null,
    state === 'error'
      ? stateCard(
          'Add needs attention',
          'The provider did not answer. Nothing was saved.',
          'Your input is still here. Sign in as Owner if prompted, then retry.',
          'Retry',
          palette.vermilionDark,
        )
      : null,
    state === 'verified'
      ? stateCard(
          'Place saved',
          '✓  Place saved and available on the verified map and Nearby.',
          'Receipt add-confirm:verified:7fd1',
          undefined,
          palette.moss,
        )
      : null,
    state === 'needs-review'
      ? stateCard(
          'Place saved',
          '✓  Place saved to Owner review.',
          'It is not visible on the public map or Nearby yet. Complete the missing evidence from Owner review. Receipt add-confirm:review:2cb8',
          undefined,
          palette.moss,
        )
      : null,
    state === 'conflict'
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              padding: 12,
              borderLeft: `3px solid ${palette.vermilion}`,
              backgroundColor: palette.paper,
              color: palette.vermilionDark,
            },
          },
          h(
            'span',
            { style: { fontWeight: 700, fontSize: 14 } },
            'Evidence changed during confirmation.',
          ),
          h(
            'span',
            { style: { fontSize: 12, lineHeight: 1.5 } },
            'Review the refreshed facts below. Nothing new was saved; confirm again only if this version is correct.',
          ),
        )
      : null,
    showsPreview ? renderPreview({ mobile, state }) : null,
  );
}

function renderPreview({ mobile, state }) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h(
      'span',
      { style: { fontSize: 14, fontWeight: 700 } },
      state === 'conflict'
        ? 'Review the changed proposal'
        : 'Review the proposal',
    ),
    h(
      'span',
      { style: { color: palette.soft, fontSize: 11 } },
      state === 'conflict' ? 'Preview v5 · refreshed' : preview.versionLabel,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          borderTop: `1px solid ${palette.line}`,
        },
      },
      ...preview.fields.map((field) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: mobile ? 'column' : 'row',
              gap: mobile ? 4 : 12,
              padding: mobile ? '9px 0' : '10px 0',
              borderBottom: `1px solid ${palette.line}`,
            },
          },
          h(
            'span',
            {
              style: {
                width: mobile ? '100%' : 118,
                color: palette.soft,
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
              },
            },
            field.label,
          ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                ...(mobile ? { width: '100%' } : { flex: 1 }),
                gap: 3,
              },
            },
            h(
              'span',
              { style: { fontSize: 13, lineHeight: 1.4 } },
              state === 'conflict' && field.key === 'tabelog'
                ? '4.25 · 338 reviews'
                : field.value,
            ),
            h(
              'span',
              {
                style: { color: palette.soft, fontSize: 10, lineHeight: 1.45 },
              },
              `${field.evidence}${field.evidenceAt ? ` · ${field.evidenceAt}` : ''}${field.license ? ` · ${field.license}` : ''}${field.sourceUrl ? ' · Source link' : ''}`,
            ),
          ),
        ),
      ),
    ),
    preview.duplicates.length
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: 11,
              border: `1px solid ${palette.line}`,
              borderRadius: 7,
              color: palette.vermilionDark,
              backgroundColor: palette.paper,
            },
          },
          h(
            'span',
            { style: { fontSize: 12, fontWeight: 700 } },
            'Possible duplicates',
          ),
          ...preview.duplicates.map((duplicate) =>
            h(
              'span',
              { style: { fontSize: 11 } },
              `${duplicate.title} · ${duplicate.address} · ${duplicate.match} match`,
            ),
          ),
        )
      : null,
    h(
      'span',
      { style: { color: palette.soft, fontSize: 11 } },
      `Still unknown: ${preview.unknownFields.join(', ')}.`,
    ),
    ...preview.warnings.map((warning) =>
      h(
        'span',
        { style: { color: palette.vermilionDark, fontSize: 11 } },
        `• ${warning.message}`,
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: 9 } },
      button(
        state === 'loading'
          ? 'Confirming and saving…'
          : state === 'conflict'
            ? 'Review changed preview and confirm again'
            : 'Confirm and save',
        state === 'loading',
      ),
      ghostButton('Cancel', state === 'loading'),
    ),
  );
}

function stateCard(title, strong, detail, action, color) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h('span', { style: { fontWeight: 700, fontSize: 14 } }, title),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
          border: `1px solid ${palette.line}`,
          borderRadius: 7,
          backgroundColor: palette.paper,
          color,
        },
      },
      h('span', { style: { fontWeight: 700, fontSize: 14 } }, strong),
      h(
        'span',
        { style: { color: palette.soft, fontSize: 12, lineHeight: 1.5 } },
        detail,
      ),
      action ? button(action, false) : null,
    ),
  );
}

function button(label, disabled, fullWidth = false) {
  return h(
    'span',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(fullWidth ? { width: '100%' } : {}),
        minHeight: 44,
        padding: '0 16px',
        borderRadius: 7,
        backgroundColor: disabled ? '#d5d1c7' : palette.ink,
        color: disabled ? '#817f76' : '#fffdf7',
        fontSize: 13,
        fontWeight: 700,
      },
    },
    label,
  );
}

function ghostButton(label, disabled) {
  return h(
    'span',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        padding: '0 16px',
        border: `1px solid ${palette.line}`,
        borderRadius: 7,
        color: disabled ? '#969489' : palette.ink,
        fontSize: 13,
        fontWeight: 700,
      },
    },
    label,
  );
}

function bodyStyle() {
  return {
    margin: 0,
    color: palette.soft,
    fontSize: 12,
    lineHeight: 1.5,
  };
}

function eyebrowStyle() {
  return {
    color: palette.vermilionDark,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  };
}

function h(type, props, ...children) {
  return { type, props: { ...props, children: children.flat() } };
}

function fullPreview() {
  return {
    sessionId: 'session-ui-evidence',
    previewVersion: 4,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: 'ChIJ-atlas-aoyama',
    },
    ownerFields: { area: 'Ginza' },
    titleProposal: {
      provenance: 'agent_observed',
      value: 'Sushi Aozora',
      sourceUrl: 'https://restaurant.example/name',
      observedAt: '2026-09-23T12:00:00.000Z',
    },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: '8-3-1 Ginza, Chuo City, Tokyo',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '8-3-1 Ginza, Chuo City, Tokyo',
      latitude: 35.671,
      longitude: 139.765,
      provider: 'Nominatim',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.21,
      reviewCount: 321,
      url: 'https://tabelog.com/tokyo/example/',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:02:00.000Z',
      freshness: 'stale',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Reservation required',
      advanceDays: 30,
      bookingWindowLabel: 'Book one month ahead',
      releaseNote: 'Seats release monthly',
      channel: 'Official website',
      url: 'https://restaurant.example/reservations',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:03:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [
      {
        itemId: 'existing-1',
        title: 'Sushi Aozora Annex',
        address: '8-3-2 Ginza, Chuo City, Tokyo',
        match: 'strong',
      },
    ],
    unknownFields: ['walk-in queue status'],
    warnings: [
      { code: 'stale_evidence', message: 'Tabelog evidence may be stale.' },
    ],
    evidenceDigest: 'a'.repeat(64),
    catalogRevision: 'catalog-r1',
    expiresAt: '2026-09-23T12:30:00.000Z',
  };
}

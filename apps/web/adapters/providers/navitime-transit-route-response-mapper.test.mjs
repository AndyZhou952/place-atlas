import assert from 'node:assert/strict';
import test from 'node:test';

import { mapNavitimeTransitRouteResponse } from './navitime-transit-route-response-mapper.ts';

const direct = {
  summary: { move: { type: 'move', time: 18, transit_count: 0 } },
  sections: [
    { type: 'point' },
    { type: 'move', move: 'walk', time: 4 },
    { type: 'point' },
    { type: 'move', move: 'local_train', line_name: 'Metro Line', time: 9 },
    { type: 'point' },
    { type: 'move', move: 'walk', time: 5 },
    { type: 'point' },
  ],
};

test('NAVITIME direct rail includes access walking and is labelled an average estimate', () => {
  assert.deepEqual(mapNavitimeTransitRouteResponse({ items: [direct] }), {
    directRoute: {
      durationSeconds: 1080,
      lineIdentity: 'Metro Line',
      estimateBasis: 'average',
    },
  });
});

test('NAVITIME mapper rejects transfer, bus, and unsupported multimodal routes', () => {
  for (const route of [
    {
      ...direct,
      summary: { move: { type: 'move', time: 18, transit_count: 1 } },
    },
    {
      ...direct,
      sections: [
        ...direct.sections,
        {
          type: 'move',
          move: 'local_train',
          line_name: 'Another line',
          time: 0,
        },
        { type: 'point' },
      ],
    },
    {
      ...direct,
      sections: [
        ...direct.sections,
        { type: 'move', move: 'local_bus', time: 0 },
        { type: 'point' },
      ],
    },
  ]) {
    assert.deepEqual(mapNavitimeTransitRouteResponse({ items: [route] }), {
      directRoute: null,
    });
  }
});

test('NAVITIME route identity prefers the transport display name', () => {
  const sections = direct.sections.map((section) =>
    section.move === 'local_train'
      ? { ...section, transport: { self_name: 'Through Service' } }
      : section,
  );
  assert.equal(
    mapNavitimeTransitRouteResponse({ items: [{ ...direct, sections }] })
      ?.directRoute?.lineIdentity,
    'Through Service',
  );
});

test('NAVITIME mapper does not turn malformed provider data into a verified absence', () => {
  assert.equal(mapNavitimeTransitRouteResponse({}), undefined);
  assert.equal(
    mapNavitimeTransitRouteResponse({ items: [{ ...direct, sections: [] }] }),
    undefined,
  );
  assert.equal(
    mapNavitimeTransitRouteResponse({
      items: [
        {
          ...direct,
          summary: { move: { type: 'move', time: 8, transit_count: 0 } },
        },
      ],
    }),
    undefined,
  );
  assert.equal(
    mapNavitimeTransitRouteResponse({
      items: [{ ...direct, sections: direct.sections.slice(1) }],
    }),
    undefined,
  );
  assert.equal(
    mapNavitimeTransitRouteResponse({
      items: [
        {
          ...direct,
          sections: direct.sections.map((section) =>
            section.move === 'local_train'
              ? { ...section, line_name: '' }
              : section,
          ),
        },
      ],
    }),
    undefined,
  );
  assert.deepEqual(mapNavitimeTransitRouteResponse({ items: [] }), {
    directRoute: null,
  });
});

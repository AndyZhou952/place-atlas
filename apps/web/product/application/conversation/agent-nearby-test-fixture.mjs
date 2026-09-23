export function createAgentNearbyTestDependencies(provider) {
  let loaded;
  const load = (locationHint) => {
    loaded ??= provider.recommend({ locationHint }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    });
    return loaded;
  };
  const toItem = (item, index) => ({
    id: item.itemId,
    kind: 'food',
    title: item.name,
    area: item.area,
    address: item.address,
    description: item.reason,
    latitude: 35.671 + index * 0.0001,
    longitude: 139.765 + index * 0.0001,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-13T00:00:00.000Z',
    officialUrl: item.mapDeepLink,
    reservation: {
      mode: 'unknown',
      label: '需确认',
      checkedAt: '2026-09-13T00:00:00.000Z',
    },
    personalState: item.visited ? 'visited' : 'candidate',
    hasVisited: item.visited,
    tags: [],
    sources: [],
  });
  const items = async () => (await load('fixture')).recommendations.map(toItem);
  const catalog = {
    async list() {
      return items();
    },
    async get(id) {
      return (await items()).find((item) => item.id === id);
    },
  };
  return {
    clock: { now: () => new Date('2026-09-13T00:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog,
    locationResolver: {
      async resolve(locationHint) {
        const result = await load(locationHint);
        return {
          status: 'resolved',
          location: {
            canonicalAddress: result.resolvedLocation,
            point: { latitude: 35.671, longitude: 139.764 },
          },
          attribution: {
            label: 'Test location',
            url: 'https://fixture.invalid/location',
          },
          provenance: {
            providerId: 'test-location',
            policyVersion: 'test-location-v1',
            sourceUrl: 'https://fixture.invalid/location?query=fixture',
            checkedAt: '2026-09-13T00:02:00.000Z',
          },
        };
      },
    },
    routeProvider: {
      async walking(_origin, destination) {
        const result = await load('fixture');
        const index = Math.max(
          0,
          Math.round((destination.latitude - 35.671) / 0.0001),
        );
        const item = result.recommendations[index];
        return item
          ? {
              status: 'fresh',
              durationSeconds: item.walkingMinutes * 60,
              distanceMeters: item.walkingMinutes * 75,
              checkedAt: '2026-09-13T00:00:00.000Z',
              attribution: {
                label: 'Test routes',
                url: 'https://fixture.invalid/routes',
              },
            }
          : { status: 'unavailable', warning: 'Route unavailable.' };
      },
    },
    entryAccessProvider: {
      async inspectWalkIn() {
        return { status: 'unknown', warning: '需确认。' };
      },
      async inspectQueue() {
        return { status: 'unknown', warning: '需确认。' };
      },
    },
    entryAccessPolicy: {
      policyVersion: 'test-entry-v1',
      allowedSourceOrigins: ['https://fixture.invalid'],
      maximumAgeMs: 5 * 60 * 1000,
      clock: { now: () => new Date('2026-09-13T00:02:00.000Z') },
    },
    personalFacts: {
      async read(itemId) {
        const item = await catalog.get(itemId);
        return {
          manualVisited: item?.hasVisited === true,
          visitCount: item?.hasVisited === true ? 1 : 0,
        };
      },
    },
    mapDeepLink: (item) => item.officialUrl,
  };
}

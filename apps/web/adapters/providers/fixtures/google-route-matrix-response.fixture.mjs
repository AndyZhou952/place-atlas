export const googleRouteMatrixResponseFixture = [
  {
    originIndex: 0,
    destinationIndex: 2,
    status: {},
    condition: 'ROUTE_EXISTS',
    distanceMeters: 1200,
    duration: '900.2s',
  },
  {
    originIndex: 0,
    destinationIndex: 0,
    status: {},
    condition: 'ROUTE_EXISTS',
    distanceMeters: 650,
    duration: '600s',
  },
  {
    originIndex: 0,
    destinationIndex: 1,
    status: { code: 5, message: 'provider detail must not escape' },
    condition: 'ROUTE_NOT_FOUND',
  },
];

const walkingStep = (staticDuration) => ({
  travelMode: 'WALK',
  staticDuration,
});

const transitStep = (staticDuration, agency, name, nameShortCode) => ({
  travelMode: 'TRANSIT',
  staticDuration,
  transitDetails: {
    transitLine: {
      agencies: [{ name: agency }],
      name,
      nameShortCode,
    },
  },
});

export const directTransit1200Fixture = {
  routes: [
    {
      duration: '1200s',
      routeLabels: ['DEFAULT_ROUTE'],
      legs: [
        {
          steps: [
            walkingStep('300s'),
            transitStep('600s', 'Tokyo Metro', 'Ginza Line', 'G'),
            walkingStep('300s'),
          ],
        },
      ],
      polyline: { encodedPolyline: 'must-not-leave-the-adapter' },
    },
  ],
  requestedRoutingPreference: 'FEWER_TRANSFERS',
};

export const directTransit1201Fixture = {
  routes: [
    {
      duration: '1201s',
      legs: [
        {
          steps: [
            walkingStep('300s'),
            transitStep('600s', 'Tokyo Metro', 'Ginza Line', 'G'),
            walkingStep('301s'),
          ],
        },
      ],
    },
  ],
};

export const transferTransitFixture = {
  routes: [
    {
      duration: '1100s',
      legs: [
        {
          steps: [
            walkingStep('120s'),
            transitStep('400s', 'Tokyo Metro', 'Ginza Line', 'G'),
            walkingStep('60s'),
            transitStep('400s', 'Tokyo Metro', 'Marunouchi Line', 'M'),
            walkingStep('120s'),
          ],
        },
      ],
    },
  ],
  requestedRoutingPreference: 'FEWER_TRANSFERS',
};

export const missingTransitFieldFixture = {
  routes: [
    {
      duration: '1200s',
      legs: [
        {
          steps: [
            walkingStep('300s'),
            {
              travelMode: 'TRANSIT',
              staticDuration: '600s',
              transitDetails: { transitLine: { agencies: [] } },
            },
            walkingStep('300s'),
          ],
        },
      ],
    },
  ],
};

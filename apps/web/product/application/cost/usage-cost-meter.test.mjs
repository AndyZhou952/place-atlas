import assert from 'node:assert/strict';
import test from 'node:test';

import { createUsageCostMeter } from './usage-cost-meter.ts';

const meter = createUsageCostMeter({
  hardLimitUsd: 60,
  reserveUsd: 10,
  warnAtUsd: 45,
});

test('fixed bills and variable usage share one auditable monthly projection', () => {
  const report = meter.project({
    asOf: '2026-09-13T00:00:00.000Z',
    daysObserved: 10,
    daysInMonth: 30,
    fixedCosts: [
      {
        service: 'aws-lightsail',
        monthlyUsd: 24,
        calibration: 'actual_bill',
        evidenceRef: 'aws-billing/2026-09',
      },
      {
        service: 'cloudflare-base',
        monthlyUsd: 5,
        calibration: 'estimate',
        evidenceRef: 'cloudflare-pricing-reviewed-2026-09-13',
      },
    ],
    variableCosts: [
      {
        provider: 'deepseek',
        usedUnits: 1_000_000,
        unitCostUsd: 0.000001,
        calibration: 'usage_counter',
        evidenceRef: 'deepseek-usage/2026-09-13',
        warnUnits: 8_000_000,
        hardUnits: 10_000_000,
      },
    ],
  });

  assert.deepEqual(report.components, [
    {
      service: 'aws-lightsail',
      kind: 'fixed',
      projectedMonthlyUsd: 24,
      calibration: 'actual_bill',
      evidenceRef: 'aws-billing/2026-09',
    },
    {
      service: 'cloudflare-base',
      kind: 'fixed',
      projectedMonthlyUsd: 5,
      calibration: 'estimate',
      evidenceRef: 'cloudflare-pricing-reviewed-2026-09-13',
    },
    {
      service: 'deepseek',
      kind: 'variable',
      projectedMonthlyUsd: 3,
      calibration: 'usage_counter',
      evidenceRef: 'deepseek-usage/2026-09-13',
    },
  ]);
  assert.equal(report.projectedSpendUsd, 32);
  assert.equal(report.projectedWithReserveUsd, 42);
  assert.equal(report.gate, 'open');
  assert.equal(report.calibration, 'provisional');
  assert.deepEqual(report.providerGates, [
    {
      provider: 'deepseek',
      projectedUnits: 3_000_000,
      warnUnits: 8_000_000,
      hardUnits: 10_000_000,
      gate: 'open',
    },
  ]);
});

test('an actual variable bill calibrates cost while usage still controls provider quota', () => {
  const report = meter.project({
    asOf: '2026-09-13T00:00:00.000Z',
    daysObserved: 10,
    daysInMonth: 30,
    fixedCosts: [],
    variableCosts: [
      {
        provider: 'google-maps',
        usedUnits: 100,
        unitCostUsd: 0.01,
        actualCostUsdToDate: 2,
        calibration: 'actual_bill',
        evidenceRef: 'gcp-billing/2026-09-13',
        warnUnits: 250,
        hardUnits: 350,
      },
    ],
  });

  assert.equal(report.components[0].projectedMonthlyUsd, 6);
  assert.equal(report.providerGates[0].projectedUnits, 300);
  assert.equal(report.providerGates[0].gate, 'warning');
  assert.equal(report.gate, 'warning');
  assert.equal(report.calibration, 'bill_calibrated');
});

test('the 60 USD ceiling includes reserve and every provider hard quota fails closed', () => {
  const overBudget = meter.project({
    asOf: '2026-09-13T00:00:00.000Z',
    daysObserved: 30,
    daysInMonth: 30,
    fixedCosts: [
      {
        service: 'infrastructure',
        monthlyUsd: 51,
        calibration: 'actual_bill',
        evidenceRef: 'billing/export',
      },
    ],
    variableCosts: [],
  });
  assert.equal(overBudget.projectedWithReserveUsd, 61);
  assert.equal(overBudget.gate, 'closed');
  assert.deepEqual(overBudget.reasons, ['monthly_budget_exceeded']);

  const providerBlocked = meter.project({
    asOf: '2026-09-13T00:00:00.000Z',
    daysObserved: 10,
    daysInMonth: 30,
    fixedCosts: [],
    variableCosts: [
      {
        provider: 'foursquare',
        usedUnits: 200,
        unitCostUsd: 0,
        calibration: 'usage_counter',
        evidenceRef: 'foursquare-counter',
        warnUnits: 500,
        hardUnits: 550,
      },
    ],
  });
  assert.equal(providerBlocked.providerGates[0].projectedUnits, 600);
  assert.equal(providerBlocked.providerGates[0].gate, 'closed');
  assert.equal(providerBlocked.gate, 'closed');
  assert.deepEqual(providerBlocked.reasons, [
    'provider_hard_quota_exceeded:foursquare',
  ]);
});

test('invalid or unauditable meter input fails closed', () => {
  const report = meter.project({
    asOf: 'not-a-date',
    daysObserved: 0,
    daysInMonth: 30,
    fixedCosts: [
      {
        service: 'unknown',
        monthlyUsd: -1,
        calibration: 'estimate',
        evidenceRef: '',
      },
    ],
    variableCosts: [],
  });

  assert.equal(report.gate, 'closed');
  assert.deepEqual(report.reasons, ['meter_input_invalid']);
  assert.equal(report.projectedSpendUsd, 0);
});

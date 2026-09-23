import assert from 'node:assert/strict';
import test from 'node:test';
import { D1ProviderUsage } from './d1-provider-usage.ts';

test('D1 provider usage uses an atomic UTC-month micro-USD reservation', async () => {
  const calls = [];
  const usage = new D1ProviderUsage(
    {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values });
            return {
              async run() {
                return { meta: { changes: 1 } };
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
    },
    () => new Date('2026-09-17T12:00:00.000Z'),
  );
  assert.equal(
    await usage.reserve({
      providerId: 'google',
      requests: 1,
      costUsd: 0.005,
      hardRequestLimit: 2,
      hardCostLimitUsd: 0.01,
    }),
    'reserved',
  );
  assert.match(
    calls[0].sql,
    /ON CONFLICT[\s\S]+WHERE request_count \+ 1 <= \?/u,
  );
  assert.deepEqual(calls[0].values, [
    'google',
    '2026-09-01T00:00:00.000Z',
    5000,
    2,
    10000,
  ]);
});

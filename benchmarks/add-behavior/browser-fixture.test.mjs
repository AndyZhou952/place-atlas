import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAddPlan, browserAddScenarios } from './browser-fixture.mjs';

test('controlled Add browser cases keep failure, conflict and retry responses distinct', () => {
  assert.throws(() => browserAddPlan('unknown'), /Unknown/u);
  for (const name of browserAddScenarios) {
    const plan = browserAddPlan(name);
    assert.equal(plan.discover[0].body.sessionVersion, 1);
    assert.equal(plan.cancel[0].body.status, 'cancelled');
  }
  assert.equal(browserAddPlan('retry').confirm[0].status, 503);
  assert.equal(
    browserAddPlan('retry').confirm[1].body.status,
    'committed_verified',
  );
  assert.equal(
    browserAddPlan('conflict').confirm[0].body.newPreview.previewVersion,
    3,
  );
  assert.equal(
    browserAddPlan('unknown-location').select[0].body.preview.locationEvidence
      .status,
    'unknown',
  );
});

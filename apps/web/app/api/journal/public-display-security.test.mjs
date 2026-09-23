import assert from 'node:assert/strict';
import test from 'node:test';

import { failure, success } from '../../../product/application/result.ts';
import { getPlaceAssessmentResponse } from '../items/[id]/personal/get-place-assessment-response.ts';
import {
  getDisplayVisitResponse,
  listDisplayVisitsResponse,
} from './public-visit-responses.ts';

void test('anonymous candidate assessment and Visit detail are 404 while list is a closed empty response', async () => {
  const application = {
    async execute(operation) {
      return operation.key === 'visit.listDisplay'
        ? success([])
        : failure('not_found', 'Owner-only candidate record.');
    },
  };

  const [assessment, visits, visit] = await Promise.all([
    getPlaceAssessmentResponse(application, 'candidate-1'),
    listDisplayVisitsResponse(application),
    getDisplayVisitResponse(application, 'candidate-visit'),
  ]);

  assert.equal(assessment.status, 404);
  assert.equal(await assessment.text(), 'Public resource not found.');
  assert.equal(visits.status, 200);
  assert.deepEqual(await visits.json(), []);
  assert.equal(visit.status, 404);
  assert.equal(await visit.text(), 'Public resource not found.');
});

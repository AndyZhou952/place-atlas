import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeContract,
  scoreCapturedContract,
} from './score-captured-contract.mjs';

const item = {
  id: 'saved',
  kind: 'food',
  verificationStatus: 'verified',
  title: 'Canonical saved title',
  address: 'Saved address',
  tabelog: { url: 'https://example.com/listing' },
};
const gold = {
  schemaVersion: 1,
  datasetId: 'test',
  allowedRouteModes: ['walk'],
  cases: [
    {
      caseId: 'one',
      query: 'food',
      answers: [],
      expected: { status: 'recommend', reasonRequired: true },
    },
  ],
};
const bindings = {
  cases: { one: { scenario: 'live', sourceUrl: item.tabelog.url } },
};
const record = {
  scenario: 'live',
  request: { query: 'food', replies: [] },
  httpStatus: 200,
  response: {
    status: 'recommend',
    recommendations: [
      {
        itemId: item.id,
        detailTargetId: item.id,
        name: item.title,
        address: item.address,
        reason: 'Saved food',
      },
    ],
  },
};
const observations = [{ caseId: 'one', openedDetailId: item.id }];

test('captured contract identity is fixed by the independent catalog, not model output', () => {
  const dataset = materializeContract(gold, bindings, [item]);
  assert.equal(
    scoreCapturedContract(dataset, [record], observations, [item]).passes,
    true,
  );
  const invented = structuredClone(record);
  invented.response.recommendations[0].name = 'Invented title';
  assert.throws(
    () => scoreCapturedContract(dataset, [invented], observations, [item]),
    /Noncanonical/u,
  );
  assert.throws(
    () => materializeContract(gold, bindings, [item, item]),
    /not unique/u,
  );
});

test('missing actual HTTP or browser evidence cannot pass the contract', () => {
  const dataset = materializeContract(gold, bindings, [item]);
  assert.equal(
    scoreCapturedContract(dataset, [], observations, [item]).passes,
    false,
  );
  assert.equal(
    scoreCapturedContract(dataset, [record], [], [item]).passes,
    false,
  );
});

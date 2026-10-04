import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { explicitReservationTiming } from '../../apps/web/agent/reservation-timing.ts';
import { parseTableCheckBookingPage } from '../../apps/web/agent/tablecheck-booking.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./reservation-timing.v1.json', import.meta.url),
    'utf8',
  ),
);

test('controlled booking-window cases require explicit source timing', () => {
  assert.equal(dataset.captureClass, 'synthetic_controlled');
  for (const entry of dataset.cases) {
    assert.deepEqual(
      explicitReservationTiming(entry.sourceText),
      entry.expected,
      entry.id,
    );
  }
});

test('dated booking-page capture retains branch identity and exact month wording', () => {
  const capture = dataset.verifiedPageCapture;
  assert.equal(capture.captureClass, 'independently_verified_web_capture');
  const html = `<title>${capture.branchName} - TableCheck</title>
    <span>【Address】</span><br>${capture.branchAddress}<br>
    ${capture.policyExcerpt}<br>`;
  const parsed = parseTableCheckBookingPage(html, capture.sourceUrl);
  assert.equal(parsed?.booking.name, capture.branchName);
  assert.equal(parsed?.booking.address, capture.branchAddress);
  assert.equal(
    parsed?.booking.bookingWindowLabel,
    'up to two month in advance',
  );
  assert.equal(parsed?.booking.advanceDays, undefined);
});

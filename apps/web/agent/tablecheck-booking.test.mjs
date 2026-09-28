import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTableCheckBookingPage,
  parseTableCheckBookingPage,
  readTableCheckBookingPage,
} from './tablecheck-booking.ts';

const url =
  'https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing';
const html = `<!doctype html><html><head><title>KOFFEE MAMEYA -Kakeru- - TableCheck</title></head><body>
  <div>【Address】</span><br>208 Yeongjonghaeannam-ro, Incheon, Korea<br></div>
  <span data-testid="Processed Markup">【Address】</span><br>Hirano 2-16-14, Koto-ku, Tokyo, Japan<br>
  Reservations can be made up to two month in advance.<br>
  </body></html>`;

test('TableCheck reader accepts only public merchant landing pages', () => {
  assert.equal(isTableCheckBookingPage(url), true);
  for (const candidate of [
    'http://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing',
    'https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing?token=x',
    'https://www.tablecheck.com.evil.example/en/koffee-mameya-kakeru/reserve/landing',
    'https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing/../../admin',
  ])
    assert.equal(isTableCheckBookingPage(candidate), false, candidate);
});

test('TableCheck parser binds policy to the nearest address on the same page', () => {
  const result = parseTableCheckBookingPage(html, url);
  assert.deepEqual(result?.booking, {
    name: 'KOFFEE MAMEYA -Kakeru-',
    address: 'Hirano 2-16-14, Koto-ku, Tokyo, Japan',
    bookingWindowLabel: 'up to two month in advance',
  });
  assert.equal(
    parseTableCheckBookingPage(
      html.replace('two month in advance', 'early'),
      url,
    ),
    undefined,
  );
});

test('TableCheck keeps an explicit release clock alongside its booking window', () => {
  const release = '毎月1日10:00から翌月分の予約受付を開始';
  const result = parseTableCheckBookingPage(
    html.replace(
      'Reservations can be made up to two month in advance.<br>',
      `Reservations can be made up to two month in advance.<br>${release}。<br>`,
    ),
    url,
  );
  assert.equal(
    result?.booking.bookingWindowLabel,
    'up to two month in advance',
  );
  assert.equal(result?.booking.releaseNote, release);
  assert.match(
    result?.content ?? '',
    /毎月1日10:00から翌月分の予約受付を開始/u,
  );
});

test('TableCheck read distinguishes denied, invalid and supported pages', async () => {
  const signal = new AbortController().signal;
  const read = await readTableCheckBookingPage(
    url,
    async () =>
      new Response(html, { headers: { 'content-type': 'text/html' } }),
    signal,
  );
  assert.equal(read.kind, 'read');
  assert.equal(read.evidence.booking.advanceDays, undefined);
  assert.deepEqual(
    await readTableCheckBookingPage(
      url,
      async () => new Response('', { status: 403 }),
      signal,
    ),
    { kind: 'blocked' },
  );
  assert.deepEqual(
    await readTableCheckBookingPage(
      url,
      async () =>
        new Response('<title>Just a moment</title>', {
          headers: { 'content-type': 'text/html' },
        }),
      signal,
    ),
    { kind: 'blocked' },
  );
});

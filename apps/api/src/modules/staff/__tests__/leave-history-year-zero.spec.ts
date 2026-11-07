import { afterAll, beforeAll, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { historyNow, leaveFixture, type LeaveFixture } from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const get = (query: string) =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?${query}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
const cursor = (date: string, asOf = historyNow) =>
  encodeCursor({ date, rank: 1, id: '019a0000-0000-7000-8000-000000000001', as_of: asOf });

// PostgreSQL ما فيهوش سنة صفر، فالتاريخ ده لازم يترفض قبل ما يوصل للـcast.
it.each([
  ['period', 'from=0000-01-01&to=0000-01-02'],
  ['cursor date', `from=2026-10-01&to=2026-10-31&cursor=${cursor('0000-10-05')}`],
  [
    'cursor as_of',
    `from=2026-10-01&to=2026-10-31&cursor=${cursor('2026-10-05', '0000-11-07T10:00:00.000Z')}`,
  ],
])('a year-zero %s is a 400 validation error, never a 500', async (_, query) => {
  const response = await get(query);
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('the earliest legal year still reads the history', async () => {
  expect((await get('from=0001-01-01&to=0001-01-02')).statusCode).toBe(200);
});

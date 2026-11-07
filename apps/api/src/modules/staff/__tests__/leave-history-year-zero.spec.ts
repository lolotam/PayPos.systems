import { afterAll, beforeAll, expect, it } from 'vitest';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import { leaveFixture, type LeaveFixture } from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const period = 'from=2026-10-01&to=2026-10-31';
const get = (query: string) =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?${query}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
// الـas_of بييجي من رد حديث عشان الكيرسر يفضل جوه نافذة الصلاحية؛ لو كان ثابت كان هيترفض
// بعد يوم لانتهاء صلاحيته، ومش هيكشف رجوع عيب سنة صفر.
async function cursorAt(date: string) {
  const { as_of } = (await get(period)).json<{ as_of: string }>();
  return encodeCursor({ date, rank: 1, id: '019a0000-0000-7000-8000-000000000001', as_of });
}

// PostgreSQL ما فيهوش سنة صفر، فالتاريخ ده لازم يترفض قبل ما يوصل للـcast.
it('a year-zero period is a 400 validation error, never a 500', async () => {
  const response = await get('from=0000-01-01&to=0000-01-02');
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
});
it('the earliest legal year still reads the history', async () => {
  expect((await get('from=0001-01-01&to=0001-01-02')).statusCode).toBe(200);
});
it('a fresh cursor with a year-zero date is a 400, and the same cursor with a legal date is a 200', async () => {
  const refused = await get(`${period}&cursor=${await cursorAt('0000-10-05')}`);
  expect(refused.statusCode).toBe(400);
  expect(refused.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect((await get(`${period}&cursor=${await cursorAt('2026-10-05')}`)).statusCode).toBe(200);
});

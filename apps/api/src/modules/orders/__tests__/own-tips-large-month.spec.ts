import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownWorkReads } from '../orders.module.ts';
import { readOwnTips } from '../queries/own-tips.query.ts';
import { phone } from '../../../../test/staff-otp-harness.ts';
import {
  must,
  recordVisit,
  runTips,
  tip,
  tipFixture,
  tipInput,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
let cookie: string;
const origin = 'http://localhost:5173';
const now = new Date('2026-10-15T08:00:00Z');
beforeAll(async () => {
  f = await tipFixture({
    personalOrigin: origin,
    clock: { now: () => now },
    ordersClock: { now: () => now },
  });
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${f.ownerId}`;
  await f.h
    .owner`UPDATE "user" SET phone_binding_approved_at=${new Date(now.getTime() - 60_000).toISOString()}
    WHERE id=${f.ownerId}`;
  cookie =
    (
      await f.h.auth.personal.issue(
        f.ownerId,
        { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  expect(await f.h.auth.personal.resolve(new Headers({ cookie }))).not.toBeNull();
});
afterAll(async () => {
  await f?.close();
});
const request = () =>
  f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/tips?month=2026-10',
    headers: { cookie, origin },
  });

it('returns exact larger monthly totals from valid visits through DB and HTTP, then hides them', async () => {
  for (const method of ['CASH', 'CARD'] as const) {
    for (let visit = 0; visit < 2; visit++) {
      const recorded = await recordVisit(f);
      await runTips(f, recorded.sessionId, tipInput([tip(f, 0, method, '50000000000.000')]));
    }
    const expected = {
      month: '2026-10',
      status: 'VISIBLE',
      total_cash: '100000000000.000',
      total_card: method === 'CASH' ? '0.000' : '100000000000.000',
    };
    expect(
      await f.db.withTenant(f.company, (tx) =>
        readOwnTips(
          tx,
          { companyId: f.company, businessId: f.business, userId: f.ownerId },
          { month: '2026-10' },
          now,
          ownWorkReads,
        ),
      ),
    ).toEqual(expected);
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(expected);
  }
  await f.h.owner`INSERT INTO business_settings(company_id,business_id,staff_columns)
    VALUES(${f.company},${f.business},ARRAY[]::text[])
    ON CONFLICT(company_id,business_id) DO UPDATE SET staff_columns=excluded.staff_columns`;
  const hidden = await request();
  expect(hidden.statusCode).toBe(200);
  expect(hidden.headers['cache-control']).toBe('no-store');
  expect(hidden.json()).toEqual({ month: '2026-10', status: 'HIDDEN' });
}, 60_000);

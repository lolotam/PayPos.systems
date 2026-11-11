import { afterAll, beforeAll, expect, it } from 'vitest';
import { leaveHistoryPage } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import {
  historyLeave,
  historyShift,
  leaveFixture,
  type LeaveFixture,
} from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const url = () =>
  `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?from=2026-01-01&to=2026-10-31`;
const get = (suffix = '', company = f.company) =>
  f.h.app.inject({
    method: 'GET',
    url: url() + suffix,
    headers: { cookie: f.cookie, 'x-company-id': company },
  });
it('route returns leave and absence variants with employee number and validates single/multiple HTTP filter values', async () => {
  await historyLeave(f, '2026-10-01', { type: 'SICK' });
  await historyShift(f, '2026-10-02');
  const response = await get();
  expect(response.statusCode).toBe(200);
  const page = leaveHistoryPage.parse(response.json());
  expect(page.items.map((r) => r.row_type)).toEqual(['UNEXCUSED_ABSENCE', 'LEAVE']);
  expect(page.items.every((r) => Number.isInteger(r.employee_number))).toBe(true);
  const sick = await get('&types[]=SICK');
  expect(sick.statusCode).toBe(200);
  expect(leaveHistoryPage.parse(sick.json()).items.map((r) => r.row_type)).toEqual(['LEAVE']);
  const absent = await get('&types[]=UNEXCUSED_ABSENCE&statuses[]=ABSENT');
  expect(absent.statusCode).toBe(200);
  expect(leaveHistoryPage.parse(absent.json()).items.map((r) => r.row_type)).toEqual([
    'UNEXCUSED_ABSENCE',
  ]);
  const both = await get('&types[]=SICK&types[]=UNEXCUSED_ABSENCE');
  expect(both.statusCode).toBe(200);
  expect(leaveHistoryPage.parse(both.json()).items).toHaveLength(2);
});
it('route refuses malformed cursor, excessive range, unknown filters and another tenant', async () => {
  for (const suffix of ['&cursor=bad', '&statuses[]=UNKNOWN', '&unexpected=true']) {
    const response = await get(suffix);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_FAILED');
  }
  const range = await f.h.app.inject({
    method: 'GET',
    url: url().replace('to=2026-10-31', 'to=2027-10-31'),
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect(range.statusCode).toBe(400);
  expect(range.json().details).toContainEqual({ path: ['to'], code: 'custom' });
  expect((await get('', f.otherCompany)).statusCode).toBe(404);
});
it('feature off is FEATURE_DISABLED and a cashier without read permission gets 404', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
  expect((await get()).json().code).toBe('FEATURE_DISABLED');
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`UPDATE memberships SET role_id=${cashier?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  expect((await get()).statusCode).toBe(404);
});

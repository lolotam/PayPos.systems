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
  await historyLeave(f, '2026-10-01', { type: 'SICK' });
  await historyShift(f, '2026-10-02');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const reportUrl = () => `/v1/businesses/${f.business}/leave-history?from=2026-01-01&to=2026-10-31`;
const get = (suffix = '', company = f.company) =>
  f.h.app.inject({
    method: 'GET',
    url: reportUrl() + suffix,
    headers: { cookie: f.cookie, 'x-company-id': company },
  });

it('route returns 200 with valid LeaveHistoryPage with and without employee_id', async () => {
  const withoutEmp = await get();
  expect(withoutEmp.statusCode).toBe(200);
  const pageWithout = leaveHistoryPage.parse(withoutEmp.json());
  expect(pageWithout.last_taken).toBeNull();
  expect(pageWithout.items.length).toBeGreaterThan(0);

  const withEmp = await get(`&employee_id=${f.employee.id}`);
  expect(withEmp.statusCode).toBe(200);
  const pageWith = leaveHistoryPage.parse(withEmp.json());
  expect(pageWith.last_taken).not.toBeNull();
});

it('route returns 400 VALIDATION_FAILED for invalid cursor, unknown keys, invalid employee and range overflow', async () => {
  const badCursor = await get('&cursor=bad');
  expect(badCursor.statusCode).toBe(400);
  expect(badCursor.json().code).toBe('VALIDATION_FAILED');
  expect(badCursor.json().details).toContainEqual(expect.objectContaining({ path: ['cursor'] }));

  const unknownKey = await get('&unknown_param=123');
  expect(unknownKey.statusCode).toBe(400);
  expect(unknownKey.json().code).toBe('VALIDATION_FAILED');

  const invalidEmp = await get('&employee_id=not-a-valid-uuid');
  expect(invalidEmp.statusCode).toBe(400);
  expect(invalidEmp.json().code).toBe('VALIDATION_FAILED');

  const overflow = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/leave-history?from=2026-01-01&to=2027-01-03`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect(overflow.statusCode).toBe(400);
  expect(overflow.json().code).toBe('VALIDATION_FAILED');
  expect(overflow.json().details).toContainEqual(expect.objectContaining({ path: ['to'] }));
});

it('route returns 404 for foreign company, cashier without permission, and FEATURE_DISABLED when off', async () => {
  expect((await get('', f.otherCompany)).statusCode).toBe(404);

  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
  expect((await get()).json().code).toBe('FEATURE_DISABLED');
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;

  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`UPDATE memberships SET role_id=${cashier?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    expect((await get()).statusCode).toBe(404);
  } finally {
    const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
    await f.h
      .owner`UPDATE memberships SET role_id=${manager?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});

it('employee tab route still refuses employee_id in query with 400', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-history?from=2026-01-01&to=2026-10-31&employee_id=${f.employee.id}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().code).toBe('VALIDATION_FAILED');
});

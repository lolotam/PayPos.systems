import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  schedulesFixture,
  scheduleIds,
  setWeek,
  testWeek,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
beforeAll(async () => {
  f = await schedulesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const route = (branch: string) => `/v1/businesses/${f.business}/branches/${branch}/schedules`;
const headers = () => ({ cookie: f.cookie, 'x-company-id': f.company });
it('serves generated HTTP contracts and maps optimistic conflict to named 409', async () => {
  const payload = {
    week_start: testWeek,
    expected_revision: 0,
    shifts: [{ day: 0, start: '09:00', end: '13:00' }],
    reason: 'Synthetic HTTP edit',
  };
  const first = await f.h.app.inject({
    method: 'PUT',
    url: `${route(f.branch)}/${f.employee.id}`,
    headers: headers(),
    payload,
  });
  expect(first.statusCode).toBe(200);
  const repeat = await f.h.app.inject({
    method: 'PUT',
    url: `${route(f.branch)}/${f.employee.id}`,
    headers: headers(),
    payload,
  });
  expect(repeat.statusCode).toBe(409);
  expect(repeat.json()).toMatchObject({
    code: 'SCHEDULE_REVISION_CONFLICT',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  const read = await f.h.app.inject({
    method: 'GET',
    url: `${route(f.branch)}?week_start=${testWeek}`,
    headers: headers(),
  });
  expect(read.statusCode).toBe(200);
  expect(read.json().items[0].schedule.id).toBe(first.json().id);
});
it('uses effective branch timezone with business fallback', async () => {
  await f.h.owner`UPDATE businesses SET timezone='Asia/Dubai' WHERE id=${f.business}`;
  const fallback = await setWeek(f, [{ day: 0, start: '09:00', end: '13:00' }], {
    week: '2026-10-17',
  });
  expect(fallback.timezone).toBe('Asia/Dubai');
  expect(fallback.shifts[0]?.starts_at).toBe('2026-10-17T05:00:00.000Z');
  await f.h.owner`UPDATE branches SET timezone='Asia/Kuwait' WHERE id=${f.branch}`;
  expect((await setWeek(f, [], { week: '2026-10-24' })).timezone).toBe('Asia/Kuwait');
});
it('foreign-business, foreign-company and unknown branches have identical refusals', async () => {
  const bodies = [];
  for (const branch of [f.otherBranch, f.foreignBranch, scheduleIds.newId()]) {
    const result = await f.h.app.inject({
      method: 'GET',
      url: `${route(branch)}?week_start=${testWeek}`,
      headers: headers(),
    });
    expect(result.statusCode).toBe(404);
    bodies.push(result.json());
  }
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[1]).toEqual(bodies[2]);
});
it('DENY wins for reads and management and disabled staff refuses authorised callers', async () => {
  for (const code of ['read:schedules:branch', 'manage:schedules:branch'])
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${scheduleIds.newId()},${f.memberId},${code},'DENY','BRANCH',${f.branch},'Synthetic deny',${f.userId})`;
  const denied = await f.h.app.inject({
    method: 'GET',
    url: `${route(f.branch)}?week_start=${testWeek}`,
    headers: headers(),
  });
  expect(denied.statusCode).toBe(403);
  await expect(setWeek(f, [], { week: '2026-10-31' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND permission_code LIKE '%:schedules:%'`;
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'staff',false,'Synthetic feature denial',${f.userId}) ON CONFLICT(company_id,flag) DO UPDATE SET enabled=false`;
  await expect(setWeek(f, [], { week: '2026-10-31' })).rejects.toMatchObject({
    code: 'FEATURE_DISABLED',
  });
});

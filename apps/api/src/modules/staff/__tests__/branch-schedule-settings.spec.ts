import { createScheduleSettingsTransactions } from '../persistence/schedule-settings.adapter.ts';
import { SetBranchScheduleSettingsUseCase } from '../use-cases/set-branch-schedule-settings/set-branch-schedule-settings.usecase.ts';
import { OWNER_ROLE_ID } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  scheduleActor,
  scheduleIds,
  schedulesFixture,
  setWeek,
  type SchedulesFixture,
} from './schedules.fixture.ts';

let f: SchedulesFixture;
let cookie: string;
let ownerId: string;
const four = Array.from({ length: 4 }, (_, i) => ({
  day: 5,
  start: `0${i * 2}:00`,
  end: `0${i * 2 + 1}:00`,
}));
beforeAll(async () => {
  f = await schedulesFixture();
  cookie = await f.h.signedInOperator('branch-settings-owner@example.test');
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='branch-settings-owner@example.test'`;
  ownerId = owner?.['id'] as string;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${scheduleIds.newId()},${ownerId},${OWNER_ROLE_ID},'global','COMPANY',${f.company})`;
});
beforeEach(async () => {
  await f.h.owner`DELETE FROM staff_branch_schedule_settings`;
  await f.h.owner`DELETE FROM staff_schedule_settings`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const request = (
  method: 'PUT' | 'DELETE',
  branch = f.branch,
  value = 4,
  auth = cookie,
  business = f.business,
) =>
  f.h.app.inject({
    method,
    url: `/v1/businesses/${business}/branches/${branch}/schedule-settings`,
    headers: { cookie: auth, 'x-company-id': f.company },
    ...(method === 'PUT' ? { payload: { max_shifts_per_day: value } } : {}),
  });
const set = async (branch: string, value: number) => {
  const response = await request('PUT', branch, value);
  expect(response.statusCode).toBe(200);
  return response.json();
};
const businessLimit = (value: number) =>
  f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/schedule-settings`,
    headers: { cookie, 'x-company-id': f.company },
    payload: { max_shifts_per_day: value },
  });
const settings = async () =>
  (
    await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/schedule-settings`,
      headers: { cookie, 'x-company-id': f.company },
    })
  ).json();
const audits = () => f.h.owner`SELECT actor_user_id,entity_id,action,"before","after" FROM audit_log
  WHERE entity='staff_branch_schedule_settings' ORDER BY at,id`;

it('MB-01/02: saves each branch at its own limit and inherits business then default', async () => {
  await set(f.branch, 4);
  await set(f.secondBranch, 2);
  expect((await setWeek(f, four)).shifts).toHaveLength(4);
  await expect(setWeek(f, four.slice(0, 3), { branch: f.secondBranch })).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 2, working_dates: ['2026-10-08'] },
  });
  expect((await request('DELETE', f.secondBranch)).json()).toMatchObject({
    max_shifts_per_day: 3,
    source: 'default',
    updated_at: null,
  });
  expect((await businessLimit(2)).statusCode).toBe(200);
  expect((await request('DELETE', f.secondBranch)).json()).toMatchObject({
    max_shifts_per_day: 2,
    source: 'business',
    updated_at: null,
  });
});
it('MB-03: counts branch-local shifts while refusing cross-branch overlap', async () => {
  await set(f.branch, 2);
  await set(f.secondBranch, 4);
  const week = '2027-01-02';
  await setWeek(f, four.slice(0, 2), { branch: f.secondBranch, week });
  expect((await setWeek(f, four.slice(2, 3), { week })).shifts).toHaveLength(1);
  await expect(setWeek(f, four.slice(0, 1), { week, revision: 1 })).rejects.toMatchObject({
    code: 'SCHEDULE_SHIFT_OVERLAP',
  });
  await expect(
    setWeek(f, [...four.slice(2), { day: 5, start: '08:00', end: '09:00' }], { week, revision: 1 }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_DAY_LIMIT_EXCEEDED' });
});
it('MB-04: audits own-value changes and clear once; no-ops keep timestamps and audit count', async () => {
  const before = (await audits()).length;
  const own = await set(f.branch, 3);
  expect(own).toMatchObject({ branch_id: f.branch, source: 'branch', max_shifts_per_day: 3 });
  expect(await set(f.branch, 3)).toEqual(own);
  await set(f.branch, 4);
  expect((await request('DELETE')).json()).toMatchObject({
    source: 'default',
    max_shifts_per_day: 3,
    updated_at: null,
  });
  await request('DELETE');
  const changes = (await audits()).slice(before);
  expect(changes).toEqual([
    {
      actor_user_id: ownerId,
      entity_id: f.branch,
      action: 'updated',
      before: { branch_id: f.branch, max_shifts_per_day: null, source: 'default' },
      after: { branch_id: f.branch, max_shifts_per_day: 3, source: 'branch' },
    },
    {
      actor_user_id: ownerId,
      entity_id: f.branch,
      action: 'updated',
      before: { branch_id: f.branch, max_shifts_per_day: 3, source: 'branch' },
      after: { branch_id: f.branch, max_shifts_per_day: 4, source: 'branch' },
    },
    {
      actor_user_id: ownerId,
      entity_id: f.branch,
      action: 'deleted',
      before: { branch_id: f.branch, max_shifts_per_day: 4, source: 'branch' },
      after: { branch_id: f.branch, max_shifts_per_day: null, source: 'default' },
    },
  ]);
});
it('MB-05: refuses non-holders and accepts an owner-granted person', async () => {
  expect((await request('PUT', f.branch, 4, f.cookie)).statusCode).toBe(404);
  expect((await request('DELETE', f.branch, 4, f.cookie)).statusCode).toBe(404);
  const granted = await f.h.app.inject({
    method: 'POST',
    url: `/v1/permissions/memberships/${f.memberId}/overrides`,
    headers: { cookie, 'x-company-id': f.company },
    payload: {
      permission_code: 'manage:schedule-settings:business',
      effect: 'ALLOW',
      scope_type: 'BUSINESS',
      scope_id: f.business,
      reason: 'Synthetic branch settings grant',
      expires_at: null,
    },
  });
  expect(granted.statusCode).toBe(201);
  expect((await request('PUT', f.branch, 4, f.cookie)).statusCode).toBe(200);
  expect((await request('DELETE', f.branch, 4, f.cookie)).statusCode).toBe(200);
});
it('MB-06: lowering preserves stored rows and checks changed days only', async () => {
  await set(f.branch, 4);
  const week = '2027-02-06';
  await setWeek(f, four, { week });
  const before = await f.h.owner`SELECT * FROM staff_schedule_shifts ORDER BY id`;
  await set(f.branch, 2);
  expect(await f.h.owner`SELECT * FROM staff_schedule_shifts ORDER BY id`).toEqual(before);
  const saturday = { day: 0, start: '09:00', end: '10:00' };
  await setWeek(f, [...four, saturday], { week, revision: 1 });
  await expect(
    setWeek(f, [...four.map((s) => ({ ...s, end: s.end.replace(':00', ':30') })), saturday], {
      week,
      revision: 2,
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_DAY_LIMIT_EXCEEDED' });
});
it('MB-07: saves templates at the active maximum and checks the target before writing', async () => {
  await set(f.branch, 2);
  await set(f.secondBranch, 4);
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic branch maximum', shifts: four },
  });
  const apply = (branch: string) =>
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: {
        branch_id: branch,
        employee_ids: [f.employee.id],
        weeks: ['2027-03-06'],
        replace: false,
      },
    });
  await expect(apply(f.branch)).rejects.toMatchObject({ code: 'SCHEDULE_DAY_LIMIT_EXCEEDED' });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2027-03-06'`,
  ).toHaveLength(0);
  expect((await apply(f.secondBranch)).schedules[0]?.shifts).toHaveLength(4);
  await set(f.secondBranch, 2);
  await expect(
    f.createTemplate.execute({
      ...scheduleActor(f),
      input: { name_en: 'Synthetic too many', shifts: four.slice(0, 3) },
    }),
  ).rejects.toMatchObject({ details: { max_shifts_per_day: 2, days: [5] } });
  await f.updateTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: { name_en: 'Synthetic renamed', shifts: four, expected_revision: 1 },
  });
});
it.each([0, 5, 2.5])('MB-09: rejects invalid value %s', async (value) => {
  expect((await request('PUT', f.branch, value)).json()).toMatchObject({
    code: 'VALIDATION_FAILED',
  });
});
it('MB-10: lists sorted active branches and business changes affect inherited values only', async () => {
  await set(f.branch, 4);
  await businessLimit(2);
  const result = await settings();
  expect(result).toMatchObject({
    business_id: f.business,
    max_shifts_per_day: 2,
    is_default: false,
  });
  expect(result.branches).toEqual([
    expect.objectContaining({ branch_id: f.branch, max_shifts_per_day: 4, source: 'branch' }),
    { branch_id: f.secondBranch, max_shifts_per_day: 2, source: 'business', updated_at: null },
  ]);
  expect(result.branches.map((b: { branch_id: string }) => b.branch_id)).toEqual(
    [f.branch, f.secondBranch].sort(),
  );
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  try {
    expect((await settings()).branches).toHaveLength(1);
    expect((await request('PUT', f.secondBranch)).statusCode).toBe(404);
    expect((await request('DELETE', f.secondBranch)).statusCode).toBe(404);
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  }
  expect((await request('PUT', f.branch, 4, cookie, f.secondBusiness)).statusCode).toBe(404);
  expect((await request('DELETE', f.otherCompany)).statusCode).toBe(404);
});

it('MB-08: a save waits for a branch lower and reads the committed limit', async () => {
  await set(f.branch, 4);
  let locked!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transactions = createScheduleSettingsTransactions(f.db, scheduleIds);
  const lower = new SetBranchScheduleSettingsUseCase(
    {
      run: (actor, work) =>
        transactions.run(actor, (scope) =>
          work({
            ...scope,
            branchSettings: async (businessId, branchId) => {
              const before = await scope.branchSettings(businessId, branchId);
              locked();
              await hold;
              return before;
            },
          }),
        ),
    },
    f.clock,
  );
  const lowering = lower.execute({
    ...scheduleActor(f),
    userId: ownerId,
    branchId: f.branch,
    input: { max_shifts_per_day: 2 },
  });
  await ready;
  const saving = setWeek(f, four, { week: '2027-06-05' });
  const refusal = expect(saving).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 2 },
  });
  try {
    await expect
      .poll(
        async () =>
          (
            await f.h.owner`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
      AND query LIKE '%companies%FOR NO KEY UPDATE%'`
          ).length,
      )
      .toBe(1);
  } finally {
    release();
  }
  await lowering;
  await refusal;
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2027-06-05'`,
  ).toHaveLength(0);
});
it('MB-05: an approved device cannot set or clear branch settings', async () => {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie,
    company: f.company,
  });
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic schedule device' },
  });
  const device = registered.json<{ device_id: string; company_id: string; claim_secret: string }>();
  await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie,
    company: f.company,
  });
  const claim = await f.h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expect(claim.statusCode).toBe(200);
  const token = claim.json<{ device_token: string }>().device_token;
  for (const method of ['PUT', 'DELETE'] as const) {
    const response = await f.h.app.inject({
      method,
      url: `/v1/businesses/${f.business}/branches/${f.branch}/schedule-settings`,
      headers: { authorization: `Device ${token}`, 'x-company-id': f.company },
      ...(method === 'PUT' ? { payload: { max_shifts_per_day: 4 } } : {}),
    });
    expect(response.statusCode).toBe(403);
  }
});

it('rolls back a branch change when its audit insert fails', async () => {
  await set(f.branch, 2);
  const before = await settings();
  const auditBefore = await audits();
  await f.h.owner`REVOKE INSERT ON audit_log FROM pospay_app`;
  try {
    const setter = new SetBranchScheduleSettingsUseCase(
      createScheduleSettingsTransactions(f.db, scheduleIds),
      f.clock,
    );
    await expect(
      setter.execute({
        ...scheduleActor(f),
        userId: ownerId,
        branchId: f.branch,
        input: { max_shifts_per_day: 4 },
      }),
    ).rejects.toThrow('SCHEDULE_PERSISTENCE_FAILED');
  } finally {
    await f.h.owner`GRANT INSERT ON audit_log TO pospay_app`;
  }
  expect(await settings()).toEqual(before);
  expect(await audits()).toEqual(auditBefore);
});

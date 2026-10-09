import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { scheduleIds } from './schedules.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { scheduleSettings } from '@pospay/contracts';
import {
  schedulesFixture,
  scheduleActor,
  setWeek,
  type SchedulesFixture,
} from './schedules.fixture.ts';
import { createScheduleSettingsTransactions } from '../persistence/schedule-settings.adapter.ts';
import { SetScheduleSettingsUseCase } from '../use-cases/set-schedule-settings/set-schedule-settings.usecase.ts';

let f: SchedulesFixture;
let ownerCookie: string;
let ownerId: string;
const four = [
  { day: 5, start: '00:00', end: '01:00' },
  { day: 5, start: '02:00', end: '03:00' },
  { day: 5, start: '04:00', end: '05:00' },
  { day: 5, start: '06:00', end: '07:00' },
];
beforeAll(async () => {
  f = await schedulesFixture();
  ownerCookie = await f.h.signedInOperator('schedule-settings-owner@example.test');
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='schedule-settings-owner@example.test'`;
  ownerId = owner?.['id'] as string;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id) VALUES(${f.company},${scheduleIds.newId()},${owner?.['id'] as string},${OWNER_ROLE_ID},'global','COMPANY',${f.company})`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const request = (
  method: 'GET' | 'PUT',
  payload?: object,
  cookie = ownerCookie,
  business = f.business,
) =>
  f.h.app.inject({
    method,
    url: `/v1/businesses/${business}/schedule-settings`,
    headers: { cookie, 'x-company-id': f.company },
    ...(payload ? { payload } : {}),
  });
async function limit(value: number) {
  const response = await request('PUT', { max_shifts_per_day: value });
  expect(response.statusCode).toBe(200);
  return scheduleSettings.parse(response.json());
}
const audits = () =>
  f.h
    .owner`SELECT actor_user_id,"before","after" FROM audit_log WHERE entity='staff_schedule_settings' ORDER BY at,id`;

it('MS-01: default three saves, fourth refuses atomically with date details', async () => {
  const before = await setWeek(f, four.slice(0, 3));
  await expect(setWeek(f, four, { revision: 1 })).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 3, working_dates: ['2026-10-08'] },
  });
  expect(await f.h.owner`SELECT revision FROM staff_schedules WHERE id=${before.id}`).toEqual([
    { revision: 1 },
  ]);
  await expect(setWeek(f, four.slice(2), { branch: f.secondBranch })).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
  });
});
it('MS-02/03: default reads, no-op stays default, changes audit once with actor', async () => {
  expect(scheduleSettings.parse((await request('GET')).json())).toEqual({
    business_id: f.business,
    max_shifts_per_day: 3,
    is_default: true,
    updated_at: null,
  });
  await limit(3);
  expect(await audits()).toHaveLength(0);
  expect((await limit(4)).is_default).toBe(false);
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='schedule-settings-owner@example.test'`;
  expect(await audits()).toEqual([
    expect.objectContaining({
      actor_user_id: owner?.['id'],
      before: { max_shifts_per_day: 3, is_default: true },
      after: { max_shifts_per_day: 4 },
    }),
  ]);
  const saved = await setWeek(f, four, { revision: 1 });
  expect(saved.shifts).toHaveLength(4);
  const settings = await limit(4);
  expect(await limit(4)).toEqual(settings);
  expect(await audits()).toHaveLength(1);
  expect(
    scheduleSettings.parse((await request('GET', undefined, ownerCookie, f.secondBusiness)).json())
      .max_shifts_per_day,
  ).toBe(3);
});
it('MS-04: manager refused, owner grants personally, non-owner cannot grant onward', async () => {
  expect((await request('PUT', { max_shifts_per_day: 4 }, f.cookie)).statusCode).toBe(403);
  expect((await request('GET', undefined, f.cookie)).statusCode).toBe(403);
  const grantPath = `/v1/permissions/memberships/${f.memberId}/overrides`;
  const terms = {
    permission_code: 'manage:schedule-settings:business',
    effect: 'ALLOW',
    scope_type: 'BUSINESS',
    scope_id: f.business,
    reason: 'Synthetic settings grant',
    expires_at: null,
  };
  const grant = await f.h.app.inject({
    method: 'POST',
    url: grantPath,
    headers: { cookie: ownerCookie, 'x-company-id': f.company },
    payload: terms,
  });
  expect(grant.statusCode).toBe(201);
  expect((await request('PUT', { max_shifts_per_day: 4 }, f.cookie)).statusCode).toBe(200);
  await f.h.app.inject({
    method: 'POST',
    url: grantPath,
    headers: { cookie: ownerCookie, 'x-company-id': f.company },
    payload: { ...terms, permission_code: 'manage:memberships:business' },
  });
  await f.h.signedInOperator('schedule-settings-target@example.test');
  const [targetUser] = await f.h
    .owner`SELECT id FROM "user" WHERE email='schedule-settings-target@example.test'`;
  const targetId = scheduleIds.newId();
  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id) VALUES(${f.company},${targetId},${targetUser?.['id'] as string},${cashier?.id as string},'global','BUSINESS',${f.business})`;
  const denied = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/permissions/memberships/${targetId}/overrides`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: terms,
  });
  expect(denied.json()).toMatchObject({ code: 'PERMISSION_OWNER_ONLY' });
});
it('MS-05: lowering preserves history; unrelated day edit passes, excess day edit fails', async () => {
  const prior = await f.h.owner`SELECT * FROM staff_schedule_shifts ORDER BY id`;
  await limit(3);
  expect(await f.h.owner`SELECT * FROM staff_schedule_shifts ORDER BY id`).toEqual(prior);
  const saturday = { day: 0, start: '09:00', end: '10:00' };
  expect((await setWeek(f, [...four, saturday], { revision: 2 })).shifts).toHaveLength(5);
  await expect(
    setWeek(f, [...four.map((s) => ({ ...s, end: s.end.replace(':00', ':30') })), saturday], {
      revision: 3,
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_DAY_LIMIT_EXCEEDED' });
  expect((await setWeek(f, four.slice(0, 3), { revision: 3 })).shifts).toHaveLength(3);
});
it('MS-06: excess templates allow name-only edits but reject changed days and apply before writing', async () => {
  await limit(4);
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic four shifts', shifts: four },
  });
  await limit(3);
  await f.updateTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: { name_en: 'Synthetic renamed', shifts: four, expected_revision: 1 },
  });
  await expect(
    f.updateTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: {
        name_en: 'Synthetic renamed',
        shifts: four.map((s) => ({ ...s, end: s.end.replace(':00', ':30') })),
        expected_revision: 2,
      },
    }),
  ).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 3, days: [5] },
  });
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: {
        branch_id: f.branch,
        employee_ids: [f.employee.id],
        weeks: ['2027-01-02'],
        replace: false,
      },
    }),
  ).rejects.toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 3, working_dates: ['2027-01-07'] },
  });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2027-01-02'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE entity='staff_schedule' AND "after"->>'week_start'='2027-01-02'`,
  ).toHaveLength(0);
});
it('MS-08: Eid spans two weeks, touching shifts accepted, a 24h shift refused', async () => {
  const first = await setWeek(
    f,
    [
      { day: 5, start: '08:00', end: '00:00' },
      { day: 6, start: '03:00', end: '19:00' },
      { day: 6, start: '21:00', end: '13:00' },
    ],
    { week: '2027-02-06' },
  );
  const second = await setWeek(f, [{ day: 0, start: '16:00', end: '08:00' }], {
    week: '2027-02-13',
  });
  expect(first.shifts[2]?.working_date).toBe('2027-02-12');
  expect(second.shifts).toHaveLength(1);
  await expect(
    setWeek(f, [{ day: 5, start: '08:00', end: '08:00' }], { week: '2027-03-06' }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_SHIFT_INVALID' });
  await expect(
    setWeek(
      f,
      [
        { day: 6, start: '03:00', end: '19:00' },
        { day: 6, start: '19:00', end: '11:00' },
      ],
      { week: '2027-03-06' },
    ),
  ).resolves.toBeDefined();
});
it.each([0, 5, 2.5])('MS-09: invalid value %s is a bilingual 400', async (value) => {
  const response = await request('PUT', { max_shifts_per_day: value });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({
    code: 'VALIDATION_FAILED',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});
it('rejects extra keys and hides unknown and foreign businesses alike', async () => {
  expect((await request('PUT', { max_shifts_per_day: 3, extra: true })).statusCode).toBe(400);
  const unknown = await request('GET', undefined, ownerCookie, f.otherCompany);
  const [foreign] = await f.h.owner`SELECT id FROM businesses WHERE company_id=${f.otherCompany}`;
  const hidden = await request('GET', undefined, ownerCookie, foreign?.['id'] as string);
  expect(unknown.statusCode).toBe(404);
  expect(hidden.json()).toEqual(unknown.json());
});
it('MS-07: a save waiting behind a committed lower reads the new limit', async () => {
  await limit(4);
  let locked!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transactions = createScheduleSettingsTransactions(f.db, scheduleIds);
  const lower = new SetScheduleSettingsUseCase(
    {
      run: (actor, work) =>
        transactions.run(actor, (scope) =>
          work({
            ...scope,
            settings: async (businessId) => {
              const before = await scope.settings(businessId);
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
    input: { max_shifts_per_day: 3 },
  });
  await ready;
  const saving = setWeek(f, four, { week: '2027-04-03' });
  const refusal = expect(saving).rejects.toMatchObject({ code: 'SCHEDULE_DAY_LIMIT_EXCEEDED' });
  try {
    await expect.poll(async () => {
      const waiting = await f.h.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%companies%FOR NO KEY UPDATE%'`;
      return waiting.length;
    }).toBe(1);
  } finally {
    release();
  }
  await lowering;
  await refusal;
  expect((await audits()).at(-1)).toMatchObject({
    before: { max_shifts_per_day: 4, is_default: false },
    after: { max_shifts_per_day: 3 },
  });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2027-04-03'`,
  ).toHaveLength(0);
});
it('returns the named bilingual 422 for schedule and template limits over HTTP', async () => {
  const headers = { cookie: f.cookie, 'x-company-id': f.company };
  const schedule = await f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/branches/${f.branch}/schedules/${f.employee.id}`,
    headers,
    payload: { week_start: '2027-05-01', shifts: four, expected_revision: 0 },
  });
  expect(schedule.statusCode).toBe(422);
  expect(schedule.json()).toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    message_ar: expect.any(String),
    message_en: expect.any(String),
    details: { max_shifts_per_day: 3, working_dates: ['2027-05-06'] },
  });
  const template = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/shift-templates`,
    headers,
    payload: { name_en: 'Synthetic rejected template', shifts: four },
  });
  expect(template.statusCode).toBe(422);
  expect(template.json()).toMatchObject({
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 3, days: [5] },
  });
});
it('rolls back the setting when audit fails and refuses reads/writes with staff disabled', async () => {
  const before = (await request('GET')).json();
  const auditBefore = await audits();
  await f.h.owner`REVOKE INSERT ON audit_log FROM pospay_app`;
  try {
    const setter = new SetScheduleSettingsUseCase(
      createScheduleSettingsTransactions(f.db, scheduleIds),
      f.clock,
    );
    await expect(
      setter.execute({ ...scheduleActor(f), userId: ownerId, input: { max_shifts_per_day: 4 } }),
    ).rejects.toThrow('SCHEDULE_PERSISTENCE_FAILED');
  } finally {
    await f.h.owner`GRANT INSERT ON audit_log TO pospay_app`;
  }
  expect((await request('GET')).json()).toEqual(before);
  expect(await audits()).toEqual(auditBefore);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'staff',false,'Synthetic feature denial',${f.userId}) ON CONFLICT(company_id,flag) DO UPDATE SET enabled=false`;
  for (const method of ['GET', 'PUT'] as const)
    expect(
      (await request(method, method === 'PUT' ? { max_shifts_per_day: 4 } : undefined)).json(),
    ).toMatchObject({ code: 'FEATURE_DISABLED' });
  expect(await audits()).toEqual(auditBefore);
});

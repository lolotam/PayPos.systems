import { pushRecipient } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ROLE, SHIFT_END, SHIFT_START, type Tenant } from './not-clocked-in.fixture.ts';
import { BREAK_OUT, MORNING_IN } from './break-not-returned.fixture.ts';
import {
  ENDS_SOON_BEFORE,
  ENDS_SOON_LATE_AT,
  ENDS_SOON_REMIND_AT,
  shiftEndingSoonFixture,
  type ShiftEndingSoonFixture,
} from './shift-ending-soon.fixture.ts';

let f: ShiftEndingSoonFixture;
beforeAll(async () => {
  f = await shiftEndingSoonFixture();
});
afterAll(async () => {
  await f?.close();
});

/** موظفة ليها حساب مرتبط وعضوية سارية، ووردية، من غير أي بصمة. */
async function linkedWithoutSession(tenant: Tenant, name = 'Mona') {
  const userId = await f.user(`${name}-user`);
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { userId, nameEn: name });
  await f.shift(tenant, employee);
  return { userId, employee };
}

/** موظفة بحساب مرتبط وعضوية في نطاق معيّن، شغالة في يوم الوردية. */
async function linkedInScope(
  tenant: Tenant,
  scope: { type: 'COMPANY' | 'BUSINESS' | 'BRANCH'; id: string },
  name: string,
) {
  const userId = await f.user(`${name}-user`);
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: scope.type,
    scopeId: scope.id,
  });
  const employee = await f.employee(tenant, { userId, nameEn: name });
  await f.shift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN });
  return { userId, employee };
}

/** سطر دفتر بصفر مستلمين وحدث من غير قائمة مستلمين. */
async function expectNoRecipient(tenant: Tenant, employee: string) {
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 0 });
  const [event] = await f.endingEvents(tenant.company);
  expect('notification_recipients' in (event?.['payload'] as Record<string, unknown>)).toBe(false);
}

async function expectQuiet(tenant: Tenant, employee: string) {
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
}

it('SEN-01 one reminder, one event and one audit row at the moment, and a re-run stays quiet', async () => {
  const tenant = await f.tenant();
  const { employee, userId } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 1, suppressed_at: null });
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    ENDS_SOON_REMIND_AT.toISOString(),
  );
  expect(new Date(notice?.['shift_ends_at'] as string | Date).toISOString()).toBe(
    SHIFT_END.toISOString(),
  );
  expect(await f.audit(tenant.company, String(notice?.['id']))).toEqual([
    { actor_user_id: null, entity: 'attendance_notice', action: 'shift_ending_soon.detected' },
  ]);
  const events = await f.endingEvents(tenant.company);
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as {
    notice_id: string;
    employee_id: string;
    business_id: string;
    branch_id: string;
    shift_starts_at: string;
    shift_ends_at: string;
    remind_at: string;
    detected_at: string;
    notification_recipients: Record<string, unknown>[];
  };
  expect(payload).toMatchObject({
    notice_id: String(notice?.['id']),
    employee_id: employee,
    business_id: tenant.business,
    branch_id: tenant.branch,
    shift_starts_at: SHIFT_START.toISOString(),
    shift_ends_at: SHIFT_END.toISOString(),
    remind_at: ENDS_SOON_REMIND_AT.toISOString(),
    detected_at: ENDS_SOON_REMIND_AT.toISOString(),
  });
  expect(payload.notification_recipients).toHaveLength(1);
  const recipient = payload.notification_recipients[0] ?? {};
  expect(pushRecipient.parse(recipient)).toMatchObject({
    channel: 'PUSH',
    user_id: userId,
    template_key: 'shift_ends_soon',
    template_revision: 1,
    send_deadline: SHIFT_END.toISOString(),
  });
  expect(recipient['safe_parameters']).toEqual([
    { name: 'shift_end', type: 'text', value: '18:00' },
    { name: 'branch_name_ar', type: 'text', value: 'Salmiya' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  ]);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.endingEvents(tenant.company)).toHaveLength(1);
  expect(await f.audit(tenant.company, String(notice?.['id']))).toHaveLength(1);
  expect(f.endsSoonFailures).toEqual([]);
});

it('SEN-01 a minute before the moment nothing is written', async () => {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_BEFORE);
  await expectQuiet(tenant, employee);
});

it('SEN-04 no open session writes nothing, and a later clock-in gets the reminder', async () => {
  const tenant = await f.tenant();
  const { employee } = await linkedWithoutSession(tenant);
  f.setNow(ENDS_SOON_REMIND_AT);
  await expectQuiet(tenant, employee);
  await f.clockIn(tenant, employee, ENDS_SOON_LATE_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
});

it('SEN-05 an employee on a break gets nothing until she is back', async () => {
  const tenant = await f.tenant();
  const { employee } = await linkedWithoutSession(tenant);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  f.setNow(ENDS_SOON_REMIND_AT);
  await expectQuiet(tenant, employee);
  await f.session(tenant, employee, { clockIn: new Date('2026-10-04T11:00:00.000Z') });
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
});

it('SEN-11 a clock-in at another branch of the same business still gets the reminder', async () => {
  const tenant = await f.tenant();
  const { employee } = await linkedWithoutSession(tenant);
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: MORNING_IN, branch: other });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
});

it('SEN-12 a late run sends the real end time, and a finished shift is never reminded', async () => {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_LATE_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(new Date(notice?.['remind_due_at'] as string | Date).toISOString()).toBe(
    ENDS_SOON_REMIND_AT.toISOString(),
  );
  const [event] = await f.endingEvents(tenant.company);
  const payload = event?.['payload'] as {
    notification_recipients: { safe_parameters: unknown[] }[];
  };
  expect(payload.notification_recipients[0]?.safe_parameters[0]).toEqual({
    name: 'shift_end',
    type: 'text',
    value: '18:00',
  });
  const late = await f.tenant();
  const fresh = await f.atWork(late);
  f.setNow(SHIFT_END);
  await expectQuiet(late, fresh.employee);
});

it('SEN-13 an employee with no linked user gets a ledger row and an event with no recipient', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'NoUser' });
  await f.shift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 0, suppressed_at: null });
  const [event] = await f.endingEvents(tenant.company);
  const payload = event?.['payload'] as Record<string, unknown>;
  expect('notification_recipients' in payload).toBe(false);
});

it('SEN-13 a linked user whose membership ended gets no recipient either', async () => {
  const tenant = await f.tenant();
  const userId = await f.user('ex-staff');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-10-01T00:00:00Z',
  });
  const employee = await f.employee(tenant, { userId, nameEn: 'ExStaff' });
  await f.shift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN });
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 0 });
  const [event] = await f.endingEvents(tenant.company);
  expect('notification_recipients' in (event?.['payload'] as Record<string, unknown>)).toBe(false);
});

it('SEN-13(c) a membership on a branch of another business gets no recipient', async () => {
  const tenant = await f.tenant();
  const otherBusiness = await f.business(tenant.company);
  const otherBranch = await f.branch(tenant, otherBusiness);
  const { employee } = await linkedInScope(tenant, { type: 'BRANCH', id: otherBranch }, 'OtherBiz');
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  await expectNoRecipient(tenant, employee);
});

it('SEN-13(d) a membership on her own business gets the push', async () => {
  const tenant = await f.tenant();
  const { employee } = await linkedInScope(
    tenant,
    { type: 'BUSINESS', id: tenant.business },
    'BusinessScope',
  );
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 1 });
  const [event] = await f.endingEvents(tenant.company);
  const payload = event?.['payload'] as { notification_recipients: unknown[] };
  expect(payload.notification_recipients).toHaveLength(1);
});

it('SEN-13(e) a membership on a branch she is attached to gets the push', async () => {
  const tenant = await f.tenant();
  const attached = await f.branch(tenant);
  const { employee } = await linkedInScope(tenant, { type: 'BRANCH', id: attached }, 'Attached');
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${tenant.company},${f.ids.newId()},${tenant.business},${employee},${attached},'2026-10-01')`;
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.endingNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 1 });
});

it('SEN-14 a deleted employee, an ended contract and a deleted company are all skipped', async () => {
  const deleted = await f.tenant();
  const gone = await f.atWork(deleted);
  await f.deleteEmployee(deleted, gone.employee, MORNING_IN);
  const ended = await f.tenant();
  const finished = await f.atWork(ended);
  await f.endContract(ended, finished.employee, '2026-10-03');
  const closed = await f.tenant();
  const shut = await f.atWork(closed);
  await f.closeCompany(closed.company, ENDS_SOON_REMIND_AT);
  f.setNow(ENDS_SOON_REMIND_AT);
  await expectQuiet(deleted, gone.employee);
  await expectQuiet(ended, finished.employee);
  await expectQuiet(closed, shut.employee);
  expect(f.endsSoonFailures).toEqual([]);
});

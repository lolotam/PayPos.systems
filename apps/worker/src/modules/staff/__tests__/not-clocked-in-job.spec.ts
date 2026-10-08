import { afterAll, beforeAll, expect, it } from 'vitest';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import {
  ALERT_AT,
  notClockedInFixture,
  ROLE,
  SHIFT_START,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
let inbox: ReturnType<typeof notClockedInInbox>;
beforeAll(async () => {
  f = await notClockedInFixture();
  inbox = notClockedInInbox(f.ids, f.db);
});
afterAll(async () => {
  await f?.close();
});

async function managed(name = 'Laila') {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: name });
  await f.shift(tenant, employee);
  return { tenant, manager, employee };
}

it('NCI-01 and NCI-13: one notice and one in-app per manager; re-run, redelivery and channels stay quiet', async () => {
  const tenant = await f.tenant();
  const first = await f.user('one');
  const second = await f.user('two');
  await f.member({
    tenant,
    userId: first,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  await f.member({
    tenant,
    userId: second,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  f.setNow(new Date('2026-10-04T07:19:59.000Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  await expectNotice(tenant, employee, first, second);
});

async function expectNotice(tenant: Tenant, employee: string, first: string, second: string) {
  const notices = await f.notices(tenant.company, employee);
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ recipient_count: 2 });
  expect(new Date(notices[0]?.['alert_due_at'] as string | Date).toISOString()).toBe(
    ALERT_AT.toISOString(),
  );
  const events = await f.events(tenant.company);
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as {
    shift_starts_at: string;
    notification_recipients: { user_id: string; channel: string; template_key: string; locale: string; safe_parameters: unknown }[];
  };
  expect(payload.shift_starts_at).toBe(SHIFT_START.toISOString());
  expect(payload.notification_recipients.map((item) => item.user_id).sort()).toEqual(
    [first, second].sort(),
  );
  expect(payload.notification_recipients[0]?.safe_parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'Laila' },
    { name: 'employee_name_en', type: 'text', value: 'Laila' },
    { name: 'branch_name_ar', type: 'text', value: 'Salmiya' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'shift_start', type: 'text', value: '10:00' },
  ]);
  const calls = inbox.channel.calls;
  await inbox.deliver(f.owner, tenant.company);
  await inbox.deliver(f.owner, tenant.company);
  expect(inbox.channel.calls).toBe(calls);
  const eventId = String(events[0]?.['id']);
  expect((await f.inbox(eventId)).map((row) => row['recipient_user_id']).sort()).toEqual(
    [first, second].sort(),
  );
  expect(await f.attempts(eventId)).toHaveLength(0);
  expect(await f.audit(tenant.company, String(notices[0]?.['id']))).toEqual([
    { actor_user_id: null, entity: 'attendance_notice', action: 'not_clocked_in.detected' },
  ]);
}

it('NCI-06 re-saving the week with the same start does not alert again', async () => {
  const { tenant, employee } = await managed();
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.notices(tenant.company, employee);
  const [shift] = await f.owner`SELECT id FROM staff_schedule_shifts WHERE company_id=${tenant.company} AND employee_id=${employee}`;
  await f.removeShift(tenant.company, String(shift?.['id']));
  await f.shift(tenant, employee);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, employee)).toEqual(notice === undefined ? [] : [notice]);
});

it('NCI-07 a moved start alerts at the new start and not at the old one', async () => {
  const { tenant, employee } = await managed();
  const [shift] = await f.owner`SELECT id FROM staff_schedule_shifts WHERE company_id=${tenant.company} AND employee_id=${employee}`;
  await f.removeShift(tenant.company, String(shift?.['id']));
  const moved = new Date('2026-10-04T08:00:00.000Z');
  await f.shift(tenant, employee, { startsAt: moved, start: '11:00' });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  f.setNow(new Date('2026-10-04T08:20:00.000Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.notices(tenant.company, employee);
  expect(new Date(notice?.['shift_starts_at'] as string | Date).toISOString()).toBe(
    moved.toISOString(),
  );
});

it('NCI-08 a clock-in at another branch inside the window suppresses the alert', async () => {
  const { tenant, employee } = await managed();
  const other = await f.branch(tenant);
  await f.clockIn(tenant, employee, new Date('2026-10-04T07:10:00.000Z'), other);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
});

it('NCI-09 an ended shift is skipped and a late run still sends while the shift is running', async () => {
  const tenant = await f.tenant();
  const ended = await f.employee(tenant, { nameEn: 'Ended' });
  const running = await f.employee(tenant, { nameEn: 'Running' });
  await f.shift(tenant, ended, { endsAt: new Date('2026-10-04T12:00:00.000Z'), end: '15:00' });
  await f.shift(tenant, running);
  f.setNow(new Date('2026-10-04T14:00:00.000Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.notices(tenant.company, ended)).toHaveLength(0);
  expect(await f.notices(tenant.company, running)).toHaveLength(1);
});

it('a rejected employee name still alerts and a branch year is kept', async () => {
  const { tenant, manager, employee } = await managed('123456');
  await f.owner`UPDATE branches SET name_en='Studio 2026' WHERE company_id=${tenant.company} AND id=${tenant.branch}`;
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.notices(tenant.company, employee)).toHaveLength(1);
  const [event] = await f.events(tenant.company);
  const recipients = (
    event?.['payload'] as {
      notification_recipients: { user_id: string; safe_parameters: unknown }[];
    }
  ).notification_recipients;
  expect(recipients.map((item) => item.user_id)).toEqual([manager]);
  expect(recipients[0]?.safe_parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'موظف' },
    { name: 'employee_name_en', type: 'text', value: 'Employee' },
    { name: 'branch_name_ar', type: 'text', value: 'Studio 2026' },
    { name: 'branch_name_en', type: 'text', value: 'Studio 2026' },
    { name: 'shift_start', type: 'text', value: '10:00' },
  ]);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.inbox(String(event?.['id']))).toHaveLength(1);
});

it('NCI-14 a deleted employee or a contract that ended before the shift date is skipped', async () => {
  const tenant = await f.tenant();
  const deleted = await f.employee(tenant, { nameEn: 'Deleted' });
  const ended = await f.employee(tenant, { nameEn: 'Contract', contractEnd: '2026-10-03' });
  const sameDay = await f.employee(tenant, { nameEn: 'Same day', contractEnd: '2026-10-04' });
  await f.shift(tenant, deleted);
  await f.shift(tenant, ended);
  await f.shift(tenant, sameDay);
  await f.deleteEmployee(tenant, deleted, new Date('2026-10-01T00:00:00.000Z'));
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.notices(tenant.company, deleted)).toHaveLength(0);
  expect(await f.notices(tenant.company, ended)).toHaveLength(0);
  expect(await f.notices(tenant.company, sameDay)).toHaveLength(1);
});

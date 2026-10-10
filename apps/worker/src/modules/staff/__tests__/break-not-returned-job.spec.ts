import { afterAll, beforeAll, expect, it } from 'vitest';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import { ROLE, SHIFT_END, SHIFT_START, type Tenant } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_END,
  BREAK_OUT,
  BREAK_START,
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
  type SessionInput,
} from './break-not-returned.fixture.ts';

let f: BreakNotReturnedFixture;
let inbox: ReturnType<typeof notClockedInInbox>;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
  inbox = notClockedInInbox(f.ids, f.db);
});
afterAll(async () => {
  await f?.close();
});

const minute = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

/** موظفة في فرع له مدير، ووردية فيها بريك، وجلسة الصبح اللي قفلتها جوّه البريك. */
async function onBreak(sessions: readonly SessionInput[] = [{ clockIn: MORNING_IN, clockOut: BREAK_OUT }]) {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await f.member({
    tenant, userId: manager, roleId: ROLE.branch_manager, scopeType: 'BRANCH', scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.breakShift(tenant, employee);
  for (const session of sessions) await f.session(tenant, employee, session);
  return { tenant, manager, employee };
}

async function expectQuiet(tenant: Tenant, employee: string) {
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.breakEvents(tenant.company)).toHaveLength(0);
}

it('BW-09 one notice and one in-app message per manager at break end + 10; 14:09 waits; re-run stays quiet', async () => {
  const { tenant, manager, employee } = await onBreak();
  const owner = await f.user('owner');
  await f.member({ tenant, userId: owner, roleId: ROLE.owner, scopeType: 'COMPANY', scopeId: tenant.company });
  f.setNow(minute(BREAK_ALERT_AT, 0 - 1 / 60));
  await expectQuiet(tenant, employee);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const [notice] = await f.breakNotices(tenant.company, employee);
  expect(notice).toMatchObject({ recipient_count: 2 });
  for (const [column, value] of [
    ['shift_starts_at', SHIFT_START], ['break_ends_at', BREAK_END],
    ['break_out_at', BREAK_OUT], ['alert_due_at', BREAK_ALERT_AT],
  ] as const)
    expect(new Date(notice?.[column] as string | Date).toISOString()).toBe(value.toISOString());
  const events = await f.breakEvents(tenant.company);
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as {
    break_out_at: string;
    notification_recipients: { user_id: string; template_key: string; safe_parameters: unknown }[];
  };
  expect(payload.break_out_at).toBe(BREAK_OUT.toISOString());
  expect(payload.notification_recipients.map((item) => item.user_id).sort()).toEqual([manager, owner].sort());
  expect(payload.notification_recipients[0]).toMatchObject({ template_key: 'break_not_returned' });
  expect(payload.notification_recipients[0]?.safe_parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'Salmiya' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'break_end', type: 'text', value: '14:00' },
  ]);
  const calls = inbox.channel.calls;
  await inbox.deliver(f.owner, tenant.company, 'ShiftBreakNotReturned');
  await inbox.deliver(f.owner, tenant.company, 'ShiftBreakNotReturned');
  expect(inbox.channel.calls).toBe(calls);
  const eventId = String(events[0]?.['id']);
  const rows = await f.inbox(eventId);
  expect(rows.map((row) => row['recipient_user_id']).sort()).toEqual([manager, owner].sort());
  expect(rows.every((row) => row['template_key'] === 'break_not_returned')).toBe(true);
  expect(await f.attempts(eventId)).toHaveLength(0);
  expect(await f.audit(tenant.company, String(notice?.['id']))).toEqual([
    { actor_user_id: null, entity: 'attendance_notice', action: 'break_not_returned.detected' },
  ]);
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
});

it('two concurrent workers record one notice', async () => {
  const { tenant, employee } = await onBreak();
  f.setNow(BREAK_ALERT_AT);
  const [first, second] = await Promise.all([
    f.detectBreak().execute(tenant.company),
    f.detectBreak().execute(tenant.company),
  ]);
  expect(first.notified + second.notified).toBe(1);
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.breakEvents(tenant.company)).toHaveLength(1);
});

it('back at the branch at 14:30 before the 14:35 run: no alert', async () => {
  const { tenant, employee } = await onBreak([
    { clockIn: MORNING_IN, clockOut: BREAK_OUT },
    { clockIn: minute(BREAK_END, 30) },
  ]);
  f.setNow(minute(BREAK_END, 35));
  await expectQuiet(tenant, employee);
});

it('never clocking out for the break raises nothing (BW-Q5: the alert is for a missing return)', async () => {
  const { tenant, employee } = await onBreak([{ clockIn: MORNING_IN }]);
  f.setNow(BREAK_ALERT_AT);
  await expectQuiet(tenant, employee);
});

it.each([
  ['a clock-out outside the break (11:00)', { clockIn: MORNING_IN, clockOut: minute(BREAK_START, -120) }],
  ['a clock-out exactly at the break end', { clockIn: MORNING_IN, clockOut: BREAK_END }],
  ['a MISSED_OUT close inside the break', { clockIn: MORNING_IN, clockOut: BREAK_OUT, status: 'MISSED_OUT' as const }],
  ['a session of another shift', { clockIn: MORNING_IN, clockOut: BREAK_OUT, scheduledEnd: minute(SHIFT_END, -60) }],
  ['a session with no schedule snapshot', { clockIn: MORNING_IN, clockOut: BREAK_OUT, scheduledEnd: null }],
])('no break-out from %s: no alert', async (_label, session) => {
  const { tenant, employee } = await onBreak([session]);
  f.setNow(BREAK_ALERT_AT);
  await expectQuiet(tenant, employee);
});

it('a clock-out at another branch is not a break-out of this shift', async () => {
  const { tenant, employee } = await onBreak([]);
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT, branch: other });
  f.setNow(BREAK_ALERT_AT);
  await expectQuiet(tenant, employee);
});

it('a clock-out exactly at the break start counts as inside the break', async () => {
  const { tenant, employee } = await onBreak([{ clockIn: MORNING_IN, clockOut: BREAK_START }]);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(1);
});

it('the latest clock-out inside the break counts: out 13:02, in 13:10, out 13:20, not back → alert', async () => {
  const lastOut = minute(BREAK_START, 20);
  const { tenant, employee } = await onBreak([
    { clockIn: MORNING_IN, clockOut: BREAK_OUT },
    { clockIn: minute(BREAK_START, 10), clockOut: lastOut },
  ]);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  const [notice] = await f.breakNotices(tenant.company, employee);
  expect(new Date(notice?.['break_out_at'] as string | Date).toISOString()).toBe(lastOut.toISOString());
});

it('a return clock-in at another branch does not count (same shift and branch)', async () => {
  const { tenant, employee } = await onBreak([]);
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  await f.session(tenant, employee, { clockIn: minute(BREAK_END, 5), branch: other, scheduledEnd: null });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
});

it('after the shift ended the break is never re-evaluated', async () => {
  const { tenant, employee } = await onBreak();
  f.setNow(SHIFT_END);
  await expectQuiet(tenant, employee);
});

it('a shift without a break, or whose break was removed, raises nothing', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.breakShift(tenant, employee, false);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  f.setNow(BREAK_ALERT_AT);
  await expectQuiet(tenant, employee);
});

it('approved full-day leave excuses; pending leave does not; a deleted employee is skipped', async () => {
  const excused = await onBreak();
  const pending = await onBreak();
  const deleted = await onBreak();
  const span = {
    kind: 'FULL_DAY' as const, from: '2026-10-04', to: '2026-10-04', start: null, end: null,
    startsAt: new Date('2026-10-03T21:00:00.000Z'), endsAt: new Date('2026-10-04T21:00:00.000Z'),
  };
  await f.leave(excused.tenant, excused.employee, { ...span, status: 'APPROVED' });
  await f.leave(pending.tenant, pending.employee, { ...span, status: 'PENDING' });
  await f.deleteEmployee(deleted.tenant, deleted.employee, MORNING_IN);
  f.setNow(BREAK_ALERT_AT);
  await expectQuiet(excused.tenant, excused.employee);
  await expectQuiet(deleted.tenant, deleted.employee);
  expect(await f.detectBreak().execute(pending.tenant.company)).toEqual({ notified: 1 });
});

it('partial leave covering the break end moves the alert to its end + 10 minutes', async () => {
  const { tenant, employee } = await onBreak();
  await f.leave(tenant, employee, {
    kind: 'PARTIAL', status: 'APPROVED', from: '2026-10-04', to: '2026-10-04',
    start: '14:00', end: '15:00', startsAt: BREAK_END, endsAt: minute(BREAK_END, 60),
  });
  f.setNow(minute(BREAK_END, 69));
  await expectQuiet(tenant, employee);
  f.setNow(minute(BREAK_END, 70));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(f.breakFailures).toEqual([]);
});

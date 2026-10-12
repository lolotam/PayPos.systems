import { afterAll, beforeAll, expect, it } from 'vitest';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import { ROLE } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT, BREAK_END, BREAK_OUT, MORNING_IN,
  breakNotReturnedFixture, type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';

let f: BreakNotReturnedFixture;
beforeAll(async () => { f = await breakNotReturnedFixture(); });
afterAll(async () => { await f?.close(); });
const returnedAt = new Date(BREAK_END.getTime() + 5 * 60_000);

async function onBreak() {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameAr: 'سارة', nameEn: 'Sara' });
  await f.breakShift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  f.setNow(BREAK_ALERT_AT);
  return { tenant, employee };
}

it('BW-Q10 one destination notice reaches only the departure managers, and re-run/redelivery do not duplicate it', async () => {
  const { tenant, employee } = await onBreak();
  const other = await f.branch(tenant);
  await f.owner`UPDATE branches SET name_ar='حولي',name_en='Hawalli' WHERE company_id=${tenant.company} AND id=${other}`;
  const departure = await f.user('departure');
  const destination = await f.user('destination');
  const owner = await f.user('owner');
  await f.member({ tenant, userId: departure, roleId: ROLE.branch_manager, scopeType: 'BRANCH', scopeId: tenant.branch });
  await f.member({ tenant, userId: destination, roleId: ROLE.branch_manager, scopeType: 'BRANCH', scopeId: other });
  await f.member({ tenant, userId: owner, roleId: ROLE.owner, scopeType: 'COMPANY', scopeId: tenant.company });
  await f.session(tenant, employee, { clockIn: returnedAt, branch: other, scheduledEnd: null });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const notices = await f.breakNotices(tenant.company, employee);
  expect(notices).toHaveLength(1);
  const events = await f.breakEvents(tenant.company);
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as { notification_recipients: { user_id: string; template_key: string; safe_parameters: unknown }[] };
  expect(payload).toMatchObject({
    notice_kind: 'break_returned_other_branch', branch_id: tenant.branch,
    returned_branch_id: other, returned_at: returnedAt.toISOString(),
  });
  expect(payload.notification_recipients.map((r) => r.user_id).sort()).toEqual([departure, owner].sort());
  expect(payload.notification_recipients.every((r) => r.template_key === 'break_returned_other_branch')).toBe(true);
  expect(payload.notification_recipients[0]?.safe_parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'حولي' },
    { name: 'branch_name_en', type: 'text', value: 'Hawalli' },
  ]);
  const inbox = notClockedInInbox(f.ids, f.db);
  await inbox.deliver(f.owner, tenant.company, 'ShiftBreakNotReturned');
  await inbox.deliver(f.owner, tenant.company, 'ShiftBreakNotReturned');
  const rows = await f.inbox(String(events[0]?.['id']));
  expect(rows.map((r) => r['recipient_user_id']).sort()).toEqual([departure, owner].sort());
  expect(rows.every((r) => r['template_key'] === 'break_returned_other_branch' && r['branch_id'] === tenant.branch)).toBe(true);
  expect(inbox.channel.calls).toBe(0);
  expect(await f.audit(tenant.company, String(notices[0]?.['id']))).toEqual([
    { actor_user_id: null, entity: 'attendance_notice', action: 'break_returned_other_branch.detected' },
  ]);
  expect(f.breakFailures).toEqual([]);
});

it('BW-Q10 concurrent jobs settle a cross-branch return once', async () => {
  const { tenant, employee } = await onBreak();
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: returnedAt, branch: other });
  const [first, second] = await Promise.all([f.detectBreak().execute(tenant.company), f.detectBreak().execute(tenant.company)]);
  expect(first.notified + second.notified).toBe(1);
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.breakEvents(tenant.company)).toHaveLength(1);
});

it.each(['same', 'earlier-same'] as const)('BW-Q10 %s branch return produces neither notice nor alert', async (mode) => {
  const { tenant, employee } = await onBreak();
  await f.session(tenant, employee, { clockIn: returnedAt, clockOut: new Date(returnedAt.getTime() + 60_000) });
  if (mode === 'earlier-same')
    await f.session(tenant, employee, { clockIn: new Date(returnedAt.getTime() + 120_000), branch: await f.branch(tenant) });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.breakEvents(tenant.company)).toHaveLength(0);
});

it.each(['future', 'before-out', 'at-out', 'voided'] as const)('BW-Q10 ignores a %s other-branch clock-in', async (mode) => {
  const { tenant, employee } = await onBreak();
  const other = await f.branch(tenant);
  const clockIn = mode === 'future' ? new Date(BREAK_ALERT_AT.getTime() + 60_000)
    : mode === 'before-out' ? MORNING_IN : mode === 'at-out' ? BREAK_OUT : returnedAt;
  await f.session(tenant, employee, { clockIn, branch: other, clockOut: mode === 'voided' ? BREAK_ALERT_AT : null });
  if (mode === 'voided') {
    const [session] = await f.owner`SELECT id FROM attendance_sessions WHERE company_id=${tenant.company}
      AND employee_id=${employee} AND branch_id=${other}`;
    await f.voidSession(tenant, String(session?.['id']), BREAK_ALERT_AT);
  }
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.breakEvents(tenant.company);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ notice_kind: 'break_not_returned' });
});

it('BW-Q10 return exactly at the decision instant counts', async () => {
  const { tenant, employee } = await onBreak();
  await f.session(tenant, employee, { clockIn: BREAK_ALERT_AT, branch: await f.branch(tenant) });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect((await f.breakEvents(tenant.company))[0]?.['payload']).toMatchObject({ notice_kind: 'break_returned_other_branch' });
});

it('BW-Q10 an alert already fired is not replaced by a later cross-branch return', async () => {
  const { tenant, employee } = await onBreak();
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  await f.session(tenant, employee, { clockIn: new Date(BREAK_ALERT_AT.getTime() + 60_000), branch: await f.branch(tenant) });
  f.setNow(new Date(BREAK_ALERT_AT.getTime() + 5 * 60_000));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const events = await f.breakEvents(tenant.company);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ notice_kind: 'break_not_returned' });
});

import { afterAll, beforeAll, expect, it } from 'vitest';
import { ROLE, type Tenant } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_END,
  BREAK_OUT,
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';
import {
  MANAGER_ROLES,
  auditRows,
  breakLedger,
  clearRules,
  eventRecipients,
  outboxRows,
  saveRule,
  setMaster,
  type RuleContext,
} from './alert-rule.helpers.ts';

const NOT_RETURNED = 'SHIFT_BREAK_NOT_RETURNED';
const OTHER_BRANCH = 'SHIFT_BREAK_RETURNED_OTHER_BRANCH';
const EVENT = 'ShiftBreakNotReturned';
const minute = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

let f: BreakNotReturnedFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

/** موظفة في فرع له مدير، ووردية فيها بريك، وجلسة الصبح اللي قفلتها جوّه البريك. */
async function onBreak() {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.breakShift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  return { tenant, manager, employee };
}

/** رجوع لفرع تاني في لحظة. */
async function returnedElsewhere(
  tenant: Tenant,
  employee: string,
  at: Date,
  clockOut: Date | null = null,
) {
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: at, clockOut, branch: other });
  return other;
}

it('a suppressed missing-return row converts to the other-branch notice when she returns later', async () => {
  const { tenant, manager, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const suppressed = await breakLedger(ctx, tenant.company, employee);
  expect(suppressed).toHaveLength(1);
  expect(suppressed[0]?.['suppressed_at']).not.toBeNull();
  expect(suppressed[0]?.['suppressed_kind']).toBe('NOT_RETURNED');
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);

  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });

  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['id']).toBe(suppressed[0]?.['id']);
  expect(rows[0]?.['suppressed_at']).toBeNull();
  expect(rows[0]?.['suppressed_kind']).toBeNull();
  expect(rows[0]).toMatchObject({ recipient_count: 1 });
  expect(new Date(rows[0]?.['alert_due_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T11:10:00.000Z',
  );
  expect(new Date(rows[0]?.['notified_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T11:20:00.000Z',
  );
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ notice_kind: 'break_returned_other_branch' });
  expect(eventRecipients(events[0])).toEqual([manager]);
  const audit = await auditRows(ctx, tenant.company);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    entity: 'attendance_notice',
    entity_id: rows[0]?.['id'],
    action: 'break_returned_other_branch.detected',
  });
});

it('with both rules off the suppressed row is closed for good', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  await saveRule(ctx, tenant, OTHER_BRANCH, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const before = await breakLedger(ctx, tenant.company, employee);
  expect(before).toHaveLength(1);
  expect(before[0]?.['suppressed_kind']).toBe('NOT_RETURNED');

  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const closed = await breakLedger(ctx, tenant.company, employee);
  expect(closed).toHaveLength(1);
  expect(closed[0]).toMatchObject({
    suppressed_at: before[0]?.['suppressed_at'],
    alert_due_at: before[0]?.['alert_due_at'],
    notified_at: before[0]?.['notified_at'],
    suppressed_kind: 'RETURNED_OTHER_BRANCH',
  });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);

  await clearRules(ctx, tenant, OTHER_BRANCH);
  f.setNow(minute(BREAK_ALERT_AT, 20));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('the master switch off closes the row, and turning it back on converts nothing', async () => {
  const { tenant, employee } = await onBreak();
  await setMaster(ctx, tenant, false);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'NOT_RETURNED',
  );

  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );

  await setMaster(ctx, tenant, null);
  f.setNow(minute(BREAK_ALERT_AT, 20));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('turning the missing-return rule back on never back-fills the suppressed shift', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await clearRules(ctx, tenant, NOT_RETURNED);
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(rows[0]?.['suppressed_kind']).toBe('NOT_RETURNED');
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('a row the other-branch rule suppressed stays terminal', async () => {
  const { tenant, employee } = await onBreak();
  await returnedElsewhere(tenant, employee, minute(BREAK_END, 5));
  await saveRule(ctx, tenant, OTHER_BRANCH, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );

  await clearRules(ctx, tenant, OTHER_BRANCH);
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('a voided return after a terminal close never converts', async () => {
  const { tenant, employee } = await onBreak();
  const returnedAt = minute(BREAK_END, 5);
  await returnedElsewhere(tenant, employee, returnedAt, minute(returnedAt, 1));
  await saveRule(ctx, tenant, OTHER_BRANCH, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBe(
    'RETURNED_OTHER_BRANCH',
  );

  const [session] = await f.owner`SELECT id FROM attendance_sessions
    WHERE company_id=${tenant.company} AND employee_id=${employee} AND clock_in=${returnedAt}`;
  await f.voidSession(tenant, String(session?.['id']), BREAK_ALERT_AT);
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 3));
  await clearRules(ctx, tenant, OTHER_BRANCH);
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_kind']).toBe('RETURNED_OTHER_BRANCH');
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('the first return decides: a same-branch return first leaves the row alone', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await f.session(tenant, employee, {
    clockIn: minute(BREAK_ALERT_AT, 2),
    clockOut: minute(BREAK_ALERT_AT, 3),
  });
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 4));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_kind']).toBe('NOT_RETURNED');
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('the first return decides: another-branch return first converts even if she goes back', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2), minute(BREAK_ALERT_AT, 3));
  await f.session(tenant, employee, { clockIn: minute(BREAK_ALERT_AT, 4) });
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ notice_kind: 'break_returned_other_branch' });
  expect((await breakLedger(ctx, tenant.company, employee))[0]?.['suppressed_kind']).toBeNull();
});

it('a converted notice is written once and never again', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  await f.detectBreak().execute(tenant.company);
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(1);
  expect(await breakLedger(ctx, tenant.company, employee)).toHaveLength(1);
});

it('a return at the same branch after the suppression changes nothing', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  await f.detectBreak().execute(tenant.company);
  await f.session(tenant, employee, { clockIn: minute(BREAK_ALERT_AT, 2) });
  f.setNow(minute(BREAK_ALERT_AT, 10));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_kind']).toBe('NOT_RETURNED');
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

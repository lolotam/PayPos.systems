import { afterAll, beforeAll, expect, it } from 'vitest';
import { ROLE } from './not-clocked-in.fixture.ts';
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

const KIND = 'SHIFT_BREAK_NOT_RETURNED';
const OTHER_KIND = 'SHIFT_BREAK_RETURNED_OTHER_BRANCH';
const EVENT = 'ShiftBreakNotReturned';
const minute = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);
const RETURNED_AT = new Date(BREAK_END.getTime() + 5 * 60_000);

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

/** موظفة رجعت لفرع تاني بعد البريك. */
async function onBreakReturnedElsewhere() {
  const base = await onBreak();
  const other = await f.branch(base.tenant);
  await f.session(base.tenant, base.employee, { clockIn: RETURNED_AT, branch: other });
  return { ...base, other };
}

it('RT-26 the break kind switched off writes one suppressed ledger row and sends nothing', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('RT-26 the master switch off suppresses the break notice the same way', async () => {
  const { tenant, employee } = await onBreak();
  await setMaster(ctx, tenant, false);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('RT-26 the other-branch kind switched off writes one suppressed ledger row', async () => {
  const { tenant, employee } = await onBreakReturnedElsewhere();
  await saveRule(ctx, tenant, OTHER_KIND, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('a return at another branch before the grace passes waits for the grace', async () => {
  const { tenant, employee } = await onBreakReturnedElsewhere();
  f.setNow(RETURNED_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await breakLedger(ctx, tenant.company, employee)).toHaveLength(0);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ notice_kind: 'break_returned_other_branch' });
});

it('with no stored rule the break notice goes out at the break end plus ten minutes', async () => {
  const { tenant, employee } = await onBreak();
  f.setNow(minute(BREAK_ALERT_AT, -1));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect((await breakLedger(ctx, tenant.company, employee))[0]).toMatchObject({
    recipient_count: 1,
    suppressed_at: null,
  });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

it('RT-27 changing the roles changes the next break emission only', async () => {
  const { tenant, manager, employee } = await onBreak();
  const owner = await f.user('owner');
  await f.member({
    tenant,
    userId: owner,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['owner'] });
  const second = await f.employee(tenant, { nameEn: 'Sana', nameAr: 'سناء' });
  await f.breakShift(tenant, second);
  await f.session(tenant, second, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(2);
  expect(eventRecipients(events[0])).toEqual([owner, manager].sort());
  expect(eventRecipients(events[1])).toEqual([owner]);
  expect((await breakLedger(ctx, tenant.company, employee))[0]).toMatchObject({
    recipient_count: 2,
  });
  expect((await breakLedger(ctx, tenant.company, second))[0]).toMatchObject({
    recipient_count: 1,
  });
});

it('RT-27b a suppressed break is never alerted later, and the next overdue break is emitted', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await clearRules(ctx, tenant, KIND);
  f.setNow(minute(BREAK_ALERT_AT, 5));
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const next = await f.employee(tenant, { nameEn: 'Next', nameAr: 'التالية' });
  await f.breakShift(tenant, next);
  await f.session(tenant, next, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

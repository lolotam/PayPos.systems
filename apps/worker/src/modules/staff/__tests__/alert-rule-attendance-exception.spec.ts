import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  MANAGER_ROLES,
  attendanceExceptions,
  auditRows,
  eventBell,
  eventRecipients,
  outboxRows,
  saveRule,
  setMaster,
  type RuleContext,
} from './alert-rule.helpers.ts';
import {
  ROLE,
  missedOutFixture,
  type MissedOutFixture,
  type Tenant,
} from './missed-out.fixture.ts';

const KIND = 'ATTENDANCE_EXCEPTION';
const EVENT = 'AttendanceExceptionRaised';
const CLOCK_IN = new Date('2026-10-05T05:00:00Z');

let f: MissedOutFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await missedOutFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

/** مالك النشاط ومدير فرعه: دورا القاعدة الافتراضيان. */
async function managers(tenant: Tenant) {
  const owner = await f.user('owner');
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: owner,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  return { owner, manager };
}

it('the default rule reaches the owner and the branch manager with the exact bell', async () => {
  const tenant = await f.tenant();
  const { owner, manager } = await managers(tenant);
  const employee = await f.employee(tenant);
  await f.open(tenant, employee, CLOCK_IN);

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0]).sort()).toEqual([owner, manager].sort());
  const bell = eventBell(events[0]);
  expect(bell?.template_key).toBe('attendance_exception_raised');
  expect(bell?.template_revision).toBe(1);
  expect(bell?.safe_parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'Synthetic missed-out employee' },
    { name: 'employee_name_en', type: 'text', value: 'Synthetic missed-out employee' },
    { name: 'branch_name_ar', type: 'text', value: 'Synthetic missed-out' },
    { name: 'branch_name_en', type: 'text', value: 'Synthetic missed-out' },
    { name: 'clock_in_date', type: 'text', value: '2026-10-05' },
    { name: 'clock_in_time', type: 'text', value: '08:00' },
  ]);
  const audit = await auditRows(ctx, tenant.company);
  expect(audit).toHaveLength(1);
  expect(audit[0]?.['action']).toBe('suspected_missed_out.raised');
});

it('the employee herself is not a recipient even when she manages the branch', async () => {
  const tenant = await f.tenant();
  const { owner, manager } = await managers(tenant);
  const userId = await f.user('employee-manager');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { userId });
  await f.open(tenant, employee, CLOCK_IN);

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0]).sort()).toEqual([owner, manager].sort());
  expect(eventRecipients(events[0])).not.toContain(userId);
});

it('a switched off kind keeps the exception and its audit and sends no bell', async () => {
  const tenant = await f.tenant();
  await managers(tenant);
  const employee = await f.employee(tenant);
  await f.open(tenant, employee, CLOCK_IN);
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: MANAGER_ROLES });

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  expect(await attendanceExceptions(ctx, tenant.company)).toHaveLength(1);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(1);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('the master switch off keeps the exception and sends no bell', async () => {
  const tenant = await f.tenant();
  await managers(tenant);
  const employee = await f.employee(tenant);
  await f.open(tenant, employee, CLOCK_IN);
  await setMaster(ctx, tenant, false);

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  expect(await attendanceExceptions(ctx, tenant.company)).toHaveLength(1);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('a branch override switched off stops the bell of that branch only', async () => {
  const tenant = await f.tenant();
  const { owner } = await managers(tenant);
  const otherBranch = await f.branch(tenant);
  const otherManager = await f.user('other-manager');
  await f.member({
    tenant,
    userId: otherManager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: otherBranch,
  });
  const employee = await f.employee(tenant);
  const session = await f.open(tenant, employee, CLOCK_IN);
  const otherEmployee = await f.employee(tenant, { primaryBranchId: otherBranch });
  const otherSession = await f.open(tenant, otherEmployee, CLOCK_IN, null, otherBranch);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: MANAGER_ROLES });
  await saveRule(ctx, { ...tenant, branchId: tenant.branch }, KIND, {
    enabled: false,
    roles: MANAGER_ROLES,
  });

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 2, missedOut: 0 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  const forSession = (id: string) =>
    events.filter((row) => (row['payload'] as { session_id?: string }).session_id === id);
  const otherEvents = forSession(otherSession);
  expect(forSession(session)).toHaveLength(0);
  expect(otherEvents).toHaveLength(1);
  expect(eventRecipients(otherEvents[0]).sort()).toEqual([owner, otherManager].sort());
});

it('no manager at all leaves the exception without a bell', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.open(tenant, employee, CLOCK_IN);

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  expect(await attendanceExceptions(ctx, tenant.company)).toHaveLength(1);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
});

it('a rule with one role reaches only the users of that role', async () => {
  const tenant = await f.tenant();
  const { owner } = await managers(tenant);
  const employee = await f.employee(tenant);
  await f.open(tenant, employee, CLOCK_IN);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['owner'] });

  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 1, missedOut: 0 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(eventRecipients(events[0])).toEqual([owner]);
});

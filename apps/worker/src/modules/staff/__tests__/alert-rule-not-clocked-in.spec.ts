import { afterAll, beforeAll, expect, it } from 'vitest';
import type { NoticeWrite } from '../ports/not-clocked-in.port.ts';
import {
  ALERT_AT,
  ROLE,
  notClockedInFixture,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';
import {
  MANAGER_ROLES,
  auditRows,
  clearRules,
  eventRecipients,
  notClockedInLedger,
  outboxRows,
  saveRule,
  setMaster,
  spyOnRecord,
  type RuleContext,
} from './alert-rule.helpers.ts';

const KIND = 'SHIFT_NOT_CLOCKED_IN';
const EVENT = 'ShiftNotClockedIn';
const minute = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

let f: NotClockedInFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await notClockedInFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

/** يحوّل جدول الوردية للفرع التاني، فالوردية بتاخد قاعدة الفرع. */
async function moveToBranch(tenant: Tenant, employeeId: string, branchId: string) {
  await f.owner`UPDATE staff_schedules SET branch_id=${branchId}
    WHERE company_id=${tenant.company} AND employee_id=${employeeId}`;
}

/** لحظة استحقاق التنبيه من سطر الدفتر. */
async function dueAt(company: string, employeeId: string) {
  const rows = await notClockedInLedger(ctx, company, employeeId);
  return new Date(rows[0]?.['alert_due_at'] as string | Date).toISOString();
}

it('RT-26 a kind switched off writes one suppressed ledger row and sends nothing', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: MANAGER_ROLES });
  const written: NoticeWrite[] = [];
  f.setNow(ALERT_AT);
  expect(await f.detect(spyOnRecord(f.transactions, written)).execute(tenant.company)).toEqual({
    notified: 0,
  });
  const rows = await notClockedInLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(written).toHaveLength(0);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('RT-26 the master switch off suppresses the notice the same way', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  await setMaster(ctx, tenant, false);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await notClockedInLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recipient_count: 0 });
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
});

it('RT-26b a branch override replaces the business delay for that branch only', async () => {
  const tenant = await f.tenant();
  const other = await f.branch(tenant);
  const salmiya = await f.employee(tenant, { nameEn: 'Salmiya' });
  await f.shift(tenant, salmiya);
  const hawalli = await f.employee(tenant, { nameEn: 'Hawalli' });
  await f.shift(tenant, hawalli);
  await moveToBranch(tenant, hawalli, other);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: MANAGER_ROLES, delayMinutes: 20 });
  await saveRule(ctx, { ...tenant, branchId: other }, KIND, {
    enabled: true,
    roles: MANAGER_ROLES,
    delayMinutes: 10,
  });
  f.setNow(minute(ALERT_AT, -9));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await dueAt(tenant.company, hawalli)).toBe('2026-10-04T07:10:00.000Z');
  expect(await notClockedInLedger(ctx, tenant.company, salmiya)).toHaveLength(0);
  await clearRules(ctx, { ...tenant, branchId: other }, KIND);
  const later = await f.employee(tenant, { nameEn: 'Later' });
  await f.shift(tenant, later);
  await moveToBranch(tenant, later, other);
  f.setNow(minute(ALERT_AT, 1));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 2 });
  expect(await dueAt(tenant.company, salmiya)).toBe('2026-10-04T07:20:00.000Z');
  expect(await dueAt(tenant.company, later)).toBe('2026-10-04T07:20:00.000Z');
  expect(await dueAt(tenant.company, hawalli)).toBe('2026-10-04T07:10:00.000Z');
});

it('RT-27 changing the roles changes the next emission only', async () => {
  const tenant = await f.tenant();
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
  const first = await f.employee(tenant, { nameEn: 'First' });
  await f.shift(tenant, first);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['owner'] });
  const second = await f.employee(tenant, { nameEn: 'Second' });
  await f.shift(tenant, second);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.events(tenant.company);
  expect(events).toHaveLength(2);
  expect(eventRecipients(events[0])).toEqual([owner, manager].sort());
  expect(eventRecipients(events[1])).toEqual([owner]);
  expect((await notClockedInLedger(ctx, tenant.company, first))[0]).toMatchObject({
    recipient_count: 2,
  });
  expect((await notClockedInLedger(ctx, tenant.company, second))[0]).toMatchObject({
    recipient_count: 1,
  });
});

it('RT-27b a suppressed shift is never alerted later, and the next overdue shift is emitted', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  await saveRule(ctx, tenant, KIND, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  await clearRules(ctx, tenant, KIND);
  f.setNow(minute(ALERT_AT, 5));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await notClockedInLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  const next = await f.employee(tenant, { nameEn: 'Next' });
  await f.shift(tenant, next);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

it('the notice carries the absent employee user id the fixed push needs', async () => {
  const tenant = await f.tenant();
  const userId = await f.user('absent');
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Laila', userId });
  await f.shift(tenant, employee);
  const written: NoticeWrite[] = [];
  f.setNow(ALERT_AT);
  expect(await f.detect(spyOnRecord(f.transactions, written)).execute(tenant.company)).toEqual({
    notified: 1,
  });
  expect(written).toHaveLength(1);
  expect(written[0]?.employeePushUserId).toBe(userId);
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({ employee_push_user_id: userId });
  const audit = await auditRows(ctx, tenant.company);
  expect(audit).toHaveLength(1);
  expect(audit[0]?.['after']).not.toHaveProperty('employee_push_user_id');
});

it('an employee without a linked user leaves the push target empty and the event still goes out', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await outboxRows(ctx, tenant.company, EVENT);
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as { employee_push_user_id?: string | null };
  expect(payload.employee_push_user_id).toBeNull();
  expect('employee_push_user_id' in payload).toBe(true);
  expect(payload).not.toHaveProperty('notification_recipients');
});

it('with no stored rule the defaults alert at twenty minutes to the four manager roles', async () => {
  const tenant = await f.tenant();
  const owner = await f.user('owner');
  await f.member({
    tenant,
    userId: owner,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  f.setNow(minute(ALERT_AT, -1));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect((await notClockedInLedger(ctx, tenant.company, employee))[0]).toMatchObject({
    recipient_count: 1,
    suppressed_at: null,
  });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
});

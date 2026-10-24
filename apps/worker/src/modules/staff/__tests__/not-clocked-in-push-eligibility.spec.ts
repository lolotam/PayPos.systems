import { afterAll, beforeAll, expect, it } from 'vitest';
import type postgres from 'postgres';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import { ALERT_AT, ROLE, WORKING } from './not-clocked-in.fixture.ts';
import {
  MANAGER_ROLES,
  notClockedInLedger,
  saveRule,
  type RuleContext,
} from './alert-rule.helpers.ts';
import {
  notClockedInPushFixture,
  type NotClockedInPushFixture,
  type Tenant,
} from './not-clocked-in-push.fixture.ts';

let f: NotClockedInPushFixture;
let ctx: RuleContext;
let inbox: ReturnType<typeof notClockedInInbox>;
beforeAll(async () => {
  f = await notClockedInPushFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
  inbox = notClockedInInbox(f.ids, f.db, { push: true });
});
afterAll(async () => {
  await f?.close();
});

/** مستلمو الدفع في كل أحداث النوع. */
function pushRecipients(rows: readonly postgres.Row[]) {
  return rows.flatMap((row) => {
    const payload = row['payload'] as {
      notification_recipients?: { channel: string; user_id: string }[];
    };
    return (payload.notification_recipients ?? []).filter((item) => item.channel === 'PUSH');
  });
}

/** شركة بمدير واحد بجرس داخل التطبيق: إشعار المديرين ما يتأثرش بالحالة اللي بنختبرها. */
async function tenantWithManager(): Promise<{ tenant: Tenant; manager: string }> {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  return { tenant, manager };
}

it('a company-scope membership gets the push', async () => {
  const { tenant } = await tenantWithManager();
  const userId = await f.user('mona');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  const employee = await f.employee(tenant, { nameEn: 'Mona', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const push = pushRecipients(await f.events(tenant.company));
  expect(push).toHaveLength(1);
  expect(push[0]?.user_id).toBe(userId);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(1);
});

it('a membership on a second branch she is attached to gets the push', async () => {
  const { tenant } = await tenantWithManager();
  const other = await f.branch(tenant, tenant.business);
  const userId = await f.user('attached');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: other,
  });
  const employee = await f.employee(tenant, { nameEn: 'Attached', userId });
  await f.shift(tenant, employee);
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${tenant.company},${f.ids.newId()},${tenant.business},${employee},${other},'2026-10-01')`;
  await f.subscribe(tenant.company, userId, 'ar');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const push = pushRecipients(await f.events(tenant.company));
  expect(push).toHaveLength(1);
  expect(push[0]?.user_id).toBe(userId);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(1);
});

it('PW-12 an employee with no linked user gets no push and the manager bell is unaffected', async () => {
  const { tenant, manager } = await tenantWithManager();
  const employee = await f.employee(tenant, { nameEn: 'Mona' });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(pushRecipients(await f.events(tenant.company))).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
  const bell = await f.inAppRows(tenant.company);
  expect(bell.map((row) => String(row['recipient_user_id']))).toEqual([manager]);
});

it('PW-12 a linked user with no membership gets no push', async () => {
  const { tenant, manager } = await tenantWithManager();
  const userId = await f.user('mona');
  const employee = await f.employee(tenant, { nameEn: 'Mona', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(pushRecipients(await f.events(tenant.company))).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
  expect(await f.inAppRows(tenant.company)).toHaveLength(1);
  expect(String((await f.inAppRows(tenant.company))[0]?.['recipient_user_id'])).toBe(manager);
});

it('PW-12 a linked user whose membership ended before the alert gets no push', async () => {
  const { tenant } = await tenantWithManager();
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
  const employee = await f.employee(tenant, { nameEn: 'ExStaff', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(pushRecipients(await f.events(tenant.company))).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
});

it('PW-12 a membership on a branch of another business gets no push', async () => {
  const { tenant } = await tenantWithManager();
  const otherBusiness = await f.business(tenant.company);
  const otherBranch = await f.branch(tenant, otherBusiness);
  const userId = await f.user('other-business');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: otherBranch,
  });
  const employee = await f.employee(tenant, { nameEn: 'OtherBiz', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(pushRecipients(await f.events(tenant.company))).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
});

it('PW-12 leave, an ended contract and a deleted employee leave no notice and no push', async () => {
  const { tenant } = await tenantWithManager();
  const leaveUser = await f.user('leave');
  const contractUser = await f.user('contract');
  const deletedUser = await f.user('deleted');
  const onLeave = await f.employee(tenant, { nameEn: 'Leave', userId: leaveUser });
  const ended = await f.employee(tenant, { nameEn: 'Contract', userId: contractUser });
  const deleted = await f.employee(tenant, { nameEn: 'Deleted', userId: deletedUser });
  for (const userId of [leaveUser, contractUser, deletedUser]) {
    await f.member({
      tenant,
      userId,
      roleId: ROLE.cashier,
      scopeType: 'BRANCH',
      scopeId: tenant.branch,
    });
    await f.subscribe(tenant.company, userId, 'ar');
  }
  for (const employee of [onLeave, ended, deleted]) await f.shift(tenant, employee);
  await f.leave(tenant, onLeave, {
    kind: 'FULL_DAY',
    status: 'APPROVED',
    from: WORKING,
    to: WORKING,
    start: null,
    end: null,
    startsAt: new Date('2026-10-03T21:00:00.000Z'),
    endsAt: new Date('2026-10-04T21:00:00.000Z'),
  });
  await f.endContract(tenant, ended, '2026-10-03');
  await f.deleteEmployee(tenant, deleted, new Date('2026-10-01T00:00:00.000Z'));
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.events(tenant.company)).toHaveLength(0);
  expect(await f.notices(tenant.company, onLeave)).toHaveLength(0);
  expect(await f.notices(tenant.company, ended)).toHaveLength(0);
  expect(await f.notices(tenant.company, deleted)).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
});

it('the rule switched off leaves the ledger row and no event and no push', async () => {
  const { tenant } = await tenantWithManager();
  const userId = await f.user('mona');
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Mona', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  await saveRule(ctx, tenant, 'SHIFT_NOT_CLOCKED_IN', { enabled: false, roles: MANAGER_ROLES });
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  const rows = await notClockedInLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await f.events(tenant.company)).toHaveLength(0);
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(0);
});

import { notificationRequest } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import { notClockedInTransactions } from '../persistence/not-clocked-in.transactions.ts';
import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import {
  ALERT_AT,
  notClockedInFixture,
  ROLE,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';
import { seedManagers } from './not-clocked-in-push.fixture.ts';

let f: NotClockedInFixture;
let inbox: ReturnType<typeof notClockedInInbox>;
beforeAll(async () => {
  f = await notClockedInFixture();
  inbox = notClockedInInbox(f.ids, f.db);
});
afterAll(async () => {
  await f?.close();
});

async function person(
  tenant: Tenant,
  roleId: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
  endsAt: string | null = null,
  startsAt = '2026-01-01T00:00:00Z',
) {
  const userId = await f.user(roleId);
  await f.member({ tenant, userId, roleId, scopeType, scopeId, startsAt, endsAt });
  return userId;
}

it('NCI-10 only the shift branch managers receive it, and the absent employee is excluded', async () => {
  const tenant = await f.tenant();
  const otherBranch = await f.branch(tenant);
  const otherBusiness = await f.business(tenant.company);
  const absent = await f.user('absent');
  const owner = await person(tenant, ROLE.owner, 'COMPANY', tenant.company);
  const general = await person(tenant, ROLE.general_manager, 'COMPANY', tenant.company);
  const business = await person(tenant, ROLE.business_manager, 'BUSINESS', tenant.business);
  const branch = await person(tenant, ROLE.branch_manager, 'BRANCH', tenant.branch);
  await f.member({
    tenant,
    userId: absent,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  await person(tenant, ROLE.branch_manager, 'BRANCH', otherBranch);
  await person(tenant, ROLE.business_manager, 'BUSINESS', otherBusiness);
  await person(tenant, ROLE.cashier, 'BRANCH', tenant.branch);
  await person(tenant, ROLE.owner, 'COMPANY', tenant.company, '2026-10-01T00:00:00Z');
  await person(tenant, ROLE.owner, 'COMPANY', tenant.company, null, '2026-12-01T00:00:00Z');
  const employee = await f.employee(tenant, { nameEn: 'Laila', userId: absent });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.events(tenant.company);
  const recipients = (events[0]?.['payload'] as { notification_recipients: { user_id: string }[] })
    .notification_recipients;
  expect(recipients.map((item) => item.user_id).sort()).toEqual(
    [owner, general, business, branch].sort(),
  );
  await inbox.deliver(f.owner, tenant.company);
  expect(
    (await f.inbox(String(events[0]?.['id']))).map((row) => row['recipient_user_id']).sort(),
  ).toEqual([owner, general, business, branch].sort());
});

it('101 managers become two contract-valid events and each gets one in-app row', async () => {
  const tenant = await f.tenant();
  await seedManagers(f, tenant, 101);
  const managers = (
    await f.owner`SELECT user_id FROM memberships WHERE company_id=${tenant.company} AND role_id=${ROLE.branch_manager} ORDER BY user_id`
  ).map((row) => String(row['user_id']));
  expect(managers).toHaveLength(101);
  const firstManager = managers[0];
  if (firstManager === undefined) throw new Error('MANAGERS_MISSING');
  await f.member({
    tenant,
    userId: firstManager,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  let allocated = 0;
  const failing = notClockedInTransactions(
    f.db,
    {
      newId: () => {
        if (++allocated === 4) throw new Error('SYNTHETIC_SECOND_GROUP_FAILURE');
        return f.ids.newId();
      },
    },
    branchPlaceAdapter,
  );
  await expect(f.detect(failing).execute(tenant.company)).rejects.toThrow(
    'ATTENDANCE_NOT_CLOCKED_IN_RETRY',
  );
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
  expect(await f.events(tenant.company)).toHaveLength(0);
  expect(await f.owner`SELECT id FROM audit_log WHERE company_id=${tenant.company}`).toHaveLength(
    0,
  );
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect((await f.notices(tenant.company, employee))[0]).toMatchObject({ recipient_count: 101 });
  const events = await f.events(tenant.company);
  const groups = events.map((event) => {
    expect(notificationRequest.safeParse(event['payload']).success).toBe(true);
    return (
      event['payload'] as { notification_recipients: { user_id: string }[] }
    ).notification_recipients.map((item) => item.user_id);
  });
  expect(groups.map((group) => group.length)).toEqual([100, 1]);
  expect(groups.flat()).toEqual([...managers].sort());
  await inbox.deliver(f.owner, tenant.company);
  await inbox.deliver(f.owner, tenant.company);
  const rows =
    await f.owner`SELECT recipient_user_id FROM in_app_notifications WHERE company_id=${tenant.company} ORDER BY recipient_user_id`;
  expect(rows.map((row) => String(row['recipient_user_id']))).toEqual([...managers].sort());
}, 60_000);

it('the employee push target rides on the first event of the notice only, and a branch member gets her own push event', async () => {
  const tenant = await f.tenant();
  await seedManagers(f, tenant, 101);
  const userId = await f.user('absent');
  // عضوية على فرع الوردية: صلاحيتها الشخصية سارية، فإشعارها بيتبعت (ADR-0052 §5).
  await f.member({
    tenant,
    userId,
    roleId: ROLE.cashier,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Laila', userId });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.events(tenant.company);
  expect(events).toHaveLength(3);
  const targets = events.map((event) => {
    const payload = event['payload'] as {
      employee_push_user_id?: string | null;
      notification_recipients?: { user_id: string }[];
    };
    expect('employee_push_user_id' in payload).toBe(true);
    return [payload.employee_push_user_id ?? null, payload.notification_recipients?.length ?? 0];
  });
  expect(targets).toEqual([
    [userId, 100],
    [null, 1],
    [null, 1],
  ]);
  const push = events[2]?.['payload'] as {
    employee_push_user_id: string | null;
    notification_recipients: { channel: string; user_id: string }[];
  };
  expect(push.employee_push_user_id).toBeNull();
  expect(push.notification_recipients).toHaveLength(1);
  expect(push.notification_recipients[0]).toMatchObject({ channel: 'PUSH', user_id: userId });
}, 60_000);

it('NCI-11 no managers still publishes the event, and the consumer stores nothing', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Alone' });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.events(tenant.company);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).not.toHaveProperty('notification_recipients');
  await expect(inbox.deliver(f.owner, tenant.company)).resolves.toBeUndefined();
  expect(await f.inbox(String(events[0]?.['id']))).toHaveLength(0);
  expect(await f.attempts(String(events[0]?.['id']))).toHaveLength(0);
});

it('a closed company records no notice or event', async () => {
  const tenant = await f.tenant();
  const manager = await f.user('closed');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.owner,
    scopeType: 'COMPANY',
    scopeId: tenant.company,
  });
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee);
  await f.closeCompany(tenant.company, new Date('2026-10-04T00:00:00.000Z'));
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.events(tenant.company)).toHaveLength(0);
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
});

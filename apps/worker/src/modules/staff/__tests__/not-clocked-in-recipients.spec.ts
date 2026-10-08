import { afterAll, beforeAll, expect, it } from 'vitest';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import {
  ALERT_AT,
  notClockedInFixture,
  ROLE,
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

async function person(tenant: Tenant, roleId: string, scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH', scopeId: string, endsAt: string | null = null, startsAt = '2026-01-01T00:00:00Z') {
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
  expect((await f.inbox(String(events[0]?.['id']))).map((row) => row['recipient_user_id']).sort()).toEqual(
    [owner, general, business, branch].sort(),
  );
});

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

it('a closed company publishes the event with no recipients', async () => {
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
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const [event] = await f.events(tenant.company);
  expect(event?.['payload']).not.toHaveProperty('notification_recipients');
  expect((await f.notices(tenant.company, employee))[0]).toMatchObject({ recipient_count: 0 });
});

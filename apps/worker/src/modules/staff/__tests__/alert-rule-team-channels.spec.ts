import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ALERT_AT,
  ROLE,
  notClockedInFixture,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';
import { clearRules, notClockedInLedger, outboxRows, saveRule, type RuleContext } from './alert-rule.helpers.ts';

// AL-Q6 (صف 62b-1): قنوات الإيميل والواتساب على تنبيه «الموظفة ما بصمتش حضور»؛ مستلم الإيميل من قالب النوع بلا معاملات،
// والمدعو غير الموثّق ما بيوصلوش إيميل ما دام المفتاح true، والقاعدة اللي إيميل بس بتفضل فعّالة ومن غير جرس.
const KIND = 'SHIFT_NOT_CLOCKED_IN';
const OPERATIONAL = {
  locale: 'ar',
  template_key: 'shift_not_clocked_in',
  template_revision: 1,
  safe_parameters: [],
};

let f: NotClockedInFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await notClockedInFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

async function manager(tenant: Tenant, verified: boolean, phone?: string): Promise<string> {
  const userId = await f.user('manager');
  await f.owner`UPDATE "user" SET email_verified=${verified}, phone_number=${phone ?? null} WHERE id=${userId}`;
  if (phone !== undefined)
    await f.owner`UPDATE "user" SET phone_binding_approved_at=now() WHERE id=${userId}`;
  await f.member({
    tenant,
    userId,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  return userId;
}

type Sent = { channel: string; user_id?: string; email?: string; phone?: string };
const sentOf = async (company: string): Promise<Sent[]> =>
  (await outboxRows(ctx, company, 'ShiftNotClockedIn')).flatMap(
    (row) =>
      (row['payload'] as { notification_recipients?: Sent[] }).notification_recipients ?? [],
  );

async function absentEmployee(tenant: Tenant) {
  const employee = await f.employee(tenant, { nameEn: 'Laila' });
  await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  return employee;
}

it('an email-only rule emails only the verified manager, with no bell and no parameters', async () => {
  const tenant = await f.tenant();
  const verified = await manager(tenant, true);
  await manager(tenant, false);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['branch_manager'], channels: ['EMAIL'] });
  const employee = await absentEmployee(tenant);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const verifiedEmail = String((await f.owner`SELECT email FROM "user" WHERE id=${verified}`)[0]?.['email']);
  expect(await sentOf(tenant.company)).toEqual([
    { channel: 'email', email: verifiedEmail, ...OPERATIONAL },
  ]);
  expect(await notClockedInLedger(ctx, tenant.company, employee)).toMatchObject([
    { recipient_count: 2 },
  ]);
  await clearRules(ctx, tenant, KIND);
});

it('an in-app plus WhatsApp rule gives a manager with an approved phone both recipients, and one without only the bell', async () => {
  const tenant = await f.tenant();
  const withPhone = await manager(tenant, true, '+999999620091');
  const without = await manager(tenant, true);
  await saveRule(ctx, tenant, KIND, {
    enabled: true,
    roles: ['branch_manager'],
    channels: ['IN_APP', 'WHATSAPP'],
  });
  await absentEmployee(tenant);
  await f.detect().execute(tenant.company);
  const sent = await sentOf(tenant.company);
  expect(sent.filter((item) => item.channel === 'IN_APP').map((item) => item.user_id).sort()).toEqual(
    [withPhone, without].sort(),
  );
  expect(sent.filter((item) => item.channel === 'whatsapp')).toEqual([
    { channel: 'whatsapp', phone: '+999999620091', ...OPERATIONAL },
  ]);
  await clearRules(ctx, tenant, KIND);
});

it('an external-only rule with no deliverable contact still records the ledger row and writes a recipient-less event', async () => {
  const tenant = await f.tenant();
  await manager(tenant, false);
  await saveRule(ctx, tenant, KIND, { enabled: true, roles: ['branch_manager'], channels: ['EMAIL'] });
  const employee = await absentEmployee(tenant);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await sentOf(tenant.company)).toEqual([]);
  expect(await notClockedInLedger(ctx, tenant.company, employee)).toMatchObject([
    { recipient_count: 1 },
  ]);
  await clearRules(ctx, tenant, KIND);
});

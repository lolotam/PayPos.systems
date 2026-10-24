import { notificationRequest } from '@pospay/contracts';
import { renderPushNotice, type SafeParameter } from '@pospay/notifications';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type postgres from 'postgres';
import { notClockedInInbox } from '../persistence/__tests__/not-clocked-in-inbox.ts';
import { ALERT_AT, ROLE, SHIFT_END } from './not-clocked-in.fixture.ts';
import {
  notClockedInPushFixture,
  seedManagers,
  type NotClockedInPushFixture,
  type Tenant,
} from './not-clocked-in-push.fixture.ts';

let f: NotClockedInPushFixture;
let inbox: ReturnType<typeof notClockedInInbox>;
beforeAll(async () => {
  f = await notClockedInPushFixture();
  inbox = notClockedInInbox(f.ids, f.db, { push: true });
});
afterAll(async () => {
  await f?.close();
});

/** مستلمو الحدث: القناة بتحدد إنهم جرس داخل التطبيق ولا دفع للموظفة. */
function recipientsOf(row: postgres.Row | undefined) {
  const payload = row?.['payload'] as {
    notification_recipients?: { channel: string; user_id: string }[];
  };
  return payload.notification_recipients ?? [];
}

/** وقت العمود: postgres.js بيرجّعه Date، والجملة بتخليه نص. */
function isoOf(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** عضوية على فرع الوردية: صلاحيتها الشخصية سارية وقت التنبيه. */
async function branchMember(tenant: Tenant, userId: string, roleId: string): Promise<void> {
  await f.member({ tenant, userId, roleId, scopeType: 'BRANCH', scopeId: tenant.branch });
}

/** حقائق محاولة الدفع اللي تهم الاختبار. */
function attemptFacts(attempts: readonly postgres.Row[]) {
  return attempts.map((attempt) => ({
    locale: String(attempt['locale']),
    userId: String(attempt['user_id']),
    templateKey: String(attempt['template_key']),
    revision: Number(attempt['template_revision']),
    status: String(attempt['status']),
    deadline: isoOf(attempt['send_deadline'] as string | Date),
    parameters: attempt['safe_parameters'] as SafeParameter[],
  }));
}

it('PW-11 the managers get the bell and the employee gets one push in each of her languages', async () => {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await branchMember(tenant, manager, ROLE.branch_manager);
  const userId = await f.user('mona');
  await branchMember(tenant, userId, ROLE.cashier);
  const employee = await f.employee(tenant, { nameEn: 'Mona', userId });
  await f.shift(tenant, employee);
  await f.subscribe(tenant.company, userId, 'ar');
  await f.subscribe(tenant.company, userId, 'en');
  f.setNow(ALERT_AT);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.events(tenant.company)).toHaveLength(2);
  await inbox.deliver(f.owner, tenant.company);
  const bell = await f.inAppRows(tenant.company);
  expect(bell.map((row) => String(row['recipient_user_id']))).toEqual([manager]);
  expect(bell[0]?.['template_key']).toBe('shift_not_clocked_in');
  const attempts = attemptFacts(await f.pushAttempts(tenant.company));
  expect(attempts).toHaveLength(2);
  expect(attempts.map((row) => row.locale).sort()).toEqual(['ar', 'en']);
  for (const row of attempts) {
    expect(row.userId).toBe(userId);
    expect(row.templateKey).toBe('shift_not_clocked_in_self');
    expect(row.revision).toBe(1);
    expect(row.status).toBe('PENDING');
    expect(row.deadline).toBe(SHIFT_END.toISOString());
    expect(row.parameters).toEqual([
      { name: 'shift_start', type: 'text', value: '10:00' },
      { name: 'branch_name_ar', type: 'text', value: 'Salmiya' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    ]);
  }
  const arabic = attempts.find((row) => row.locale === 'ar');
  const english = attempts.find((row) => row.locale === 'en');
  expect(renderPushNotice('shift_not_clocked_in_self', 1, 'ar', arabic?.parameters ?? [])).toEqual({
    title: 'بصمة الحضور',
    body: 'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في Salmiya.',
  });
  expect(renderPushNotice('shift_not_clocked_in_self', 1, 'en', english?.parameters ?? [])).toEqual(
    {
      title: 'Clock-in',
      body: 'No clock-in yet for your 10:00 shift at Salmiya.',
    },
  );
  await inbox.deliver(f.owner, tenant.company);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.events(tenant.company)).toHaveLength(2);
  expect(await f.pushAttempts(tenant.company)).toHaveLength(2);
  expect(await f.inAppRows(tenant.company)).toHaveLength(1);
}, 60_000);

it.each([99, 100, 101])(
  'PW-17 with %i managers the employee push appears exactly once and alone',
  async (count) => {
    const tenant = await f.tenant();
    const managers = await seedManagers(f, tenant, count);
    const userId = await f.user('mona');
    await branchMember(tenant, userId, ROLE.cashier);
    const employee = await f.employee(tenant, { nameEn: 'Mona', userId });
    await f.shift(tenant, employee);
    f.setNow(ALERT_AT);
    expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
    const events = await f.events(tenant.company);
    expect(events).toHaveLength(count > 100 ? 3 : 2);
    const push = events.flatMap((event) =>
      recipientsOf(event).filter((recipient) => recipient.channel === 'PUSH'),
    );
    expect(push).toHaveLength(1);
    expect(push[0]?.user_id).toBe(userId);
    const pushEvents = events.filter((event) =>
      recipientsOf(event).some((recipient) => recipient.channel === 'PUSH'),
    );
    expect(recipientsOf(pushEvents[0])).toHaveLength(1);
    const bell = events.flatMap((event) =>
      recipientsOf(event)
        .filter((recipient) => recipient.channel === 'IN_APP')
        .map((recipient) => recipient.user_id),
    );
    expect(bell.sort()).toEqual([...managers].sort());
    for (const event of events)
      expect(notificationRequest.safeParse(event['payload']).success).toBe(true);
  },
  60_000,
);

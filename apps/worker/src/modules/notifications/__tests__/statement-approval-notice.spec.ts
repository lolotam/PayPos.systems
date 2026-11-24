import type { ClaimedEvent } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  OTHER_INBOX_USER,
  seedInboxUsers,
} from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { notificationHarness } from './harness.ts';

/**
 * «الكشف مستني الاعتماد» (FR-030): الحدث مسجَّل في أنواع الأحداث المعروفة للمستهلك، والجرس بيتخزن
 * لكل معتمد من الحدث نفسه، بلا تفويض قناة خارجية ولا استدعاء مزوّد.
 */
let h: Awaited<ReturnType<typeof notificationHarness>>;
let owner: postgres.Sql;

const recipient = (user: string) => ({
  channel: 'IN_APP',
  user_id: user,
  locale: 'ar',
  template_key: 'statement_awaiting_approval',
  template_revision: 1,
  safe_parameters: [{ name: 'period', type: 'text', value: '2026-11' }],
});

beforeAll(async () => {
  h = await notificationHarness();
  owner = postgres(h.testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
});

afterAll(async () => {
  await owner.end();
  await h.close();
});

/** حدث «الكشف مستني الاعتماد» بمستلمي المعتمدين، زي ما مراجعة الكشف بتكتبه في معاملتها. */
async function approvalEvent(recipients: object[]): Promise<ClaimedEvent> {
  const source = await h.request();
  return {
    ...source,
    eventType: 'StatementAwaitingApproval',
    payload: {
      schema_version: 1,
      business_id: TENANT.A.business,
      statement_id: '01920000-0000-7000-8000-0000000000aa',
      period: '2026-11',
      group_index: 0,
      notification_recipients: recipients,
    },
  };
}

it('admits the StatementAwaitingApproval event type in the consumer registry', () => {
  expect(h.module.eventTypes).toContain('StatementAwaitingApproval');
});

it('stores the awaiting-approval notice for every approver from the event itself', async () => {
  const request = await approvalEvent([recipient(USER), recipient(OTHER_INBOX_USER)]);
  expect(await h.deliver(request)).toEqual({ delivered: true });

  const rows = await owner`SELECT recipient_user_id, template_key, locale, business_id, safe_parameters
    FROM in_app_notifications WHERE source_event_id = ${request.id}`;
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['recipient_user_id']).sort()).toEqual([OTHER_INBOX_USER, USER].sort());
  for (const row of rows) {
    expect(row['template_key']).toBe('statement_awaiting_approval');
    expect(row['locale']).toBe('ar');
    expect(row['business_id']).toBe(TENANT.A.business);
    const parameters = row['safe_parameters'] as { name: string; type: string; value: string }[];
    expect(parameters).toHaveLength(1);
    expect(parameters[0]).toEqual({ name: 'period', type: 'text', value: '2026-11' });
  }
  // الجرس داخل التطبيق بس: مفيش تفويض واتساب ولا بريد ولا محاولة إرسال ولا نداء مزوّد.
  expect(
    (await h.events()).filter((e) => e.event_type === 'NotificationSendAuthorized'),
  ).toHaveLength(0);
  expect(h.channel.calls).toBe(0);
  expect(
    await owner`SELECT id FROM notification_attempts WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
  const results = (await h.events()).filter(
    (e) => e.event_type === 'NotificationDelivered' && e.payload['source_event_id'] === request.id,
  );
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.payload['evidence']).toBe('IN_APP_STORED');
    expect(result.payload).not.toHaveProperty('safe_parameters');
  }
});

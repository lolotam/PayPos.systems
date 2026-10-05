import type { ClaimedEvent } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { notificationResult } from '@pospay/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedInboxUsers } from '../../../../../../packages/db/test/in-app-fixtures.ts';
import { notificationHarness } from './harness.ts';

const ids = systemUuidV7();
let h: Awaited<ReturnType<typeof notificationHarness>>;
let owner: postgres.Sql;

beforeAll(async () => {
  h = await notificationHarness();
  owner = postgres(h.testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
});
afterAll(async () => {
  await owner.end();
  await h.close();
});

function documentExpiring(payload: Record<string, unknown> = {}): ClaimedEvent {
  const id = ids.newId();
  return {
    id,
    companyId: TENANT.A.company,
    aggregateType: 'employee',
    aggregateId: ids.newId(),
    eventType: 'DocumentExpiring',
    payload: {
      document_id: ids.newId(),
      employee_id: ids.newId(),
      business_id: TENANT.A.business,
      type_code: 'passport',
      expires_on: '2026-11-04',
      days_remaining: 30,
      alert_days: 30,
      today: '2026-10-05',
      detected_at: new Date('2026-10-05T10:00:00Z').toISOString(),
      ...payload,
    },
    attempt: 1,
  };
}

it('accepts a DocumentExpiring event without recipients and sends nothing', async () => {
  const request = documentExpiring();
  expect(await h.deliver(request)).toEqual({ delivered: true });
  expect(
    await owner`SELECT id FROM in_app_notifications WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT id FROM notification_attempts WHERE source_event_id = ${request.id}`,
  ).toHaveLength(0);
  expect(h.channel.calls).toBe(0);
});

it('stores one in-app notification per recipient when the event carries the recommended IN_APP recipient', async () => {
  const request = documentExpiring({
    notification_recipients: [
      {
        channel: 'IN_APP',
        user_id: USER,
        locale: 'ar',
        template_key: 'generic_notice',
        template_revision: 1,
        safe_parameters: [
          { name: 'subject', type: 'text', value: 'Employee document nearing expiry' },
        ],
      },
    ],
  });
  expect(await h.deliver(request)).toEqual({ delivered: true });
  const rows =
    await owner`SELECT recipient_user_id,business_id,read_at FROM in_app_notifications
      WHERE source_event_id = ${request.id}`;
  expect(rows).toEqual([{ recipient_user_id: USER, business_id: TENANT.A.business, read_at: null }]);
  const results = (await h.events()).filter(
    (e) => e.event_type === 'NotificationDelivered' && e.payload['source_event_id'] === request.id,
  );
  expect(results).toHaveLength(1);
  expect(notificationResult.parse(results[0]?.['payload'])).toMatchObject({
    channel: 'IN_APP',
    evidence: 'IN_APP_STORED',
    status: 'SENT',
  });
  expect(h.channel.calls).toBe(0);
});

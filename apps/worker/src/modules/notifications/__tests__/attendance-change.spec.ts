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
  await owner?.end();
  await h?.close();
});
function event(decided: boolean, recipients: boolean): ClaimedEvent {
  const param = (name: string, value: string) => ({ name, type: 'text', value });
  return {
    id: ids.newId(),
    companyId: TENANT.A.company,
    aggregateType: 'attendance_change_request',
    aggregateId: ids.newId(),
    eventType: decided ? 'AttendanceChangeDecided' : 'AttendanceChangeRequested',
    attempt: 1,
    payload: {
      request_id: ids.newId(),
      business_id: TENANT.A.business,
      branch_id: TENANT.A.branch,
      employee_id: ids.newId(),
      kind: 'ADD_SESSION',
      status: decided ? 'REJECTED' : 'PENDING',
      ...(recipients
        ? {
            notification_recipients: [
              {
                channel: 'IN_APP',
                user_id: USER,
                locale: 'ar',
                template_revision: 1,
                template_key: decided ? 'attendance_change_decided' : 'attendance_change_requested',
                safe_parameters: [
                  param('employee_name_ar', 'ليلى'),
                  param('employee_name_en', 'Laila'),
                  param('change', 'ADD_SESSION'),
                  ...(decided ? [param('decision', 'REJECTED'), param('reason', '-')] : []),
                ],
              },
            ],
          }
        : {}),
    },
  };
}
it.each([false, true])(
  'stores both event templates once, with no external transport (decided=%s)',
  async (decided) => {
    const request = event(decided, true);
    expect(await h.deliver(request)).toEqual({ delivered: true });
    expect(await h.deliver(request)).toEqual({ delivered: true });
    const rows =
      await owner`SELECT recipient_user_id,template_key,template_revision,business_id,branch_id FROM in_app_notifications WHERE source_event_id=${request.id}`;
    expect(rows).toEqual([
      {
        recipient_user_id: USER,
        template_key: decided ? 'attendance_change_decided' : 'attendance_change_requested',
        template_revision: 1,
        business_id: TENANT.A.business,
        branch_id: TENANT.A.branch,
      },
    ]);
    const results = (await h.events()).filter(
      (e) =>
        e.event_type === 'NotificationDelivered' && e.payload['source_event_id'] === request.id,
    );
    expect(results).toHaveLength(1);
    expect(notificationResult.parse(results[0]?.payload)).toMatchObject({
      channel: 'IN_APP',
      evidence: 'IN_APP_STORED',
      status: 'SENT',
    });
    expect(h.channel.calls).toBe(0);
  },
);
it.each([false, true])(
  'acknowledges an event without recipients unsent (decided=%s)',
  async (decided) => {
    const request = event(decided, false);
    expect(await h.deliver(request)).toEqual({ delivered: true });
    expect(
      await owner`SELECT id FROM in_app_notifications WHERE source_event_id=${request.id}`,
    ).toHaveLength(0);
    expect(
      await owner`SELECT id FROM notification_attempts WHERE source_event_id=${request.id}`,
    ).toHaveLength(0);
    expect(h.channel.calls).toBe(0);
  },
);

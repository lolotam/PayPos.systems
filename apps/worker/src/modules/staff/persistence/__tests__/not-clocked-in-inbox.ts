import type { ClaimedEvent, Database, IdGenerator } from '@pospay/db';
import { FakeChannel } from '@pospay/notifications';
import type postgres from 'postgres';
import { createNotificationModule } from '../../../notifications/index.ts';

/** يسلّم أحداث عدم الحضور لمستهلك الإشعار داخل التطبيق على نفس قاعدة الاختبار. */
export function notClockedInInbox(ids: IdGenerator, database: Database) {
  const channel = new FakeChannel(() => new Date('2026-10-04T07:20:00.000Z'));
  const notifications = createNotificationModule({
    database,
    ids,
    clock: { now: () => new Date('2026-10-04T07:20:00.000Z') },
    configuration: {
      mode: 'fake',
      hashKey: 'test-key-not-a-secret'.repeat(3),
      hashKeyId: 'test-v1',
    },
    production: false,
    channel,
  });
  return {
    channel,
    deliver: (owner: postgres.Sql, company: string, eventType = 'ShiftNotClockedIn') =>
      deliverNotices(owner, database, notifications, company, eventType),
  };
}

async function deliverNotices(
  owner: postgres.Sql,
  database: Database,
  notifications: ReturnType<typeof createNotificationModule>,
  company: string,
  eventType: string,
) {
  const rows = await owner`SELECT id, aggregate_type, aggregate_id, event_type, payload FROM outbox
    WHERE company_id=${company} AND event_type=${eventType} ORDER BY seq`;
  for (const row of rows) await deliverOne(database, notifications, company, row);
}

async function deliverOne(
  database: Database,
  notifications: ReturnType<typeof createNotificationModule>,
  company: string,
  row: postgres.Row,
) {
  const event: ClaimedEvent = {
    companyId: company,
    id: String(row['id']),
    aggregateType: String(row['aggregate_type']),
    aggregateId: String(row['aggregate_id']),
    eventType: String(row['event_type']),
    payload: row['payload'],
    attempt: 1,
  };
  await database.withTenant(company, (tx) => notifications.consumer.handle(tx, event));
}

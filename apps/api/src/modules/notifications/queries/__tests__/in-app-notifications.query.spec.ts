import { inAppNotificationPage, notificationUnreadCount } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  TENANT,
  USER,
  seedTwoTenants,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  OTHER_INBOX_USER,
  seedInboxUsers,
} from '../../../../../../../packages/db/test/in-app-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import {
  inAppNotificationsStatement,
  listInAppNotifications,
} from '../in-app-notifications.query.ts';
import { unreadCount, unreadCountStatement } from '../unread-count.query.ts';

let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
const access = { companyId: TENANT.A.company, userId: USER };

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => USER } });
  for (const tenant of Object.values(TENANT)) {
    for (const user of [USER, OTHER_INBOX_USER]) {
      await owner`INSERT INTO in_app_notifications (company_id,id,recipient_user_id,business_id,branch_id,
        source_event_id,template_key,template_revision,locale,safe_parameters,created_at,read_at)
        SELECT ${tenant.company},gen_random_uuid(),${user},${tenant.business},${tenant.branch},
          gen_random_uuid(),'generic_notice',1,'en','[{"name":"subject","type":"text","value":"Synthetic subject"}]',
          '2026-10-01T12:00:00.123456Z'::timestamptz + (n / 2) * interval '1 second',
          CASE WHEN n % 10 = 0 THEN NULL ELSE '2026-10-02'::timestamptz END FROM generate_series(1,1000) n`;
    }
  }
  await owner`ANALYZE in_app_notifications`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('returns exact contract, own company/user only, with stable tie-break and full timestamp precision', async () => {
  const first = await listInAppNotifications(db, access, { limit: 3 });
  expect(inAppNotificationPage.parse(first)).toEqual(first);
  expect(first.items).toHaveLength(3);
  expect(first.items[0]?.created_at).toContain('.123456');
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await listInAppNotifications(db, access, {
      limit: 100,
      ...(cursor === null ? {} : { cursor }),
    });
    seen.push(...page.items.map((item) => item.id));
    expect(page.items.every((item) => item.company_id === access.companyId)).toBe(true);
    cursor = page.next_cursor;
  } while (cursor !== null);
  expect(seen).toHaveLength(1000);
  expect(new Set(seen).size).toBe(1000);
  const other = await listInAppNotifications(
    db,
    { ...access, userId: OTHER_INBOX_USER },
    { limit: 100 },
  );
  expect(other.items.some((item) => seen.includes(item.id))).toBe(false);
  await expect(
    listInAppNotifications(db, access, { limit: 20, cursor: 'invalid' }),
  ).rejects.toThrow('NOTIFICATION_CURSOR_INVALID');
});

it('unread count has exact shape and counts only this company and user', async () => {
  const count = await unreadCount(db, access);
  expect(notificationUnreadCount.parse(count)).toEqual({ count: 100 });
  expect(
    await unreadCount(db, { ...access, userId: '01920000-0000-7000-8000-0000000000ff' }),
  ).toEqual({ count: 0 });
});

it('EXPLAIN ANALYZE uses ordered recipient and partial unread indexes without a sequential scan', async () => {
  for (const [statement, index] of [
    [inAppNotificationsStatement(access, { limit: 20 }), 'in_app_notifications_list_idx'],
    [unreadCountStatement(access), 'in_app_notifications_unread_idx'],
  ] as const) {
    const rows = await db.withTenant(access.companyId, (tx) =>
      tx.execute<Record<string, string>>(sql`EXPLAIN (ANALYZE, BUFFERS) ${statement}`),
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).toContain(index);
    expect(plan).not.toMatch(/Seq Scan on in_app_notifications/);
  }
});

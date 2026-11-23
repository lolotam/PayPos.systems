import { inAppNotificationPage } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  TENANT,
  USER,
  seedTwoTenants,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedInboxUsers } from '../../../../../../../packages/db/test/in-app-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { listInAppNotifications } from '../in-app-notifications.query.ts';

let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
const access = { companyId: TENANT.A.company, userId: USER };
const details = {
  stars: 2,
  branch_name_ar: 'السالمية',
  branch_name_en: 'Salmiya',
  business_date: '2026-11-07',
  performers: [{ name_ar: 'ليلى', name_en: 'Laila' }],
  customer_name: 'Synthetic customer',
  phone_last3: '123',
};

const commented = { ...details, comment: 'الخدمة اتأخرت\nوالمكان زحمة' };

// صف جرس مخزن كما يكتبه الـ worker؛ created_at متدرج عشان ترتيب الصفحة يبقى ثابت.
async function insertRow(key: string, locale: string, parameters: unknown, minutesAgo: number) {
  await owner`INSERT INTO in_app_notifications (company_id,id,recipient_user_id,business_id,branch_id,
    source_event_id,template_key,template_revision,locale,safe_parameters,created_at)
    VALUES (${TENANT.A.company},gen_random_uuid(),${USER},${TENANT.A.business},${TENANT.A.branch},
      gen_random_uuid(),${key},1,${locale},${JSON.stringify(parameters)}::text::jsonb,
      now() - ${minutesAgo} * interval '1 minute')`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedInboxUsers(owner);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => USER } });
  await insertRow('low_rating', 'ar', [{ name: 'details', type: 'details', value: details }], 0);
  await insertRow(
    'low_rating_with_comment',
    'ar',
    [{ name: 'details', type: 'details', value: commented }],
    1,
  );
  await insertRow(
    'generic_notice',
    'en',
    [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
    2,
  );
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

// قبل 61-1e كان القالب الجديد بيفشّل parse الصفحة كلها (invalid_union على template_key)، والصف القديم معاه.
it('returns both low-rating keys with their details next to a legacy row in one page', async () => {
  const page = await listInAppNotifications(db, access, { limit: 20 });
  expect(inAppNotificationPage.parse(page)).toEqual(page);
  expect(page.items.map((item) => item.template_key)).toEqual([
    'low_rating',
    'low_rating_with_comment',
    'generic_notice',
  ]);
  expect(page.items[0]?.safe_parameters).toEqual([
    { name: 'details', type: 'details', value: details },
  ]);
  expect(page.items[1]?.safe_parameters).toEqual([
    { name: 'details', type: 'details', value: commented },
  ]);
});

import { deliveryLogItem } from '@pospay/contracts';
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
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import {
  deliveryLogQueryResult,
  deliveryLogStatement,
  type LogAccess,
} from '../delivery-log.query.ts';

let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
const access: LogAccess = {
  companyId: TENANT.A.company,
  userId: USER,
  grants: [
    {
      permission: 'view:notifications:business',
      effect: 'ALLOW',
      scopeType: 'COMPANY',
      scopeId: TENANT.A.company,
    },
  ],
};
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => USER } });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  // Enough retained rows for the planner to prefer the ordered tenant index over a scan/sort.
  for (const tenant of Object.values(TENANT))
    await owner`
    INSERT INTO notification_attempts (company_id,id,business_id,branch_id,source_event_id,channel,template_key,
      template_revision,locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,failure_code,
      authorized_at,finished_at,outcome_known,created_at,updated_at)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, gen_random_uuid(),
      'whatsapp','test_notice',1,'ar',decode(repeat('01',32),'hex'),'test-v1','001','[]','FAILED','CONFIG_INVALID',
      '2026-10-01'::timestamptz,'2026-10-01'::timestamptz,true,
      '2026-10-01'::timestamptz + n * interval '1 second','2026-10-01'::timestamptz FROM generate_series(1,1000) n`;
  await owner`ANALYZE notification_attempts`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('projects the exact contract, paginates without overlap and respects tenant/business/branch grants', async () => {
  const first = await deliveryLogQueryResult(db, access, {}, { limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(first.next_cursor).not.toBeNull();
  for (const item of first.items) {
    expect(deliveryLogItem.parse(item)).toEqual(item);
    expect(item.company_id).toBe(TENANT.A.company);
    expect(Object.keys(item)).not.toEqual(
      expect.arrayContaining(['recipient_phone', 'recipient_hash', 'safe_parameters']),
    );
  }
  const next = await deliveryLogQueryResult(
    db,
    access,
    {},
    { limit: 2, cursor: first.next_cursor ?? '' },
  );
  expect(next.items.map((r) => r.id).some((id) => first.items.some((r) => r.id === id))).toBe(
    false,
  );
  expect(
    (await deliveryLogQueryResult(db, access, { businessId: TENANT.B.business }, { limit: 2 }))
      .items,
  ).toEqual([]);
  expect(
    (await deliveryLogQueryResult(db, access, { branchId: TENANT.A.branch }, { limit: 2 })).items,
  ).toHaveLength(2);
  expect(
    (await deliveryLogQueryResult(db, { ...access, grants: [] }, {}, { limit: 2 })).items,
  ).toEqual([]);
  const denied = {
    ...access,
    grants: [
      ...access.grants,
      {
        ...access.grants[0],
        permission: 'view:notifications:business',
        effect: 'DENY' as const,
        scopeType: 'BRANCH',
        scopeId: TENANT.A.branch,
      },
    ],
  };
  expect((await deliveryLogQueryResult(db, denied, {}, { limit: 2 })).items).toEqual([]);
});

it('a branch DENY never hides a company-wide attempt, whose branch is NULL', async () => {
  const companyWide = '01920000-0000-7000-8000-00000000c0de';
  await owner`
    INSERT INTO notification_attempts (company_id,id,business_id,branch_id,source_event_id,channel,template_key,
      template_revision,locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,failure_code,
      authorized_at,finished_at,outcome_known,created_at,updated_at)
    VALUES (${TENANT.A.company}, ${companyWide}, NULL, NULL, gen_random_uuid(), 'whatsapp', 'test_notice', 1, 'ar',
      decode(repeat('02',32),'hex'), 'test-v1', '002', '[]', 'FAILED', 'CONFIG_INVALID', '2026-10-02'::timestamptz,
      '2026-10-02'::timestamptz, true, '2026-10-02'::timestamptz, '2026-10-02'::timestamptz)`;
  const branchDenied: LogAccess = {
    ...access,
    grants: [
      ...access.grants,
      {
        permission: 'view:notifications:business',
        effect: 'DENY',
        scopeType: 'BRANCH',
        scopeId: TENANT.A.branch,
      },
    ],
  };
  const items = (await deliveryLogQueryResult(db, branchDenied, {}, { limit: 5 })).items;
  expect(items.map((item) => item.id)).toEqual([companyWide]);
  await owner`DELETE FROM notification_attempts WHERE company_id = ${TENANT.A.company} AND id = ${companyWide}`;
});

it('EXPLAIN ANALYZE uses the tenant ordered index without a notification-table sequential scan', async () => {
  const rows = await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute<Record<string, string>>(
      sql`EXPLAIN (ANALYZE, BUFFERS) ${deliveryLogStatement(access, {}, { limit: 20 })}`,
    ),
  );
  const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
  expect(plan).toContain('notification_attempts_log_idx');
  expect(plan).not.toMatch(/Seq Scan on notification_attempts/);
});

it('projects owner-visible EMAIL failure without address/hash/body or a phone suffix', async () => {
  await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`
    INSERT INTO notification_attempts (company_id,id,source_event_id,channel,template_key,template_revision,
      locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,failure_code,authorized_at,
      finished_at,outcome_known,created_at,updated_at)
    VALUES (${TENANT.A.company},'01920000-0000-7000-8000-00000000ee11','01920000-0000-7000-8000-00000000ee12',
      'email','document_expiring',1,'en',decode(repeat('04',32),'hex'),'email-test-v1',NULL,'[]','FAILED',
      'CONFIG_INVALID',now(),now(),true,now(),now())`),
  );
  const page = await deliveryLogQueryResult(db, access, {}, { limit: 1 });
  expect(deliveryLogItem.parse(page.items[0])).toMatchObject({
    channel: 'email',
    status: 'FAILED',
    failure_code: 'CONFIG_INVALID',
    phone_last3: null,
  });
  for (const field of ['recipient_email', 'recipient_hash', 'safe_parameters'])
    expect(JSON.stringify(page)).not.toContain(field);
});

it('shows the latest provider feedback of an email attempt and none for a WhatsApp one', async () => {
  const attempt = '01920000-0000-7000-8000-00000000ee21';
  const whatsapp = '01920000-0000-7000-8000-00000000ee22';
  await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`
    INSERT INTO notification_attempts (company_id,id,source_event_id,channel,template_key,template_revision,
      locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,authorized_at,recipient_email,
      recipient_phone,created_at,updated_at)
    VALUES
      (${TENANT.A.company},${attempt},'01920000-0000-7000-8000-00000000ee23','email','document_expiring',1,
        'en',decode(repeat('05',32),'hex'),'email-test-v1',NULL,'[]','PENDING',now(),
        'synthetic.owner@example.invalid',NULL,now(),now()),
      (${TENANT.A.company},${whatsapp},'01920000-0000-7000-8000-00000000ee25','whatsapp','test_notice',1,
        'ar',decode(repeat('06',32),'hex'),'test-v1','001','[]','PENDING',now(),NULL,
        '+96500000001',now(),now())`),
  );
  await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`
    UPDATE notification_attempts SET status = 'SENDING', sending_at = now(), execution_id = ${'01920000-0000-7000-8000-00000000ee24'}
    WHERE id = ${attempt}`),
  );
  await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`
    INSERT INTO notification_attempt_feedback (company_id,id,attempt_id,event_type,bounce_class,
      provider_event_digest,provider_timestamp,recorded_at)
    VALUES
      (${TENANT.A.company},'01920000-0000-7000-8000-00000000ee31',${attempt},'email.delivered',NULL,
        decode(repeat('07',32),'hex'),'2026-10-03T00:00:00Z'::timestamptz,now()),
      (${TENANT.A.company},'01920000-0000-7000-8000-00000000ee32',${attempt},'email.bounced','PERMANENT',
        decode(repeat('08',32),'hex'),'2026-10-05T00:00:00Z'::timestamptz,now()),
      (${TENANT.A.company},'01920000-0000-7000-8000-00000000ee33',${attempt},'email.delivery_delayed',NULL,
        decode(repeat('09',32),'hex'),'2026-10-04T00:00:00Z'::timestamptz,now())`),
  );
  const items = (await deliveryLogQueryResult(db, access, {}, { limit: 10 })).items;
  const email = items.find((item) => item.id === attempt);
  const whatsappItem = items.find((item) => item.id === whatsapp);
  expect(email?.provider_receipt).toBe('BOUNCED');
  expect(whatsappItem?.provider_receipt).toBeNull();
  expect(deliveryLogItem.safeParse(email).success).toBe(true);
  await owner`DELETE FROM notification_attempt_feedback WHERE attempt_id IN (${attempt}, ${whatsapp})`;
  await owner`DELETE FROM notification_attempts WHERE id IN (${attempt}, ${whatsapp})`;
});

it('EXPLAIN ANALYZE reads the latest feedback by index without a sequential scan', async () => {
  const rows = await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute<Record<string, unknown>>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${deliveryLogStatement(access, {}, { limit: 20 })}`,
    ),
  );
  const hasSeqScan = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return false;
    const record = node as Record<string, unknown>;
    if (
      record['Node Type'] === 'Seq Scan' &&
      (record['Relation Name'] === 'notification_attempts' ||
        record['Relation Name'] === 'notification_attempt_feedback')
    )
      return true;
    return Object.values(record).some((child) =>
      Array.isArray(child) ? child.some(hasSeqScan) : hasSeqScan(child),
    );
  };
  expect(JSON.stringify(rows)).toContain('notification_attempt_feedback_attempt_idx');
  expect(rows.some(hasSeqScan)).toBe(false);
});

import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, createPlatformEmailDatabase, type Database } from '../index.ts';
import type { PlatformEmailDatabase } from '../index.ts';

let test: TestDatabase;
let owner: postgres.Sql;
let intake: postgres.Sql;
let global: PlatformEmailDatabase;
let db: Database;
const hash = Buffer.alloc(32, 21);
const at = '2026-11-23T10:00:00Z';
const { A, B } = TENANT;
const ATTEMPT = '01920000-0000-7000-8000-00000000eb01';
const FEEDBACK = '01920000-0000-7000-8000-00000000eb02';
const run = (company: string, statement: SQL) =>
  db.withTenant(company, (tx) => tx.execute(statement));
const attempt = (company: string) => sql`
  INSERT INTO notification_attempts (company_id,id,business_id,source_event_id,channel,template_key,
    template_revision,locale,recipient_email,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,authorized_at,created_at,updated_at)
  VALUES (${company},${ATTEMPT},${B.business},${ATTEMPT},'email','document_expiring',1,'ar','owner@example.invalid',
    decode(repeat('01',32),'hex'),'email-test-v1',NULL,'[]','PENDING',now(),now(),now())`;

beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  intake = postgres(test.notificationsUrl, { max: 1, onnotice: () => undefined });
  await seedTwoTenants(test.ownerUrl);
  global = createPlatformEmailDatabase({ url: test.notificationsUrl });
  db = createDatabase({ url: test.appUrl, ids: { newId: () => FEEDBACK } });
  await run(B.company, attempt(B.company));
});
afterAll(async () => {
  await db.close();
  await global.close();
  await intake.end();
  await owner.end();
  await test.drop();
});

it('is ready with the exact grants and exposes transactions only', async () => {
  expect(Object.keys(global).sort()).toEqual(['close', 'ping', 'withGlobal']);
  await expect(global.ping()).resolves.toBeUndefined();
});

it('lets the intake insert a scrubbed row and confirm the enqueue', async () => {
  await expect(
    intake`INSERT INTO platform_email_feedback_inbox
        (id,provider_event_digest,provider_email_id,event_type,bounce_class,provider_timestamp,received_at,raw_event)
      VALUES (${FEEDBACK},${Buffer.alloc(32, 22)},'email-id-1','email.bounced','PERMANENT',${at},${at},
        '{"type":"email.bounced"}'::jsonb)`,
  ).resolves.toBeDefined();
  await expect(
    intake`UPDATE platform_email_feedback_inbox SET enqueue_confirmed_at = ${at} WHERE id = ${FEEDBACK}`,
  ).resolves.toBeDefined();
  await expect(
    intake`UPDATE platform_email_feedback_inbox SET raw_event = NULL WHERE id = ${FEEDBACK}`,
  ).resolves.toBeDefined();
});

it('keeps the lift column closed for the runtime role and for the owner', async () => {
  await expect(
    intake`UPDATE platform_email_suppressions SET last_suppressed_at = ${at}
      WHERE recipient_hash = ${Buffer.alloc(32, 23)}`,
  ).resolves.toBeDefined();
  await expect(
    owner`INSERT INTO platform_email_suppressions
        (recipient_hash,hash_key_id,source,first_suppressed_at,last_suppressed_at,lifted_at)
      VALUES (${Buffer.alloc(32, 24)},'test-v1','BOUNCE',${at},${at},${at})`,
  ).rejects.toThrow(/null_only/);
  const writable = await owner`
    SELECT 1 FROM pg_roles r WHERE r.rolname = 'pospay_notifications'
      AND has_column_privilege(r.oid,'platform_email_suppressions','lifted_at','UPDATE')`;
  expect(writable).toHaveLength(0);
});

it('gives pospay_app the boolean check only, and no table privilege', async () => {
  const raw = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(raw`SELECT 1 FROM platform_email_suppressions`).rejects.toThrow(/permission denied/);
    await expect(raw`SELECT 1 FROM platform_email_feedback_inbox`).rejects.toThrow(
      /permission denied/,
    );
    await expect(raw`SELECT 1 FROM platform_email_audit`).rejects.toThrow(/permission denied/);
    expect(await raw`SELECT platform_email_is_suppressed(${hash}) AS value`).toEqual([
      { value: false },
    ]);
    await expect(raw`SELECT platform_email_is_suppressed(NULL)`).rejects.toThrow(
      'SUPPRESSION_HASH_INVALID',
    );
  } finally {
    await raw.end();
  }
});

it('keeps the function away from the other runtime roles and the reader from the runtime', async () => {
  for (const url of [test.authUrl, test.dispatcherUrl, test.notificationsUrl]) {
    const raw = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      await expect(raw`SELECT platform_email_is_suppressed(${hash})`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await raw.end();
    }
  }
  await expect(intake`SET ROLE pospay_email_suppression_reader`).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    intake`SELECT 1 FROM notification_attempt_feedback`,
  ).rejects.toThrow(/permission denied/);
});

it('isolates the tenant evidence table', async () => {
  await run(
    B.company,
    sql`INSERT INTO notification_attempt_feedback
        (company_id,id,attempt_id,event_type,bounce_class,provider_event_digest,provider_timestamp,recorded_at)
      VALUES (${B.company},${FEEDBACK},${ATTEMPT},'email.bounced','PERMANENT',${Buffer.alloc(32, 25)},now(),now())`,
  );
  expect(
    await run(A.company, sql`SELECT id FROM notification_attempt_feedback`),
  ).toHaveLength(0);
  // مفتاح جديد كله: لو الـ INSERT policy وقعت، الانتهاك الوحيد المتبقي يكون 42501 من السياسة نفسها،
  // مش 23505 من تعارض المفتاح — فالتأكيد على SQLSTATE بيميّز السبب الصح. Drizzle بيلف خطأ postgres
  // في cause، فبمشّي على السلسلة لحد كود الحالة.
  const violation = await run(
    A.company,
    sql`INSERT INTO notification_attempt_feedback
        (company_id,id,attempt_id,event_type,bounce_class,provider_event_digest,provider_timestamp,recorded_at)
      VALUES (${B.company},'01920000-0000-7000-8000-00000000eb04',${ATTEMPT},'email.bounced','PERMANENT',${Buffer.alloc(32, 26)},now(),now())`,
  ).then(
    () => undefined as string | undefined,
    (error: unknown) => {
      const seen = new Set<object>();
      let current: unknown = error;
      while (typeof current === 'object' && current !== null && !seen.has(current)) {
        seen.add(current);
        const candidate = current as { code?: unknown; cause?: unknown };
        if (typeof candidate.code === 'string') return candidate.code;
        current = candidate.cause;
      }
      return undefined;
    },
  );
  expect(violation).toBe('42501');
  // الجدول insert-only لـ pospay_app: مفيش GRANT لـ UPDATE/DELETE أصلاً، فالكتابة بتترفض حتى على صف
  // الشركة نفسها، ومفيش سياسة RLS للتحديث أصلاً (spec 075، ADR-0014 §C). القراءة عبر الشركات محجوبة بالسياسات.
  await expect(
    run(A.company, sql`UPDATE notification_attempt_feedback SET event_type = 'email.failed'`),
  ).rejects.toThrow();
  await expect(
    run(B.company, sql`UPDATE notification_attempt_feedback SET event_type = 'email.failed'
        WHERE id = ${FEEDBACK}`),
  ).rejects.toThrow();
  await expect(run(A.company, sql`DELETE FROM notification_attempt_feedback`)).rejects.toThrow();
  const [row] = await run(
    B.company,
    sql`SELECT event_type FROM notification_attempt_feedback WHERE id = ${FEEDBACK}`,
  );
  expect(row?.['event_type']).toBe('email.bounced');
});

it('refuses an attempt that belongs to another tenant', async () => {
  await expect(
    run(
      A.company,
      sql`INSERT INTO notification_attempt_feedback
          (company_id,id,attempt_id,event_type,bounce_class,provider_event_digest,provider_timestamp,recorded_at)
        VALUES (${A.company},'01920000-0000-7000-8000-00000000eb03',${ATTEMPT},'email.bounced','PERMANENT',${Buffer.alloc(32, 27)},now(),now())`,
    ),
  ).rejects.toThrow();
});

it('rejects an inventory that drifts from the reviewed grants', async () => {
  try {
    await owner`GRANT UPDATE (lifted_at) ON platform_email_suppressions TO pospay_notifications`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_NOTIFICATIONS_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE UPDATE (lifted_at) ON platform_email_suppressions FROM pospay_notifications`;
  }
  try {
    await owner`GRANT SELECT ON platform_email_feedback_inbox TO pospay_app`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_NOTIFICATIONS_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE SELECT ON platform_email_feedback_inbox FROM pospay_app`;
  }
  await global.ping();
});

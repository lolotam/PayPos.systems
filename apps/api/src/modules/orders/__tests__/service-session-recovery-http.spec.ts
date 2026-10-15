import { createDatabase } from '@pospay/db';
import { errorMessages } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSessionRecovery, recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { AT, ids, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
});
afterAll(async () => {
  await f?.close();
});

it('returns 503 SESSION_RECOVERY_UNAVAILABLE with both messages when the proof insert is refused', async () => {
  const key = ids.newId();
  await f.h.owner`REVOKE INSERT ON service_session_recoveries FROM pospay_app`;
  try {
    const response = await f.h.send('POST', f.base, {
      cookie: f.cookie,
      company: f.company,
      key,
      body: { customer_id: f.customer, lines: [f.line()] },
    });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'SESSION_RECOVERY_UNAVAILABLE',
      ...errorMessages('SESSION_RECOVERY_UNAVAILABLE'),
    });
    expect(
      await f.h
        .owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`,
    ).toHaveLength(0);
  } finally {
    await f.h.owner`GRANT INSERT ON service_session_recoveries TO pospay_app`;
  }
});

it('sets proof-issue lock_timeout to 10s inside the transaction and restores the session afterwards', async () => {
  // القيمة وحدها لا تكفي: سيرفر الاختبار أصلاً lock_timeout=10s من سطر الأوامر، والمصدر session يثبت SET LOCAL.
  const single = createDatabase({ url: f.h.urls.app, ids, maxConnections: 1 });
  const setting = () =>
    single.withTenant(
      f.company,
      async (tx) =>
        (
          await tx.execute<{ timeout: string; source: string }>(
            sql`SELECT current_setting('lock_timeout') AS timeout, source FROM pg_settings WHERE name = 'lock_timeout'`,
          )
        )[0],
      { userId: f.userId },
    );
  await f.h.owner.unsafe(`CREATE OR REPLACE FUNCTION test_recovery_lock_timeout_seen() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO test_recovery_lock_timeout_seen
      SELECT current_setting('lock_timeout'), source FROM pg_settings WHERE name = 'lock_timeout';
      RETURN NEW;
    END $$`);
  await f.h.owner.unsafe(`CREATE TRIGGER test_recovery_lock_timeout_seen BEFORE INSERT ON service_session_recoveries
    FOR EACH ROW EXECUTE FUNCTION test_recovery_lock_timeout_seen()`);
  try {
    await single.withTenant(
      f.company,
      (tx) =>
        tx.execute(
          sql`CREATE TEMP TABLE test_recovery_lock_timeout_seen (timeout text, source text) ON COMMIT PRESERVE ROWS`,
        ),
      { userId: f.userId },
    );
    const before = await setting();
    await createSessionRecovery(single, ids, f.clock).issue({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      branchId: f.branch,
      key: ids.newId(),
      operation: 'record-service-session',
      occurredAt: AT,
    });
    const seen = await single.withTenant(
      f.company,
      (tx) =>
        tx.execute<{ timeout: string; source: string }>(
          sql`SELECT timeout, source FROM test_recovery_lock_timeout_seen`,
        ),
      { userId: f.userId },
    );
    expect(seen).toEqual([{ timeout: '10s', source: 'session' }]);
    expect(await setting()).toEqual(before);
  } finally {
    await f.h.owner.unsafe(
      'DROP TRIGGER IF EXISTS test_recovery_lock_timeout_seen ON service_session_recoveries',
    );
    await f.h.owner.unsafe('DROP FUNCTION IF EXISTS test_recovery_lock_timeout_seen()');
    await single.close();
  }
});

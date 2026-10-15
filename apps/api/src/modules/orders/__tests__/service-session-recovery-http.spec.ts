import { errorMessages } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSessionRecovery, recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { ids, sessionFixture, type SessionFixture } from './session.fixture.ts';

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

function holdRecoveryIdentity(key: string): { locked: Promise<void>; release: () => Promise<void> } {
  let releaseHold: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let markLocked: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const hash = recoveryKeyHash(key);
  const holder = f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        app_company_id()::text || ':recovery:' || ${f.userId}::uuid::text || ':' || ${f.business}::uuid::text
        || ':' || ${f.branch}::uuid::text || ':' || ${'record-service-session'} || ':' || ${hash}, 0))`);
      markLocked();
      await held;
    },
    { userId: f.userId },
  );
  return {
    locked,
    release: async () => {
      releaseHold();
      await holder;
    },
  };
}

it('returns 503 SESSION_RECOVERY_UNAVAILABLE when the identity advisory lock outlasts the issue deadline', async () => {
  const key = ids.newId();
  const gate = holdRecoveryIdentity(key);
  try {
    await gate.locked;
    const started = Date.now();
    await expect(
      createSessionRecovery(f.db, ids, f.clock, { issueTimeoutMs: 300 }).issue({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        branchId: f.branch,
        key,
        operation: 'record-service-session',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'SESSION_RECOVERY_UNAVAILABLE', status: 503 });
    // تحت lock_timeout الافتراضي 10s، فالانتظار لكل قفل لوحده يفشل هذا الحد.
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(
      await f.h
        .owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`,
    ).toHaveLength(0);
  } finally {
    await gate.release();
  }
});

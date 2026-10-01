import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PlatformWhatsappDatabase } from '@pospay/db';
import { phoneLockKey } from '@pospay/notifications';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { barrier, platformHarness, redeliver } from './platform-harness.ts';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createSuppressionGate } from '../persistence/drizzle-suppression.gate.ts';

let h: Awaited<ReturnType<typeof platformHarness>>;
beforeEach(async () => {
  h = await platformHarness();
});
afterEach(async () => {
  await h?.close();
});

it('STOP wins the same lock; an earlier READ COMMITTED statement cannot hide its commit', async () => {
  const entered = barrier();
  const release = barrier();
  const held: PlatformWhatsappDatabase = {
    ...h.global,
    withGlobal: (work) =>
      h.global.withGlobal(async (tx) => {
        const value = await work(tx);
        entered.release();
        await release.wait;
        return value;
      }),
  };
  const stop = h.accept(held);
  await entered.wait;
  const check = h.db.withTenant(TENANT.A.company, async (tx) => {
    expect(
      (
        await tx.execute<{ value: boolean }>(
          sql`SELECT public.platform_whatsapp_is_suppressed(${Buffer.from(h.identity.hash)}) AS value`,
        )
      )[0]?.value,
    ).toBe(false);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${phoneLockKey(h.identity.hash).toString()}::bigint)`,
    );
    return createSuppressionGate(tx).isSuppressed(h.identity.hash);
  });
  await h.waiting();
  release.release();
  await stop;
  expect(await check).toBe(true);
  for (const company of [TENANT.A.company, TENANT.B.company]) {
    const id = await h.authorize(company);
    expect(await h.read(id, company)).toMatchObject({
      status: 'SUPPRESSED',
      recipient_phone: null,
    });
  }
});

it('authorization wins; already-PENDING may finish while subsequent tenants stay suppressed', async () => {
  const entered = barrier();
  const release = barrier();
  const authorization = h.authorize(TENANT.A.company, { entered, release });
  await entered.wait;
  const stop = redeliver(() => h.accept());
  await h.waiting();
  release.release();
  const id = await authorization;
  await stop;
  expect(await h.read(id)).toMatchObject({ status: 'PENDING' });
  await h.module.send.execute(TENANT.A.company, id);
  expect(await h.read(id)).toMatchObject({ status: 'SENT', recipient_phone: null });
  expect(h.channel.calls).toBe(1);
  const before = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
  await expect(
    h.intake`UPDATE platform_whatsapp_suppressions SET opted_back_in_at=NULL`,
  ).rejects.toThrow(/permission denied/);
  await expect(h.intake`INSERT INTO platform_whatsapp_suppressions (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at,opted_back_in_at)
      VALUES (${Buffer.from(h.identity.hash)},'test-v1','STOP',now(),now(),NULL)`).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    h.owner`UPDATE platform_whatsapp_suppressions SET opted_back_in_at=now()`,
  ).rejects.toThrow(/null_only/);
  await redeliver(() => h.accept());
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(before);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(1);
  for (const company of [TENANT.A.company, TENANT.B.company]) {
    const next = await h.authorize(company);
    expect(await h.read(next, company)).toMatchObject({ status: 'SUPPRESSED' });
  }
});

it('rolls back inbox, suppression and audit together, then accepts retry', async () => {
  const failing: PlatformWhatsappDatabase = {
    ...h.global,
    withGlobal: (work) =>
      h.global.withGlobal(async (tx) => {
        await work(tx);
        throw new Error('TEST_ROLLBACK');
      }),
  };
  await expect(h.accept(failing)).rejects.toThrow('TEST_ROLLBACK');
  expect(await h.owner`SELECT id FROM platform_whatsapp_inbox`).toHaveLength(0);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(0);
  expect(await h.freshCheck(TENANT.A.company)).toBe(false);
  await redeliver(() => h.accept());
  expect(await h.freshCheck(TENANT.B.company)).toBe(true);
});

it('unknown committed outcome retries by digest without another STOP or timestamp', async () => {
  const unknown: PlatformWhatsappDatabase = {
    ...h.global,
    withGlobal: async (work) => {
      await h.global.withGlobal(work);
      throw new Error('TEST_COMMIT_ACK_LOST');
    },
  };
  await expect(h.accept(unknown)).rejects.toThrow(/TEST_COMMIT_ACK_LOST|outcome unknown/);
  const before = await committedSuppression();
  await redeliver(() => h.accept());
  expect(await h.owner`SELECT * FROM platform_whatsapp_suppressions`).toEqual(before);
  expect(await h.owner`SELECT id FROM platform_whatsapp_inbox`).toHaveLength(1);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(1);
});

async function committedSuppression() {
  for (let i = 0; i < 100; i++) {
    const rows = await h.owner`SELECT * FROM platform_whatsapp_suppressions`;
    if (rows.length === 1) return rows;
  }
  throw new Error('TEST_COMMITTED_STOP_MISSING');
}

it('lock timeout never commits a partial STOP or exposes raw input', async () => {
  const entered = barrier();
  const release = barrier();
  const held = h.authorize(TENANT.A.company, { entered, release });
  await entered.wait;
  await expect(h.accept()).rejects.toThrow();
  release.release();
  await held;
  expect(await h.owner`SELECT id FROM platform_whatsapp_inbox`).toHaveLength(0);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(0);
  expect(await h.freshCheck(TENANT.A.company)).toBe(false);
});

it('rejects a suppression check on a retained REPEATABLE READ snapshot', async () => {
  const client = postgres(h.testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(
      drizzle(client).transaction((tx) => createSuppressionGate(tx).isSuppressed(h.identity.hash), {
        isolationLevel: 'repeatable read',
      }),
    ).rejects.toThrow('SUPPRESSION_CHECK_FAILED');
  } finally {
    await client.end();
  }
});

it('a waiting authorization proceeds when the lock-winning STOP rolls back', async () => {
  const source = await h.request({});
  const entered = barrier();
  const release = barrier();
  const failing: PlatformWhatsappDatabase = {
    ...h.global,
    withGlobal: (work) =>
      h.global.withGlobal(async (tx) => {
        await work(tx);
        entered.release();
        await release.wait;
        throw new Error('TEST_STOP_ROLLBACK');
      }),
  };
  const stopped = h.accept(failing).catch((error: unknown) => error);
  await entered.wait;
  const authorization = h.authorize(TENANT.A.company, undefined, source);
  void authorization.catch(() => undefined);
  try {
    await h.waiting();
  } finally {
    release.release();
  }
  expect(await stopped).toMatchObject({ message: 'TEST_STOP_ROLLBACK' });
  expect(await h.read(await authorization)).toMatchObject({ status: 'PENDING' });
  expect(await h.owner`SELECT id FROM platform_whatsapp_inbox`).toHaveLength(0);
  expect(await h.owner`SELECT id FROM platform_whatsapp_audit`).toHaveLength(0);
});

it('a waiting STOP commits after authorization rolls back without an attempt', async () => {
  const entered = barrier();
  const release = barrier();
  const authorization = h
    .authorize(TENANT.A.company, {
      entered,
      release,
      rollback: true,
    })
    .catch((error: unknown) => error);
  await entered.wait;
  const stop = redeliver(() => h.accept());
  void stop.catch(() => undefined);
  try {
    await h.waiting();
  } finally {
    release.release();
  }
  expect(await authorization).toMatchObject({ message: 'TEST_AUTHORIZATION_ROLLBACK' });
  await stop;
  expect(await h.owner`SELECT id FROM notification_attempts`).toHaveLength(0);
  for (const company of [TENANT.A.company, TENANT.B.company]) {
    const id = await h.authorize(company);
    expect(await h.read(id, company)).toMatchObject({ status: 'SUPPRESSED' });
  }
});

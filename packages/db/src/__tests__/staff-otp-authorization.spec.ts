import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hash, lockKey, otpFixture } from '../../test/otp-fixtures.ts';

let f: Awaited<ReturnType<typeof otpFixture>>;
beforeAll(async () => {
  f = await otpFixture();
});
beforeEach(async () => {
  await f.db.ping();
});
afterAll(async () => {
  await f?.close();
});

async function stop() {
  await f.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lockKey(hash).toString()}::bigint)`;
    await tx`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES(${hash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp()) ON CONFLICT(recipient_hash) DO NOTHING`;
  });
}

describe('PREPARED is never permission; fresh STOP and immutable deadline gate release', () => {
  it('cannot claim before release, and duplicate processors have one acknowledged fence', async () => {
    const p = f.input();
    expect(await f.db.prepare(p)).toBe(true);
    expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(false);
    expect(
      await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, async () => true),
    ).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => f.db.claim(p.challenge.id, p.attemptId, randomUUID())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const live =
      await f.owner`SELECT state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database() AND usename='pospay_auth' AND state='idle in transaction'`;
    expect(live).toEqual([]);
  });
  it('release never happens: final locked timeout persists the finite result, and release cannot revive it', async () => {
    const p = f.input();
    await f.db.prepare(p);
    expect(
      await f.owner`SELECT state,wait_event_type FROM pg_stat_activity WHERE datname=current_database() AND usename='pospay_auth' AND state='idle in transaction'`,
    ).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 210));
    expect(await f.db.timeout(p.challenge.id, p.attemptId)).toBe('FAILED');
    const [row] =
      await f.owner`SELECT status,failure_code FROM auth_notification_attempts WHERE id=${p.attemptId}`;
    expect(row).toEqual({ status: 'FAILED', failure_code: 'PREPARATION_WINDOW_ENDED' });
    await expect(
      f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, async () => true),
    ).rejects.toThrow();
    expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(false);
  });
  it('a failure/unknown enqueue leaves any externally created job unable to claim', async () => {
    const p = f.input();
    await f.db.prepare(p);
    await f.db.failPreparation(p.challenge.id, p.attemptId, p.preparationDeadline);
    expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(false);
    expect(await f.db.pending(p.challenge.id, p.attemptId)).toMatchObject({ status: 'FAILED' });
  });
});
describe('PREPARED is never permission; fresh STOP and immutable deadline gate release', () => {
  it('STOP winning release clears the MAC and prevents the enqueued job from sending', async () => {
    const p = f.input();
    await f.db.prepare(p);
    await stop();
    expect(
      await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, async () => true),
    ).toBe(false);
    expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'SUPPRESSED', codeMac: null });
    expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(false);
  });
  it('STOP winning initial preparation with no user generates no code and retains only terminal metadata', async () => {
    await stop();
    const materializeMac = vi.fn(() => Buffer.alloc(32));
    const p = f.input({ materializeMac });
    expect(await f.db.prepare({ ...p, challenge: { ...p.challenge, userId: null } })).toBe(false);
    expect(materializeMac).not.toHaveBeenCalled();
    expect(await f.db.find(p.challenge.id)).toMatchObject({
      status: 'SUPPRESSED',
      codeMac: null,
      userId: null,
    });
  });
  it('retention never changes suppression and a purged job cannot reconstruct its challenge', async () => {
    await stop();
    await f.db.cleanup(10);
    expect(
      await f.owner`SELECT recipient_hash FROM platform_whatsapp_suppressions WHERE recipient_hash=${hash}`,
    ).toHaveLength(1);
    expect(await f.db.pending(randomUUID(), randomUUID())).toBeNull();
    expect(await f.db.claim(randomUUID(), randomUUID(), randomUUID())).toBe(false);
  });
});

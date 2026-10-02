import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { otpFixture, device, hash, lockKey } from '../../test/otp-fixtures.ts';
import { createOtpRuntime } from '../staff-otp-runtime.ts';
import { otpChallenges } from '../staff-otp-challenges.ts';

let f: Awaited<ReturnType<typeof otpFixture>>, runtime: ReturnType<typeof createOtpRuntime>;
beforeAll(async () => {
  f = await otpFixture();
  runtime = createOtpRuntime(f.test.authUrl, lockKey);
  await runtime.warm();
});
afterAll(async () => {
  await runtime?.close();
  await f?.close();
});

it.each([-1, 0, 1])(
  'real locked comparison at the exact 300-second boundary offset %i clears or consumes once',
  async (offset) => {
    const id = randomUUID();
    const [stored] =
      await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,
    code_mac,derivation_key_id,verification_key_id,status,failed_attempts,created_at,expires_at,updated_at)
    VALUES(${id},${hash},'synthetic-h',${f.userId},${f.owner.json(device)},${Buffer.alloc(32, 13)},
      'synthetic-d','synthetic-v','ACTIVE',0,statement_timestamp(),statement_timestamp()+interval '300 seconds',statement_timestamp())
    RETURNING expires_at`;
    if (stored === undefined) throw new Error('SYNTHETIC_CHALLENGE_MISSING');
    const clock = new Date(new Date(stored['expires_at']).getTime() + offset);
    const reader = otpChallenges({
      ...runtime,
      // This checks the auth-expiry edge with a frozen business clock; transport deadlines have separate tests.
      run: (work) => runtime.run(work, new Date(Date.now() + 5000)),
      now: async () => clock,
    });
    const compare = vi.fn(() => true);
    expect(await reader.consume(id, device, compare, () => hash)).toBe(
      offset < 0 ? f.userId : null,
    );
    expect(compare).toHaveBeenCalledTimes(offset < 0 ? 1 : 0);
    expect(await f.db.find(id)).toMatchObject({
      status: offset < 0 ? 'CONSUMED' : 'EXPIRED',
      codeMac: null,
    });
  },
);
it('hourly expiry cleanup clears the terminal MAC without reviving a stale delivery', async () => {
  const id = randomUUID();
  await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,
    code_mac,derivation_key_id,verification_key_id,status,failed_attempts,created_at,expires_at,updated_at)
    VALUES(${id},${hash},'synthetic-h',${f.userId},${f.owner.json(device)},${Buffer.alloc(32, 13)},
      'synthetic-d','synthetic-v','ACTIVE',0,statement_timestamp()-interval '301 seconds',
      statement_timestamp()-interval '1 second',statement_timestamp()-interval '301 seconds')`;
  await f.db.cleanup(100);
  expect(await f.db.find(id)).toMatchObject({ status: 'EXPIRED', codeMac: null });
  expect(await f.db.claim(id, randomUUID(), randomUUID())).toBe(false);
});

it('rechecks expiry after the user lock wait and never compares or consumes an expired proof', async () => {
  const id = randomUUID();
  const [stored] =
    await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,
    code_mac,derivation_key_id,verification_key_id,status,created_at,expires_at,updated_at)
    VALUES(${id},${hash},'synthetic-h',${f.userId},${f.owner.json(device)},${Buffer.alloc(32, 13)},
      'synthetic-d','synthetic-v','ACTIVE',statement_timestamp()-interval '299.65 seconds',
      statement_timestamp()+interval '350 milliseconds',statement_timestamp()) RETURNING expires_at`;
  if (stored === undefined) throw new Error('SYNTHETIC_CHALLENGE_MISSING');
  let signalLocked!: (now: Date) => void;
  const locked = new Promise<Date>((resolve) => {
    signalLocked = resolve;
  });
  const reader = otpChallenges({
    ...runtime,
    lock: async (tx, phoneHash) => {
      const now = await runtime.lock(tx, phoneHash);
      signalLocked(now);
      return now;
    },
  });
  const compare = vi.fn(() => true);
  let consumption: Promise<string | null> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`SELECT id FROM "user" WHERE id=${f.userId} FOR UPDATE`;
    consumption = reader.consume(id, device, compare, () => hash);
    void consumption.catch(() => undefined);
    expect((await locked).getTime()).toBeLessThan(new Date(stored['expires_at']).getTime());
    await tx`SELECT pg_sleep(greatest(0,extract(epoch FROM (${stored['expires_at']}::timestamptz-clock_timestamp())))+0.02)`;
  });
  expect(await consumption).toBeNull();
  expect(compare).not.toHaveBeenCalled();
  expect(await f.db.find(id)).toMatchObject({ status: 'EXPIRED', codeMac: null, consumedAt: null });
});
it('thirty-day purge removes the real ledger and challenges without touching STOP or reviving stale jobs', async () => {
  const id = randomUUID(),
    attempt = randomUUID();
  await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,status,
      created_at,expires_at,finished_at,updated_at)
    VALUES(${id},${hash},'synthetic-h',${f.userId},${f.owner.json(device)},'EXPIRED',
      statement_timestamp()-interval '31 days 300 seconds',statement_timestamp()-interval '31 days',
      statement_timestamp()-interval '31 days',statement_timestamp()-interval '31 days')`;
  await f.owner`INSERT INTO auth_notification_attempts(id,challenge_id,recipient_hash,hash_key_id,user_id,
      channel,template_key,template_revision,locale,status,send_deadline,preparation_deadline,finished_at,created_at,updated_at)
    SELECT ${attempt},id,recipient_hash,hash_key_id,user_id,'WHATSAPP','staff_otp',1,'ar','EXPIRED',expires_at,
      created_at+interval '200 milliseconds',finished_at,created_at,updated_at FROM auth_otp_challenges WHERE id=${id}`;
  await f.owner`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
    VALUES(${hash},'synthetic-h','STOP',statement_timestamp(),statement_timestamp())`;
  const before =
    await f.owner`SELECT * FROM platform_whatsapp_suppressions WHERE recipient_hash=${hash}`;
  expect(await f.db.cleanup(100)).toBe(1);
  expect(await f.db.find(id)).toBeNull();
  expect(await f.db.pending(id, attempt)).toBeNull();
  expect(await f.db.claim(id, attempt, randomUUID())).toBe(false);
  expect(
    await f.owner`SELECT * FROM platform_whatsapp_suppressions WHERE recipient_hash=${hash}`,
  ).toEqual(before);
});
it('deleting a user clears its active MAC and prevents every later proof or worker materialization', async () => {
  // Suppression above deliberately remains; an owner fixture isolates the identity-deletion trigger.
  const id = randomUUID();
  await f.owner`INSERT INTO auth_otp_challenges(id,recipient_hash,hash_key_id,user_id,device_context,code_mac,
    derivation_key_id,verification_key_id,status,created_at,expires_at,updated_at)
    VALUES(${id},${hash},'synthetic-h',${f.userId},${f.owner.json(device)},${Buffer.alloc(32, 13)},
      'synthetic-d','synthetic-v','ACTIVE',statement_timestamp(),statement_timestamp()+interval '300 seconds',statement_timestamp())`;
  await f.owner`DELETE FROM "user" WHERE id=${f.userId}`;
  expect(await f.db.find(id)).toMatchObject({ status: 'EXPIRED', userId: null, codeMac: null });
  expect(
    await f.db.consume(
      id,
      device,
      () => true,
      () => hash,
    ),
  ).toBeNull();
  expect(await f.db.materialize(id, randomUUID(), randomUUID())).toBeNull();
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { lockKey, otpFixture } from '../../test/otp-fixtures.ts';

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
const input = (recipientHash = Buffer.from(randomUUID().replaceAll('-', ''), 'utf8')) => {
  const p = f.input();
  return {
    ...p,
    challenge: {
      ...p.challenge,
      recipientHash,
    },
  };
};

it('reads fresh STOP after the authorization transaction has started behind its phone lock', async () => {
  let p = input();
  let preparation: Promise<boolean | Error> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint)`;
    p = input(p.challenge.recipientHash);
    preparation = f.db.prepare(p).catch((error: Error) => error);
    await tx`SELECT pg_sleep(0.015)`;
    await tx`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES(${p.challenge.recipientHash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
  });
  expect(await preparation).toBe(false);
  expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'SUPPRESSED', codeMac: null });
});

it('rolled-back STOP cannot suppress preparation and cannot leave its phone lock behind', async () => {
  let p = input();
  let preparation: Promise<boolean | Error> | undefined;
  await expect(
    f.owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint)`;
      await tx`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES(${p.challenge.recipientHash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
      p = input(p.challenge.recipientHash);
      preparation = f.db.prepare(p).catch((error: Error) => error);
      await tx`SELECT pg_sleep(0.015)`;
      throw new Error('SYNTHETIC_ROLLBACK');
    }),
  ).rejects.toThrow('SYNTHETIC_ROLLBACK');
  expect(await preparation).toBe(true);
  expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'ACTIVE' });
});

it('authorization winning STOP keeps its acknowledged permission under ADR-0013', async () => {
  const p = input();
  expect(await f.db.prepare(p)).toBe(true);
  expect(
    await f.db.release(p.challenge.id, p.attemptId, p.preparationDeadline, async () => true),
  ).toBe(true);
  await f.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint)`;
    await tx`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES(${p.challenge.recipientHash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
  });
  expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(true);
});

it('an acknowledged or unknown-to-the-caller committed STOP blocks the same auth ledger without materializing a code', async () => {
  let p = input();
  const materialize = () => {
    throw new Error('SYNTHETIC_CODE_MUST_NOT_BE_DERIVED');
  };
  const commitThenLoseAck = async () => {
    await f.owner.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint)`;
      await tx`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
        VALUES(${p.challenge.recipientHash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
    });
    throw new Error('SYNTHETIC_STOP_ACK_LOST');
  };
  await expect(commitThenLoseAck()).rejects.toThrow('SYNTHETIC_STOP_ACK_LOST');
  p = input(p.challenge.recipientHash);
  expect(await f.db.prepare({ ...p, materializeMac: materialize })).toBe(false);
  expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'SUPPRESSED', codeMac: null });
  expect(await f.db.claim(p.challenge.id, p.attemptId, randomUUID())).toBe(false);
});

it('a blocked preparation cancels and drains before the window ends, with no late challenge', async () => {
  let p = input();
  let failure: Promise<unknown> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint)`;
    p = input(p.challenge.recipientHash);
    const started = performance.now();
    failure = f.db.prepare(p).catch((error) => error);
    expect(await failure).toBeInstanceOf(Error);
    expect(performance.now() - started).toBeLessThan(200);
  });
  expect(await f.db.find(p.challenge.id)).toBeNull();
  const [row] =
    await f.owner`SELECT pg_try_advisory_xact_lock(${lockKey(p.challenge.recipientHash).toString()}::bigint) AS free`;
  expect(row?.free).toBe(true);
});

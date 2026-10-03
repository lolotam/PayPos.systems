import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { device, hash, lockKey, otpFixture, phone } from '../../test/otp-fixtures.ts';
import { createStaffOtpDatabase } from '../staff-otp-database.ts';

let f: Awaited<ReturnType<typeof otpFixture>>;
beforeAll(async () => {
  f = await otpFixture();
});
afterAll(async () => {
  await f?.close();
});

it('passes exact privilege inventory and denies tenant/bridge reads and alternative roles', async () => {
  await f.db.ping();
  for (const url of [
    f.test.appUrl,
    f.test.dispatcherUrl,
    f.test.notificationsUrl,
    f.test.ownerUrl,
  ]) {
    const wrong = createStaffOtpDatabase({ url, phoneLockKey: lockKey });
    await expect(wrong.ping()).rejects.toThrow('OTP_DATABASE_UNAVAILABLE');
    await wrong.close();
  }
  const auth = postgres(f.test.authUrl, { max: 1 });
  try {
    for (const table of ['companies', 'memberships', 'outbox', 'platform_whatsapp_suppressions'])
      await expect(auth.unsafe(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
    await expect(auth`SET ROLE pospay_app`).rejects.toThrow(/permission denied/);
  } finally {
    await auth.end();
  }
});
it('fifth failure exhausts atomically and clears the keyed MAC', async () => {
  const p = f.input();
  await f.db.prepare(p);
  const compare = vi.fn(() => false);
  await Promise.all(
    Array.from({ length: 5 }, () => f.db.consume(p.challenge.id, device, compare, () => hash)),
  );
  const c = await f.db.find(p.challenge.id);
  expect(c).toMatchObject({ status: 'EXHAUSTED', failedAttempts: 5, codeMac: null });
  expect(
    await f.db.consume(
      p.challenge.id,
      device,
      () => true,
      () => hash,
    ),
  ).toBeNull();
  expect(compare).toHaveBeenCalledTimes(5);
});
it('parallel correct proofs consume once and never recreate after replay', async () => {
  const p = f.input();
  await f.db.prepare(p);
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      f.db.consume(
        p.challenge.id,
        device,
        () => true,
        () => hash,
      ),
    ),
  );
  expect(results.filter((x) => x === f.userId)).toHaveLength(1);
  expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'CONSUMED', codeMac: null });
  expect(
    await f.db.consume(
      p.challenge.id,
      device,
      () => true,
      () => hash,
    ),
  ).toBeNull();
});
it('supersedes across devices without extending the old absolute expiry', async () => {
  const old = f.input();
  await f.db.prepare(old);
  const next = f.input();
  await f.db.prepare({
    ...next,
    challenge: { ...next.challenge, deviceContext: { ...device, deviceId: randomUUID() } },
  });
  expect(await f.db.find(old.challenge.id)).toMatchObject({
    status: 'SUPERSEDED',
    codeMac: null,
    expiresAt: old.challenge.expiresAt,
  });
  expect(
    await f.db.consume(
      next.challenge.id,
      device,
      () => true,
      () => hash,
    ),
  ).toBeNull();
});
it('refuses changed binding and terminalizes it without recovering the new destination', async () => {
  const p = f.input();
  await f.db.prepare(p);
  await f.owner`UPDATE "user" SET phone_number='+99900000002' WHERE id=${f.userId}`;
  expect(await f.db.find(p.challenge.id)).toMatchObject({ status: 'SUPERSEDED', codeMac: null });
  expect(await f.db.materialize(p.challenge.id, p.attemptId, randomUUID())).toBeNull();
  expect(await f.db.mappingValid(f.userId, hash, () => hash)).toBe(false);
  await f.owner`UPDATE "user" SET phone_number=${phone},phone_binding_approved_at=statement_timestamp() WHERE id=${f.userId}`;
  await f.owner`UPDATE "user" SET phone_binding_approved_at=statement_timestamp() WHERE id=${f.userId}`;
});
it('new-session failure preserves the durable old operator; success rotates only that device', async () => {
  const old = randomUUID(),
    other = randomUUID(),
    otherDevice = { ...device, deviceId: randomUUID() };
  await f.owner`INSERT INTO session(id,user_id,token,expires_at,purpose,staff_device_context,staff_authenticated_at,staff_absolute_deadline)
      VALUES(${old},${f.userId},'synthetic-old',statement_timestamp()+interval '8 hours','STAFF_POS',${f.owner.json(device)},statement_timestamp(),statement_timestamp()+interval '8 hours'),
      (${other},${f.userId},'synthetic-other',statement_timestamp()+interval '8 hours','STAFF_POS',${f.owner.json(otherDevice)},statement_timestamp(),statement_timestamp()+interval '8 hours')`;
  await expect(
    f.db.rotate(device, async () => {
      throw new Error('synthetic');
    }),
  ).rejects.toThrow();
  expect(await f.owner`SELECT id FROM session WHERE id=${old}`).toHaveLength(1);
  const fresh = randomUUID();
  await f.db.rotate(device, async () => {
    await f.owner`INSERT INTO session(id,user_id,token,expires_at,purpose,staff_device_context,staff_authenticated_at,staff_absolute_deadline)
        VALUES(${fresh},${f.userId},'synthetic-new',statement_timestamp()+interval '8 hours','STAFF_POS',${f.owner.json(device)},statement_timestamp(),statement_timestamp()+interval '8 hours')`;
    return { id: fresh };
  });
  expect(await f.owner`SELECT id FROM session WHERE id=${old}`).toHaveLength(0);
  expect(await f.owner`SELECT id FROM session WHERE id IN (${fresh},${other})`).toHaveLength(2);
});
it('the device lock survives durable session creation longer than the generic transaction idle limit', async () => {
  const old = randomUUID(),
    fresh = randomUUID();
  await f.owner`INSERT INTO session(id,user_id,token,expires_at,purpose,staff_device_context,staff_authenticated_at,staff_absolute_deadline)
    VALUES(${old},${f.userId},'synthetic-delayed-old',statement_timestamp()+interval '8 hours','STAFF_POS',${f.owner.json(device)},statement_timestamp(),statement_timestamp()+interval '8 hours')`;
  await expect(
    f.db.rotate(device, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      expect(await f.owner`SELECT id FROM session WHERE id=${old}`).toHaveLength(1);
      await f.owner`INSERT INTO session(id,user_id,token,expires_at,purpose,staff_device_context,staff_authenticated_at,staff_absolute_deadline)
      VALUES(${fresh},${f.userId},'synthetic-delayed-new',statement_timestamp()+interval '8 hours','STAFF_POS',${f.owner.json(device)},statement_timestamp(),statement_timestamp()+interval '8 hours')`;
      return { id: fresh };
    }),
  ).resolves.toEqual({ id: fresh });
  expect(await f.owner`SELECT id FROM session WHERE id=${old}`).toHaveLength(0);
});

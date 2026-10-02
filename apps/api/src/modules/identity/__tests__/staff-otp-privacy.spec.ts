import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { phoneLockKey } from '@pospay/notifications';
import { present } from '../../../../../../packages/db/test/present.ts';
import {
  staffHarness,
  paired,
  origin,
  phone,
  identity,
} from '../../../../test/staff-otp-harness.ts';

let f: Awaited<ReturnType<typeof staffHarness>>,
  company: string,
  member: string,
  device: Awaited<ReturnType<typeof paired>>;
const timing: number[] = [];
beforeAll(async () => {
  f = await staffHarness();
  const cookie = await f.h.signedInOperator('privacy-manager@synthetic.invalid');
  company = await f.h.onboard(cookie, 'Synthetic privacy');
  const business = (
    await f.h.send('POST', '/v1/businesses', {
      cookie,
      company,
      key: 'privacy-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  const branch = (
    await f.h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie,
      company,
      key: 'privacy-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(f.h, cookie, company, branch);
  const userId = await f.h.auth.provisionUser({
    email: 'privacy-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  member = randomUUID();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${company},${member},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
});
afterAll(async () => {
  await f?.close();
});

async function resetRates() {
  const prefix = f.h.redis.options.keyPrefix ?? '';
  if (!prefix.startsWith('test:')) throw new Error('SYNTHETIC_REDIS_SCOPE_REQUIRED');
  const keys = await f.h.redis.keys(`${prefix}staff-otp:*`);
  if (keys.length !== 0) await f.h.redis.del(...keys.map((key) => key.slice(prefix.length)));
}
async function request(number = phone) {
  await resetRates();
  const response = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-otp/request',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone: number, locale: 'ar' },
  });
  const duration = performance.now() - present(f.windowStarts.at(-1));
  timing.push(duration);
  expect(response.statusCode).toBe(202);
  expect({ ...response.json(), challenge_id: '' }).toEqual({
    status: 'ACCEPTED',
    challenge_id: '',
    expires_in: 300,
    retry_after: 60,
    recovery: 'ASK_MANAGER',
  });
  expect(response.headers['retry-after']).toBeUndefined();
  expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(duration).toBeGreaterThanOrEqual(190);
  expect(duration).toBeLessThan(350);
  return response.json().challenge_id as string;
}
it('eligible and unknown requests have comparable real HTTP post-preflight timing distributions', async () => {
  for (let i = 0; i < 3; i++) {
    await request();
    await request('+99900000002');
  }
});

it('eligible verify lock failure has exactly the wrong-code envelope and a bounded diagnostic', async () => {
  const id = await request();
  expect((await f.db.find(id))?.userId).toBeTruthy();
  const correct = await f.code(id);
  const wrong = correct === String(987654) ? String(987653) : String(987654);
  const verify = (challengeId: string, code: string) =>
    f.h.app.inject({
      method: 'POST',
      url: '/v1/devices/me/staff-otp/verify',
      headers: { authorization: `Device ${device.token}`, origin },
      payload: { challenge_id: challengeId, code },
    });
  const baseline = await verify(id, wrong);
  expect(baseline.statusCode).toBe(401);
  expect(baseline.json().code).toBe('OTP_INVALID');
  const before = f.failures.length;
  await f.h.owner.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${phoneLockKey(identity.identify(phone).hash).toString()}::bigint)`;
    const response = await verify(id, correct);
    expect(response.statusCode).toBe(baseline.statusCode);
    expect(response.body).toBe(baseline.body);
    expect(response.headers['content-type']).toBe(baseline.headers['content-type']);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    const unknown = await verify(randomUUID(), wrong);
    expect(unknown.statusCode).toBe(baseline.statusCode);
    expect(unknown.body).toBe(baseline.body);
  });
  expect(f.failures.slice(before)).toEqual(['VERIFY_PROOF:OPERATION_FAILED']);
});

it.each(['eligible', 'unknown', 'suppressed', 'nonmember'] as const)(
  'twenty-six wrong proofs have the same limits and verify window for %s',
  async (kind) => {
    const number = kind === 'unknown' ? '+99900000002' : phone;
    const phoneHash = Buffer.from(identity.identify(phone).hash);
    if (kind === 'suppressed')
      await f.h.owner`INSERT INTO platform_whatsapp_suppressions
      (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES(${phoneHash},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
    if (kind === 'nonmember')
      await f.h.owner`UPDATE memberships SET ends_at=clock_timestamp()
      WHERE company_id=${company} AND id=${member}`;
    try {
      const id = await request(number);
      if (kind === 'unknown') expect(await f.db.find(id)).toBeNull();
      const wrong =
        kind === 'eligible' && (await f.code(id)) === String(987654)
          ? String(987653)
          : String(987654);
      for (let i = 0; i < 26; i++) {
        const start = performance.now();
        const response = await f.h.app.inject({
          method: 'POST',
          url: '/v1/devices/me/staff-otp/verify',
          headers: { authorization: `Device ${device.token}`, origin },
          payload: { challenge_id: id, code: wrong },
        });
        expect(response.statusCode).toBe(i < 25 ? 401 : 429);
        expect(response.json().code).toBe(i < 25 ? 'OTP_INVALID' : 'TOO_MANY_REQUESTS');
        expect(performance.now() - start).toBeGreaterThanOrEqual(190);
      }
    } finally {
      if (kind === 'suppressed')
        await f.h
          .owner`DELETE FROM platform_whatsapp_suppressions WHERE recipient_hash=${phoneHash}`;
      if (kind === 'nonmember')
        await f.h
          .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${company} AND id=${member}`;
    }
  },
);
it.each(['lookup-lock', 'phone-lock', 'enqueue-unknown'] as const)(
  '%s produces the same headers/body/window, no late release or send',
  async (failure) => {
    for (let i = 0; i < 3; i++) {
      let id = '';
      f.control.loseEnqueueAck = failure === 'enqueue-unknown';
      try {
        if (failure === 'enqueue-unknown') id = await request();
        else
          await f.h.owner.begin(async (tx) => {
            if (failure === 'lookup-lock') await tx`LOCK TABLE "user" IN ACCESS EXCLUSIVE MODE`;
            else
              await tx`SELECT pg_advisory_xact_lock(${phoneLockKey(identity.identify(phone).hash).toString()}::bigint)`;
            id = await request();
          });
      } finally {
        f.control.loseEnqueueAck = false;
      }
      const job = f.jobs.find((item) => item.challengeId === id);
      if (job !== undefined) {
        expect(await f.db.claim(id, job.attemptId, randomUUID())).toBe(false);
        expect((await f.db.pending(id, job.attemptId))?.status).not.toBe('PENDING');
      }
    }
  },
);
it('nonmember and suppressed-without-user remain indistinguishable; distributions share the same fixed window', async () => {
  await f.h
    .owner`UPDATE memberships SET ends_at=clock_timestamp() WHERE company_id=${company} AND id=${member}`;
  const blocked = '+99900000003';
  await f.h
    .owner`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
    VALUES(${Buffer.from(identity.identify(blocked).hash)},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
  for (let i = 0; i < 3; i++) {
    const before = f.jobs.length;
    await request();
    await request(blocked);
    expect(f.jobs).toHaveLength(before);
  }
  expect(Math.max(...timing) - Math.min(...timing)).toBeLessThan(160);
});

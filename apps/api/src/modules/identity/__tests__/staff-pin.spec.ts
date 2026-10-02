import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { present } from '../../../../../../packages/db/test/present.ts';
import { paired, origin, phone, identity } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';

let f: { h: Harness; jobs: never[]; close(): Promise<void> },
  manager: string,
  actor: string,
  company: string,
  device: Awaited<ReturnType<typeof paired>>,
  userId: string,
  staffCookie: string;
const own = String(10).padStart(4, '0'),
  other = String(20).padStart(4, '0');
const issuanceFailures: string[] = [];
const signIn = (pin = own, number = phone) =>
  f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone: number, pin },
  });
const reset = (target: string, pin: string, cookie = manager) =>
  f.h.send('POST', '/v1/staff-pins/reset', {
    cookie,
    company,
    body: { user_id: target, pin },
  });
function observeIssuance(sessions: NonNullable<Harness['auth']['staff']>) {
  const issue = sessions.issue;
  vi.spyOn(sessions, 'issue').mockImplementation(async (...args) => {
    try {
      return await issue(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code =
        [
          '55P03',
          '57014',
          '25P03',
          'CONNECTION_CLOSED',
          'BOUNDED_COMMIT_UNKNOWN',
          'BOUNDED_DATABASE_UNAVAILABLE',
        ].find((code) => message.endsWith(code)) ?? 'OPERATION_FAILED';
      const stage =
        ['CREATE', 'ROTATE', 'VALIDATE', 'SIGN'].find((value) => message.includes(`_${value}_`)) ??
        'UNKNOWN';
      issuanceFailures.push(`${stage}:${code}`);
      throw error;
    }
  });
}
beforeAll(async () => {
  const h = await startHarness({ staffOrigin: origin });
  f = { h, jobs: [], close: () => h.close() };
  observeIssuance(present(f.h.auth.staff));
  manager = await f.h.signedInOperator('pin-manager@synthetic.invalid');
  actor = present(await f.h.auth.getSession(new Headers({ cookie: manager }))).userId;
  company = await f.h.onboard(manager, 'Synthetic PIN');
  const business = (
    await f.h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'pin-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  const branch = (
    await f.h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'pin-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(f.h, manager, company, branch);
  userId = await f.h.auth.provisionUser({
    email: 'pin-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  await f.h
    .owner`INSERT INTO platform_whatsapp_suppressions(recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
    VALUES(${Buffer.from(identity.identify(phone).hash)},'synthetic-h','STOP',clock_timestamp(),clock_timestamp())`;
});
afterAll(async () => {
  await f?.close();
});

it('OTP-disabled and STOP recovery uses the employee PIN; manager PIN cannot impersonate', async () => {
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: '/v1/devices/me/staff-otp/request',
        headers: { authorization: `Device ${device.token}`, origin },
        payload: { phone, locale: 'ar' },
      })
    ).statusCode,
  ).toBe(503);
  expect((await reset(actor, other)).status).toBe(204);
  expect((await reset(userId, own)).status).toBe(204);
  expect((await signIn(other)).statusCode).toBe(401);
  expect((await signIn(own, '+99900000002')).statusCode).toBe(401);
  expect(f.jobs).toHaveLength(0);
});
it('employee proof records the employee actor separately from manager resets', async () => {
  const result = await signIn();
  expect(result.statusCode).toBe(200);
  expect(result.json().user_id).toBe(userId);
  staffCookie = present(String(result.headers['set-cookie']).split(';')[0]);
  const rows = await f.h
    .owner`SELECT action,actor_user_id,entity_id FROM audit_log WHERE company_id=${company}
    AND action IN ('staff.pin_reset','staff.pin_signed_in') ORDER BY at`;
  expect(rows).toEqual([
    expect.objectContaining({ action: 'staff.pin_reset', actor_user_id: actor, entity_id: actor }),
    expect.objectContaining({ action: 'staff.pin_reset', actor_user_id: actor, entity_id: userId }),
    expect.objectContaining({
      action: 'staff.pin_signed_in',
      actor_user_id: userId,
      entity_id: userId,
    }),
  ]);
});
it('PIN session resolves only with Device and never grants normal administration or manager reset', async () => {
  expect(
    (
      await f.h.app.inject({
        method: 'GET',
        url: '/v1/devices/me/staff-session',
        headers: { authorization: `Device ${device.token}`, origin, cookie: staffCookie },
      })
    ).statusCode,
  ).toBe(200);
  expect((await reset(userId, other, staffCookie)).status).toBe(401);
  expect(
    (
      await f.h.app.inject({
        method: 'GET',
        url: '/v1/me/workspaces',
        headers: { cookie: staffCookie },
      })
    ).statusCode,
  ).toBe(401);
});
it('reset requires a covering manager membership and does not accept absent targets', async () => {
  expect((await reset(randomUUID(), own)).status).toBe(403);
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: '/v1/staff-pins/reset',
        headers: { authorization: `Device ${device.token}`, 'x-company-id': company, origin },
        payload: { user_id: userId, pin: own },
      })
    ).statusCode,
  ).toBe(403);
});

it('the staff route guard rechecks the approved binding while device and membership remain valid', async () => {
  const [bound] = await f.h.owner`SELECT phone_binding_approved_at FROM "user" WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=NULL WHERE id=${userId}`;
  try {
    const response = await f.h.app.inject({
      method: 'GET',
      url: '/v1/devices/me/staff-session',
      headers: { authorization: `Device ${device.token}`, origin, cookie: staffCookie },
    });
    expect(response.statusCode).toBe(401);
  } finally {
    await f.h
      .owner`UPDATE "user" SET phone_binding_approved_at=${bound?.['phone_binding_approved_at']} WHERE id=${userId}`;
  }
});

it('PIN infrastructure failures return availability instead of wrong proof', async () => {
  const spy = vi
    .spyOn(f.h.auth.staff, 'candidate')
    .mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_DETAIL'));
  try {
    const response = await signIn();
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('NOT_READY');
    expect(response.body).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
  } finally {
    spy.mockRestore();
  }
});

it('a post-create PIN binding check failure revokes the new session and preserves the previous operator', async () => {
  const sessions = f.h.auth.staff;
  const read = sessions.candidate.bind(sessions);
  const before = await f.h.owner`SELECT id FROM session WHERE purpose='STAFF_POS'
    AND staff_device_context->>'deviceId'=${device.id}`;
  const spy = vi
    .spyOn(sessions, 'candidate')
    .mockImplementationOnce(read)
    .mockImplementationOnce(read)
    .mockRejectedValueOnce(new Error('SYNTHETIC_POST_CREATE_FAILURE'));
  try {
    expect((await signIn()).statusCode).toBe(503);
    expect(
      await f.h.owner`SELECT id FROM session WHERE purpose='STAFF_POS'
      AND staff_device_context->>'deviceId'=${device.id}`,
    ).toEqual(before);
    const previous = await f.h.app.inject({
      method: 'GET',
      url: '/v1/devices/me/staff-session',
      headers: { authorization: `Device ${device.token}`, origin, cookie: staffCookie },
    });
    expect(previous.statusCode).toBe(200);
  } finally {
    spy.mockRestore();
  }
});
it('replacement PIN invalidates old proof; five failures lock even a correct PIN for fifteen minutes', async () => {
  expect((await reset(userId, other)).status).toBe(204);
  expect((await signIn(own)).statusCode).toBe(401);
  expect((await signIn(other)).statusCode, issuanceFailures.join(',')).toBe(200);
  for (let i = 0; i < 5; i++) expect((await signIn(own)).statusCode).toBe(401);
  expect((await signIn(other)).statusCode).toBe(401);
  const ttl = await f.h.redis.pttl(`pin:${company}:staff-user:${userId}:lock`);
  expect(ttl).toBeGreaterThan(890_000);
  expect(ttl).toBeLessThanOrEqual(900_000);
});

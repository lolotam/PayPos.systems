import { present } from '../../../db/test/present.ts';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createAuth, type AuthService } from '../config.ts';
import { STAFF_COOKIE } from '../staff-sessions.ts';
import { approvePhoneBinding } from '../approve-phone-binding.ts';
import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';

let test: TestDatabase, owner: postgres.Sql, auth: AuthService, userId: string;
let now = new Date('2026-10-02T00:00:00Z');
const device = {
  companyId: randomUUID(),
  businessId: randomUUID(),
  branchId: randomUUID(),
  deviceId: randomUUID(),
};
const cookieHeaders = (cookie: string) => new Headers({ cookie: present(cookie.split(';')[0]) });

beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  auth = await createAuth({
    databaseUrl: test.authUrl,
    secret: 'synthetic'.repeat(8),
    baseURL: 'https://api.synthetic.invalid',
    trustedOrigins: ['https://pos.synthetic.invalid', 'https://admin.synthetic.invalid'],
    ids: systemUuidV7(),
    secureCookies: true,
    cookieDomain: '.synthetic.invalid',
    clock: { now: () => now },
    onLog: () => undefined,
  });
  userId = await auth.provisionUser({
    email: 'synthetic@session.invalid',
    name: 'synthetic',
    password: 'synthetic'.repeat(8),
  });
});
afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await test?.drop();
});

it('persists server-only fields and a host-only Secure HttpOnly isolated cookie', async () => {
  const issued = await present(auth.staff).issue(userId, device);
  expect(issued.cookie).toContain(`${STAFF_COOKIE}=`);
  expect(issued.cookie).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(issued.cookie).not.toContain('Domain=');
  const [row] =
    await owner`SELECT purpose,staff_device_context,expires_at,staff_absolute_deadline,staff_authenticated_at FROM session WHERE id=${issued.session.sessionId}`;
  expect(row?.['purpose']).toBe('STAFF_POS');
  expect(row?.['staff_device_context']).toEqual(device);
  expect(new Date(row?.['expires_at']).getTime()).toBe(now.getTime() + 28_800_000);
  expect(new Date(row?.['staff_absolute_deadline'])).toEqual(new Date(row?.['expires_at']));
  now = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  expect(await present(auth.staff).resolve(cookieHeaders(issued.cookie), device)).not.toBeNull();
  now = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  expect(await present(auth.staff).resolve(cookieHeaders(issued.cookie), device)).toBeNull();
  expect(
    new Date(
      (await owner`SELECT expires_at FROM session WHERE id=${issued.session.sessionId}`)[0]?.[
        'expires_at'
      ],
    ).getTime(),
  ).toBe(issued.session.deadline.getTime());
});
it('refuses wrong context, substituted admin cookie, normal sessions and generic auth routes', async () => {
  const issued = await present(auth.staff).issue(userId, device),
    headers = cookieHeaders(issued.cookie);
  expect(
    await present(auth.staff).resolve(headers, { ...device, deviceId: randomUUID() }),
  ).toBeNull();
  expect(await auth.getSession(headers)).toBeNull();
  const substituted = present(issued.cookie.split(';')[0]).replace(
    STAFF_COOKIE,
    '__Secure-pospay.session_token',
  );
  expect(await auth.getSession(new Headers({ cookie: substituted }))).toBeNull();
  const response = await auth.handler(
    new Request('https://api.synthetic.invalid/v1/auth/get-session', {
      headers: { cookie: substituted },
    }),
  );
  expect(response.status).toBe(403);
  await expect(
    owner`UPDATE session SET expires_at=expires_at+interval '1 hour' WHERE id=${issued.session.sessionId}`,
  ).rejects.toThrow('STAFF_SESSION_IMMUTABLE');
  await expect(
    owner`UPDATE session SET staff_device_context=${owner.json({ ...device, branchId: randomUUID() })} WHERE id=${issued.session.sessionId}`,
  ).rejects.toThrow('STAFF_SESSION_IMMUTABLE');
});
it('rotates only the shared device after durable creation and logout preserves another device', async () => {
  const first = await present(auth.staff).issue(userId, device);
  const otherDevice = { ...device, deviceId: randomUUID() },
    other = await present(auth.staff).issue(userId, otherDevice);
  const replacementUser = systemUuidV7().newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified) VALUES(${replacementUser},'Synthetic replacement','replacement@session.invalid',true)`;
  const next = await present(auth.staff).issue(replacementUser, device);
  expect(next.session.userId).toBe(replacementUser);
  expect(await present(auth.staff).resolve(cookieHeaders(first.cookie), device)).toBeNull();
  expect(await present(auth.staff).resolve(cookieHeaders(next.cookie), device)).not.toBeNull();
  expect(
    await present(auth.staff).resolve(cookieHeaders(other.cookie), otherDevice),
  ).not.toBeNull();
  expect(await present(auth.staff).signOut(cookieHeaders(next.cookie), device)).toContain(
    'Expires=Thu, 01 Jan 1970',
  );
  expect(await present(auth.staff).resolve(cookieHeaders(next.cookie), device)).toBeNull();
  expect(
    await present(auth.staff).resolve(cookieHeaders(other.cookie), otherDevice),
  ).not.toBeNull();
});
it('only the approved operator binding becomes a candidate, with no phone in its audit', async () => {
  const staff = present(auth.staff),
    phone = '+99900000003';
  await staff.ready();
  expect(await staff.candidate(phone)).toBeNull();
  const options = {
    databaseUrl: test.authUrl,
    userId,
    phone,
    operator: 'synthetic-operator',
    ownershipVerified: true,
    approved: true,
    ids: systemUuidV7(),
    phoneLockKey: () => 0n,
  };
  await expect(approvePhoneBinding({ ...options, approved: false })).rejects.toThrow(
    'PHONE_BINDING_REFUSED',
  );
  await expect(approvePhoneBinding({ ...options, ownershipVerified: false })).rejects.toThrow(
    'PHONE_BINDING_REFUSED',
  );
  expect(await staff.candidate(phone)).toBeNull();
  await approvePhoneBinding(options);
  expect(await staff.candidate(phone)).toBe(userId);
  const rows =
    await owner`SELECT actor,action,details FROM platform_audit_log WHERE target_user_id=${userId}`;
  expect(rows).toContainEqual(
    expect.objectContaining({
      actor: 'synthetic-operator',
      action: 'phone.binding_approved',
      details: {},
    }),
  );
  expect(JSON.stringify(rows)).not.toContain(phone);
});
it('client-provided purpose/context and canonical phone cannot mutate a normal session or binding', async () => {
  const post = (path: string, body: unknown, cookie?: string) =>
    auth.handler(
      new Request(`https://api.synthetic.invalid/v1/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'https://admin.synthetic.invalid',
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const signedIn = await post('/sign-in/email', {
    email: 'synthetic@session.invalid',
    password: 'synthetic'.repeat(8),
    purpose: 'STAFF_POS',
    staffDeviceContext: device,
    staffAbsoluteDeadline: new Date(now.getTime() + 28_800_000).toISOString(),
  });
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const verified = present(await auth.getSession(new Headers({ cookie })));
  const [row] =
    await owner`SELECT purpose,staff_device_context,staff_absolute_deadline FROM session WHERE id=${verified.sessionId}`;
  expect(row).toMatchObject({
    purpose: null,
    staff_device_context: null,
    staff_absolute_deadline: null,
  });
  const before =
    await owner`SELECT phone_number,phone_binding_approved_at FROM "user" WHERE id=${userId}`;
  await post(
    '/update-user',
    {
      phoneNumber: '+99900000004',
      phoneBindingApprovedAt: new Date().toISOString(),
      name: 'Synthetic',
    },
    cookie,
  );
  expect(
    await owner`SELECT phone_number,phone_binding_approved_at FROM "user" WHERE id=${userId}`,
  ).toEqual(before);
});

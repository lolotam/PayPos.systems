import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { createAuth, type AuthService } from '../index.ts';

const ids = systemUuidV7();
const userId = ids.newId();
const workspace = {
  purpose: 'STAFF_PERSONAL' as const,
  companyId: ids.newId(),
  businessId: ids.newId(),
};
let test: TestDatabase, owner: postgres.Sql, auth: AuthService;
let now = new Date();
const headers = (value: string) => new Headers({ cookie: value.split(';')[0] ?? '' });
beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES(${userId},'Synthetic personal','personal@session.invalid','+99900000001',${now})`;
  auth = await createAuth({
    databaseUrl: test.authUrl,
    staffPhoneLockKey: () => 1n,
    secret: 'synthetic'.repeat(8),
    baseURL: 'https://api.pospay.systems',
    trustedOrigins: ['https://pos.pospay.systems'],
    ids,
    secureCookies: true,
    clock: { now: () => now },
    onLog: () => undefined,
  });
});
afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await test?.drop();
});

it('defaults to eight hours absolute without idle timeout or sliding renewal', async () => {
  const started = now;
  try {
    const issued = await auth.personal.issue(userId, workspace, async () => true);
    expect(issued.session.deadline.getTime() - started.getTime()).toBe(28_800_000);
    for (const elapsed of [14_400_000, 28_799_999]) {
      now = new Date(started.getTime() + elapsed);
      const resolved = await auth.personal.resolve(headers(issued.cookie));
      expect(resolved?.deadline).toEqual(issued.session.deadline);
    }
    now = new Date(started.getTime() + 28_800_000);
    expect(await auth.personal.resolve(headers(issued.cookie))).toBeNull();
  } finally {
    now = started;
  }
});
it('uses a host-only cookie, immutable absolute deadline and refuses purpose/token substitution', async () => {
  const issued = await auth.personal.issue(userId, workspace, async () => true);
  expect(issued.cookie).toContain('HttpOnly; Secure; SameSite=Lax');
  expect(issued.cookie).not.toContain('Domain=');
  expect(await auth.personal.resolve(headers(issued.cookie))).not.toBeNull();
  expect(await auth.getSession(headers(issued.cookie))).toBeNull();
  const swapped = issued.cookie.replace(
    'pospay-personal.session_token',
    '__Secure-pospay.session_token',
  );
  expect(await auth.getSession(headers(swapped))).toBeNull();
  expect(
    (
      await auth.handler(
        new Request('https://api.pospay.systems/v1/auth/get-session', {
          headers: headers(swapped),
        }),
      )
    ).status,
  ).toBe(403);
  await expect(
    owner`UPDATE session SET expires_at=expires_at+interval '1 second' WHERE id=${issued.session.sessionId}`,
  ).rejects.toThrow('STAFF_SESSION_IMMUTABLE');
  await expect(
    owner`UPDATE session SET staff_personal_context='{}'::jsonb WHERE id=${issued.session.sessionId}`,
  ).rejects.toThrow();
  now = new Date(issued.session.deadline.getTime());
  expect(await auth.personal.resolve(headers(issued.cookie))).toBeNull();
  now = new Date();
});
it('durable replacement invalidates older personal sessions; failed validation preserves the previous one', async () => {
  const first = await auth.personal.issue(userId, workspace, async () => true);
  await expect(auth.personal.issue(userId, workspace, async () => false)).rejects.toThrow(
    'PERSONAL_SESSION_REFUSED',
  );
  const cause = Object.assign(new Error('SYNTHETIC_FAILURE'), { code: 'SYNTHETIC_CAUSE' });
  await expect(
    auth.personal.issue(userId, workspace, async () => {
      throw cause;
    }),
  ).rejects.toMatchObject({
    message: 'PERSONAL_SESSION_REFUSED',
    cause: { code: 'SYNTHETIC_CAUSE' },
  });
  expect(
    await owner`SELECT id FROM session WHERE user_id=${userId} AND purpose='STAFF_PERSONAL'`,
  ).toHaveLength(1);
  expect(await auth.personal.resolve(headers(first.cookie))).not.toBeNull();
  const next = await auth.personal.issue(userId, workspace, async () => true);
  expect(await auth.personal.resolve(headers(first.cookie))).toBeNull();
  expect(await auth.personal.resolve(headers(next.cookie))).not.toBeNull();
  expect(await auth.personal.signOut(headers(next.cookie))).toContain('Expires=Thu, 01 Jan 1970');
  expect(await auth.personal.resolve(headers(next.cookie))).toBeNull();
});
it('changing the approved phone invalidates the personal purpose at database level', async () => {
  const issued = await auth.personal.issue(userId, workspace, async () => true);
  await owner`UPDATE "user" SET phone_number='+99900000002' WHERE id=${userId}`;
  expect(await auth.personal.resolve(headers(issued.cookie))).toBeNull();
  expect(await owner`SELECT id FROM session WHERE id=${issued.session.sessionId}`).toHaveLength(0);
});

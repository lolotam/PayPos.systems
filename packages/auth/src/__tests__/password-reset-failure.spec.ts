import { inspect } from 'node:util';

import { hashPassword, verifyPassword } from 'better-auth/crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import { systemUuidV7 } from '@pospay/ids';
import { createAuth, type AuthService } from '../index.ts';

// فشل قاعدة بيانات في مسار الاستهلاك (P1-4): الرد ثابت 500 من غير تفاصيل، ولا توكن ولا hash ولا
// كلمة مرور في أي log، والحالة ما بتتقسمش (الرابط لسه صالح بعد الفشل).
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const PASSWORD = 'member-chosen-pass';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;
// كل سطر log وصل مُستقبل Better Auth في الاختبارات — الرسائل منقّاة، والاختبار بيفحص إن مفيش سرّ فيها.
const authLogs: string[] = [];
// آخر hash رجّعه الـ hasher — اختبار التسريب بيتأكد إنه ما ظهرش في أي log حتى لو المعاملة رجعت.
let lastHash = '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  auth = await createAuth({
    databaseUrl: testDb.authUrl,
    staffPhoneLockKey: () => {
      throw new Error('STAFF_OPERATIONS_UNAVAILABLE');
    },
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: BASE,
    trustedOrigins: [ORIGIN],
    ids: systemUuidV7(),
    secureCookies: false,
    onLog: (entry) => authLogs.push(inspect(entry, { depth: 6 })),
    passwordHasher: {
      hash: async (password) => {
        lastHash = await hashPassword(password);
        return lastHash;
      },
      verify: ({ hash, password }) => verifyPassword({ hash, password }),
    },
  });
  owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await testDb?.drop();
});

const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';
const post = (path: string, body: Record<string, unknown>) =>
  auth.handler(
    new Request(`${BASE}/v1/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
const consume = (token: string, newPassword = PASSWORD) =>
  post('/reset-password', { token, newPassword });
const storedHash = async (userId: string) =>
  (
    await owner`SELECT password FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
  )[0]?.['password'] as string | null | undefined;
const liveTokens = async (userId: string) =>
  (
    await owner`SELECT identifier FROM verification
      WHERE value = ${userId} AND identifier LIKE 'reset-password:%' ORDER BY identifier`
  ).map((row) => String(row['identifier']).slice('reset-password:'.length));

async function createOrdinaryUser(email: string): Promise<{ userId: string; email: string }> {
  const userId = await auth.provisionUser({
    email,
    name: 'Ordinary',
    password: 'initial-password',
  });
  return { userId, email };
}

describe('a database failure in the reset path never leaks secrets', () => {
  it('a failing transaction answers a fixed 500, logs nothing sensitive, and the link still works', async () => {
    const { userId } = await createOrdinaryUser('leak@example.test');
    const before = await storedHash(userId);
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    await owner`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
      VALUES (${systemUuidV7().newId()}, 'reset-password:poison', ${userId},
              now() + interval '1 day', now(), now())`;
    // بقايا من تشغيلة فشلت قبل الفكس: بننضّف أي trigger/function من تشغيلة سابقة على نفس الداتابيز.
    await owner.unsafe('DROP TRIGGER IF EXISTS block_poison_cleanup ON verification');
    await owner.unsafe('DROP FUNCTION IF EXISTS block_poison_cleanup()');
    await owner.unsafe(`
      CREATE FUNCTION block_poison_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.identifier = 'reset-password:poison' THEN RAISE EXCEPTION 'forced cleanup failure'; END IF;
        RETURN OLD;
      END $$`);
    await owner.unsafe(`
      CREATE TRIGGER block_poison_cleanup BEFORE DELETE ON verification
      FOR EACH ROW EXECUTE FUNCTION block_poison_cleanup()`);
    const captured: string[] = [];
    const spies = (['error', 'warn', 'log'] as const).map((level) =>
      vi
        .spyOn(console, level)
        .mockImplementation((...parts: unknown[]) =>
          captured.push(parts.map((part) => inspect(part, { depth: 6 })).join(' ')),
        ),
    );
    authLogs.length = 0;
    let failed: Response;
    try {
      failed = await consume(link);
    } finally {
      for (const spy of spies) spy.mockRestore();
      await owner.unsafe('DROP TRIGGER block_poison_cleanup ON verification');
    }
    const logged = [...captured, ...authLogs].join('\n');
    // إجابة ثابتة من غير تفاصيل، ولا توكن ولا كلمة مرور ولا hash مخزّن في أي مخرَج log.
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(logged).not.toContain(link);
    expect(logged).not.toContain(PASSWORD);
    expect(lastHash).not.toBe('');
    expect(logged).not.toContain(lastHash);
    // السطر المصنّف الثابت وصل مستقبل الـ log فعلاً — الاختبار مش بيعدّي لأن مفيش حاجة اتسجلت.
    expect(logged).toContain('PASSWORD_RESET_FAILED');
    for (const row of await owner`SELECT password FROM account WHERE password IS NOT NULL`) {
      expect(logged).not.toContain(String(row['password']));
    }
    expect(logged).not.toContain('forced cleanup failure');
    // مفيش حالة نص نص: نفس الرابط لسه شغّال بعد الفشل.
    expect(await storedHash(userId)).toBe(before);
    expect(await liveTokens(userId)).toContain(link);
    expect((await consume(link)).status).toBe(200);
    expect(await liveTokens(userId)).toEqual([]);
  });
});

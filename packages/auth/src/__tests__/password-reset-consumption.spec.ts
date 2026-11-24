import { hashPassword, verifyPassword } from 'better-auth/crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import { systemUuidV7 } from '@pospay/ids';
import {
  createAuth,
  InvitationLinkRefusedError,
  MEMBER_INVITATION_LINK_TTL_MS,
  type AuthService,
} from '../index.ts';

// استهلاك رابط تعيين كلمة المرور (P1-1، P1-2): الاستهلاك والإصدار لنفس اليوزر مايتداخلوش، وكلمة المرور
// المتحطة بتقتل كل رابط تاني لليوزر في نفس المعاملة، وفشل أي خطوة بيرجّع كلمة المرور نفسها. الـ hash بيتوقف
// عند حاجز حقيقي بدل التوقيت: الاختبار هو اللي بيفتح الحاجز.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const COMPANY = '01920000-0000-7000-8000-00000000c001';
const PASSWORD = 'member-chosen-pass';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;
// كل سطر log وصل مُستقبل Better Auth في الاختبارات — الرسائل منقّاة، والاختبار بيفحص إن مفيش سرّ فيها.
const authLogs: string[] = [];

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}
const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

const gate = { armed: false, entered: deferred(), release: deferred() };
const arm = () => {
  gate.entered = deferred();
  gate.release = deferred();
  gate.armed = true;
};

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
    onLog: (entry) => authLogs.push(entry.message),
    passwordHasher: {
      hash: async (password) => {
        if (gate.armed) {
          gate.armed = false;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return hashPassword(password);
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

async function invitedUser(email: string): Promise<string> {
  const created = await auth.members.createInvitedMember({
    operationId: systemUuidV7().newId(),
    companyId: COMPANY,
    email,
    name: 'Member',
  });
  if (!created.createdByInvitation) throw new Error('the invitation should have created the account');
  return created.userId;
}

const issue = async (userId: string) =>
  tokenOf(
    await auth.members.issueInvitationLink({
      userId,
      companyId: COMPANY,
      redirectTo: `${ORIGIN}/set-password`,
      lifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
      now: new Date(),
    }),
  );

const liveTokens = async (userId: string) =>
  (
    await owner`SELECT identifier FROM verification
      WHERE value = ${userId} AND identifier LIKE 'reset-password:%' ORDER BY identifier`
  ).map((row) => String(row['identifier']).slice('reset-password:'.length));
const storedHash = async (userId: string) =>
  (
    await owner`SELECT password FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
  )[0]?.['password'] as string | null | undefined;

// عدد الـ backends المستنية قفل في الداتابيز دي — الحاجز اللي الاختبار بيقف عليه بدل الانتظار الزمني.
const lockWaiters = async () => {
  const [row] = await owner`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = ${testDb.name} AND wait_event_type = 'Lock'`;
  return Number(row?.['waiting']);
};
const waitForWaiters = (count: number) =>
  vi.waitFor(async () => expect(await lockWaiters()).toBeGreaterThanOrEqual(count), {
    timeout: 8_000,
    interval: 25,
  });

describe('a reset in flight and a re-issue never interleave (P1-1)', () => {
  it('a re-issue that lands while the first reset is hashing wins, and the first link is dead', async () => {
    const userId = await invitedUser('hashing@example.test');
    const first = await issue(userId);
    arm();
    const resetting = consume(first);
    await gate.entered.promise;
    const second = await issue(userId);
    gate.release.resolve();
    const reset = await resetting;
    // نتيجة واحدة بس: الإصدار كسب، فالرابط القديم ميت وكلمة المرور ما اتحطتش والرابط الجديد صالح.
    expect(reset.status).toBe(400);
    expect(await storedHash(userId)).toBeNull();
    expect(await liveTokens(userId)).toEqual([second]);
    expect((await consume(second)).status).toBe(200);
    expect(await liveTokens(userId)).toEqual([]);
  });

  it('a reset already inside its transaction goes first and the re-issue is refused', async () => {
    const userId = await invitedUser('inside@example.test');
    const first = await issue(userId);
    const holding = deferred();
    const taken = deferred();
    const holder = owner.begin(async (tx) => {
      await tx`SELECT 1 FROM "user" WHERE id = ${userId} FOR UPDATE`;
      taken.resolve();
      await holding.promise;
    });
    await taken.promise;
    const resetting = consume(first);
    await waitForWaiters(1);
    const reissuing = issue(userId).then(
      () => 'issued',
      (error: unknown) => error,
    );
    await waitForWaiters(2);
    holding.resolve();
    await holder;
    expect((await resetting).status).toBe(200);
    expect(await reissuing).toBeInstanceOf(InvitationLinkRefusedError);
    expect(await liveTokens(userId)).toEqual([]);
    expect(await storedHash(userId)).not.toBeNull();
  });
});

describe('a successful reset ends every other reset link of that user only (P1-2)', () => {
  it('uses one of two outstanding links, kills the other, and leaves other users and purposes alone', async () => {
    const { userId } = await createOrdinaryUser('ordinary@example.test');
    const bystander = await createOrdinaryUser('bystander@example.test');
    const operatorLink = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    const ordinaryLink = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    const bystanderLink = tokenOf(
      await auth.issuePasswordSetLink(bystander.userId, `${ORIGIN}/set-password`),
    );
    await owner`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
      VALUES (${systemUuidV7().newId()}, 'email-verification:keep-me', ${userId},
              now() + interval '1 day', now(), now())`;
    expect((await consume(operatorLink)).status).toBe(200);
    expect((await consume(ordinaryLink)).status).toBe(400);
    expect(await liveTokens(userId)).toEqual([]);
    expect(await liveTokens(bystander.userId)).toEqual([bystanderLink]);
    const [kept] =
      await owner`SELECT 1 FROM verification WHERE identifier = 'email-verification:keep-me'`;
    expect(kept).toBeDefined();
  });

  it('a failing cleanup step undoes the reset: nothing half-written and the same link still works', async () => {
    const { userId } = await createOrdinaryUser('cleanup@example.test');
    const before = await storedHash(userId);
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    await owner`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
      VALUES (${systemUuidV7().newId()}, 'reset-password:poison', ${userId},
              now() + interval '1 day', now(), now())`;
    await owner.unsafe(`
      CREATE FUNCTION block_poison_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.identifier = 'reset-password:poison' THEN RAISE EXCEPTION 'forced cleanup failure'; END IF;
        RETURN OLD;
      END $$`);
    await owner.unsafe(`
      CREATE TRIGGER block_poison_cleanup BEFORE DELETE ON verification
      FOR EACH ROW EXECUTE FUNCTION block_poison_cleanup()`);
    const failed = await consume(link);
    await owner.unsafe('DROP TRIGGER block_poison_cleanup ON verification');
    // الفشل ظاهر، وكلمة المرور ما اتحطتش، والرابط لسه صالح — مفيش حالة نص نص.
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await storedHash(userId)).toBe(before);
    expect(await liveTokens(userId)).toContain(link);
    expect((await consume(link)).status).toBe(200);
    expect(await liveTokens(userId)).toEqual([]);
    expect(await storedHash(userId)).not.toBe(before);
  });
});

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
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) =>
        captured.push(parts.map((part) => String(part)).join(' ')),
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
    const logged = [...captured.join('\n'), ...authLogs].join('\n');
    // إجابة ثابتة من غير تفاصيل، ولا توكن ولا كلمة مرور ولا hash مخزّن في أي مخرَج log.
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(logged).not.toContain(link);
    expect(logged).not.toContain(PASSWORD);
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

describe('the reset endpoint keeps Better Auth request validation', () => {
  it('a body token of the wrong type is a 400 validation error and the password is unchanged', async () => {
    const { userId } = await createOrdinaryUser('typed-token@example.test');
    const before = await storedHash(userId);
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    // توكن رقمي في الـ body ومعاه توكن صالح في الـ query: 400 VALIDATION_ERROR زي Better Auth الأصلي.
    const wrongType = await auth.handler(
      new Request(`${BASE}/v1/auth/reset-password?token=${encodeURIComponent(link)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ token: 12345, newPassword: 'wrong-type-pass' }),
      }),
    );
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await storedHash(userId)).toBe(before);
    expect(await liveTokens(userId)).toContain(link);
    // التوكن الصالح في الـ body لسه بيشتغل بعد الرفض.
    expect((await consume(link, 'typed-token-pass')).status).toBe(200);
  });

  it('a valid token in the query alone still works', async () => {
    const { userId, email } = await createOrdinaryUser('query-token@example.test');
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    const done = await auth.handler(
      new Request(`${BASE}/v1/auth/reset-password?token=${encodeURIComponent(link)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ newPassword: 'query-only-pass' }),
      }),
    );
    expect(done.status).toBe(200);
    expect(
      (await post('/sign-in/email', { email, password: 'query-only-pass' })).status,
    ).toBe(200);
  });
});

describe('the reset keeps Better Auth behaviour for the link holder', () => {
  it('sets the password so the user signs in with it, once only', async () => {
    const { userId, email } = await createOrdinaryUser('signin@example.test');
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    const done = await consume(link, 'brand-new-password');
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ status: true });
    expect((await post('/sign-in/email', { email, password: 'brand-new-password' })).status).toBe(
      200,
    );
    const again = await consume(link, 'another-new-password');
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('a too-short password is refused without consuming the link; an expired link is dead', async () => {
    const { userId } = await createOrdinaryUser('short@example.test');
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    const short = await consume(link, 'short');
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    expect(await liveTokens(userId)).toEqual([link]);
    await owner`UPDATE verification SET expires_at = now() - interval '1 minute'
      WHERE identifier = ${`reset-password:${link}`}`;
    const expired = await consume(link);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

async function createOrdinaryUser(email: string): Promise<{ userId: string; email: string }> {
  const userId = await auth.provisionUser({
    email,
    name: 'Ordinary',
    password: 'initial-password',
  });
  return { userId, email };
}

import { hashPassword, verifyPassword } from 'better-auth/crypto';
import postgres from 'postgres';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import { systemUuidV7 } from '@pospay/ids';
import { createAuth, type AuthService } from '../index.ts';

// تزامن مسار إعادة تعيين كلمة المرور (AC-ACT-23): طلبان بنفس التوكن ما بيحسبوش كلمة المرور مرتين،
// وإصدار رابط الـ operator بياخد قفل صف اليوزر قبل ما يحكم على الحساب إنه موظفة.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const COMPANY = '01920000-0000-7000-8000-00000000c001';
const PASSWORD = 'concurrent-reset-pass';
// مهلة الانتظار: لو الطلب التاني ما وصلش للـ hash، يبقى واقف على البوابة — وده هو السلوك الصح.
const CONCURRENT_WAIT_MS = 5_000;
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}
const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

/**
 * حاجز الـ hash: الطلب الأول بيقف جواه لحد ما الاختبار يفتح الباب، والطلب التاني لو وصل بيعلن
 * وصوله. الهدف إن الطلبين يتداخلوا قبل أي استهلاك — فالتشفير مرتين قبل الإصلاح، مرة واحدة بعده.
 */
const hashBarrier = {
  armed: false,
  calls: [] as string[],
  firstEntered: deferred(),
  secondEntered: deferred(),
  release: deferred(),
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
    onLog: () => undefined,
    passwordHasher: {
      hash: async (password) => {
        if (!hashBarrier.armed) return hashPassword(password);
        const index = hashBarrier.calls.push(password) - 1;
        if (index === 0) {
          hashBarrier.firstEntered.resolve();
          // الاختبار هو اللي بيفتح الباب — ما ينفعش الهاشر يفضل واقف لو الاختبار فشل.
          await hashBarrier.release.promise;
        }
        if (index === 1) hashBarrier.secondEntered.resolve();
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
const consume = (token: string, newPassword = PASSWORD) =>
  auth.handler(
    new Request(`${BASE}/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ token, newPassword }),
    }),
  );
const storedHash = async (userId: string) =>
  (
    await owner`SELECT password FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
  )[0]?.['password'] as string | null | undefined;

// مهلة من غير timer معلّق: ما نخليش العملية معلّقة بعد خلاص الاختبار.
const pause = (ms: number) => delay(ms, undefined, { ref: false });

// عدد الجلسات المستنية قفل في داتابيز الاختبار دي — بيثبت إن الطلب واقف على قفل صف اليوزر.
const lockWaiters = async () => {
  const [row] = await owner`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = ${testDb.name} AND wait_event_type = 'Lock'`;
  return Number(row?.['waiting']);
};
const waitForWaiters = (count: number) =>
  vi.waitFor(
    async () => {
      const waiting = await lockWaiters();
      expect(waiting, 'the link issuance never waited on the user row lock').toBeGreaterThanOrEqual(
        count,
      );
    },
    { timeout: 8_000, interval: 25 },
  );

async function createOrdinaryUser(email: string): Promise<{ userId: string; email: string }> {
  const userId = await auth.provisionUser({
    email,
    name: 'Ordinary',
    password: 'initial-password',
  });
  return { userId, email };
}

describe('two resets of the same live token at the same time (AC-ACT-23)', () => {
  it('hashes the password once: the second request waits for the first and is refused as a dead link', async () => {
    const { userId } = await createOrdinaryUser('concurrent@example.test');
    const link = tokenOf(await auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`));
    hashBarrier.calls.length = 0;
    hashBarrier.armed = true;
    const first = consume(link);
    try {
      const entered = await Promise.race([
        hashBarrier.firstEntered.promise.then(() => true),
        pause(CONCURRENT_WAIT_MS).then(() => false),
      ]);
      expect(entered, 'the first request never reached the password hash').toBe(true);
      // الطلب التاني بيبدأ بعد ما الأول وقف في الـ hash، عشان يتداخلوا مع بعض قبل أي استهلاك.
      const second = consume(link);
      await Promise.race([hashBarrier.secondEntered.promise, pause(CONCURRENT_WAIT_MS)]);
      // الباب بيتفتح: الطلب الأول يكمّل حساب الـ hash ويبتلع الرابط.
      hashBarrier.release.resolve();
      const [firstResponse, secondResponse] = await Promise.all([first, second]);
      // التشفير اتحسب مرة واحدة بس: الطلب التاني دخل بعد ما الأول استهلك الرابط.
      expect(hashBarrier.calls).toHaveLength(1);
      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(400);
      expect(await secondResponse.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect(await storedHash(userId)).not.toBeNull();
    } finally {
      // الباب بيتفتح في كل الأحوال: ما ينفعش الاختبار يترك الهاشر واقف.
      hashBarrier.release.resolve();
      hashBarrier.armed = false;
    }
  });
});

describe('the operator link issuance takes the user row lock (AC-ACT-23)', () => {
  it('waits for the lock and refuses a user that became staff inside the locking transaction', async () => {
    const { userId } = await createOrdinaryUser('locked-issue@example.test');
    const holding = deferred();
    const taken = deferred();
    const holder = owner.begin(async (tx) => {
      await tx`SELECT 1 FROM "user" WHERE id = ${userId} FOR UPDATE`;
      taken.resolve();
      await holding.promise;
      // الحساب بيتحوّل لحساب موظفة جوه نفس المعاملة اللي ماسكة القفل.
      await tx`UPDATE "user" SET staff_access_company_id = ${COMPANY},
        staff_access_operation_id = ${systemUuidV7().newId()} WHERE id = ${userId}`;
    });
    try {
      await taken.promise;
      const issuing = auth.issuePasswordSetLink(userId, `${ORIGIN}/set-password`);
      const settled = issuing.then(
        () => undefined,
        (error: unknown) => error,
      );
      // إصدار الرابط لازم يقف على قفل صف اليوزر: من غير كده بيشوف حالة قديمة من الحساب.
      await waitForWaiters(1);
      holding.resolve();
      await holder;
      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      expect(error instanceof Error ? error.message : '').toBe('STAFF_USER_CREDENTIAL_REFUSED');
      // مفيش رابط اتكتب: الحساب بقى موظفة والقرار اتاخد تحت القفل.
      expect(await owner`SELECT id FROM verification WHERE value = ${userId}`).toHaveLength(0);
    } finally {
      // القفل بيتفك في كل الأحوال، وإلا ما بعده في الملف بيفضل واقف على نفس الصف.
      holding.resolve();
      await holder.catch(() => undefined);
    }
  });
});

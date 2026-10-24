import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { createAuth, type AuthService } from '../config.ts';
import { staffDeviceSessionLockKey } from '../staff-session-fence.ts';
import { phoneLockKey } from '../../../notifications/src/phone-identity.ts';

let test: TestDatabase,
  owner: postgres.Sql,
  holder: postgres.Sql,
  auth: AuthService,
  userId: string;
const now = new Date();
const device = {
  companyId: randomUUID(),
  businessId: randomUUID(),
  branchId: randomUUID(),
  deviceId: randomUUID(),
};
const cookieHeaders = (cookie: string) => new Headers({ cookie: cookie.split(';')[0] ?? '' });
const rowsOf = async (id: string) => owner`SELECT id FROM session WHERE id=${id}`;

beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  // A second connection of its own: it holds the device lock while the sign-out and the sign-in queue on it.
  holder = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  auth = await createAuth({
    databaseUrl: test.authUrl,
    staffPhoneLockKey: phoneLockKey,
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
    email: 'synthetic@race.invalid',
    name: 'synthetic',
    password: 'synthetic'.repeat(8),
  });
  await owner`UPDATE "user" SET phone_number='+99900000001' WHERE id=${userId}`;
  await owner`UPDATE "user" SET phone_binding_approved_at=${now} WHERE id=${userId}`;
});
afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await holder?.end();
  await test?.drop();
});

// القفل الاستشاري للجهاز بيتاخد في معاملة الحامل نفسه ويفضل مقفول لحد ما الاختبار يحرره، عشان
// الطلبين يقفوا وراه بالترتيب اللي الاختبار بدأهم بيه.
const holdDeviceLock = async (deviceId: string) => {
  const control: { release: () => void; acquired: () => void } = {
    release: () => undefined,
    acquired: () => undefined,
  };
  const released = new Promise<boolean>((resolve) => {
    control.release = () => resolve(true);
  });
  const locked = new Promise<boolean>((resolve) => {
    control.acquired = () => resolve(true);
  });
  const key = staffDeviceSessionLockKey(deviceId);
  const holding = holder.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    control.acquired();
    await released;
  });
  await locked;
  return { release: () => control.release(), holding };
};

// كل خطوة بتبدأ بس لما الطلب اللي قبلها يكون واقف فعلاً على القفل: عدد الأقفال الاستشارية اللي
// مستنية في الداتابيز دي بيتقرأ تاني وتاني، والاستعلام نفسه هو الوقفة (بلا تايمر ولا sleep).
const waitForLockWaiters = async (count: number) => {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const [row] = await owner`SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    if (row?.['n'] === count) return;
  }
  throw new Error('LOCK_WAITERS_NOT_REACHED');
};

it("SO-13d the sign-out that commits first ends the old session and the queued sign-in's session lives", async () => {
  const old = await auth.staff.issue(userId, device, async () => true);
  const lock = await holdDeviceLock(device.deviceId);
  const signOut = auth.staff.signOut(cookieHeaders(old.cookie));
  void signOut.catch(() => undefined);
  await waitForLockWaiters(1);
  const replacement = auth.staff.issue(userId, device, async () => true);
  void replacement.catch(() => undefined);
  await waitForLockWaiters(2);
  lock.release();
  await lock.holding;
  const ended = await signOut;
  const issued = await replacement;
  expect(ended.ended).toBe(true);
  expect(await rowsOf(old.session.sessionId)).toEqual([]);
  expect(await auth.staff.resolve(cookieHeaders(issued.cookie), device)).not.toBeNull();
});

it('SO-13e the sign-in that commits first replaces the old row, so the sign-out finds nothing to end', async () => {
  const old = await auth.staff.issue(userId, device, async () => true);
  const lock = await holdDeviceLock(device.deviceId);
  const replacement = auth.staff.issue(userId, device, async () => true);
  void replacement.catch(() => undefined);
  await waitForLockWaiters(1);
  const signOut = auth.staff.signOut(cookieHeaders(old.cookie));
  void signOut.catch(() => undefined);
  await waitForLockWaiters(2);
  lock.release();
  await lock.holding;
  const issued = await replacement;
  const ended = await signOut;
  expect(ended.ended).toBe(false);
  expect(ended.cookie).toContain('Expires=Thu, 01 Jan 1970');
  expect(await auth.staff.resolve(cookieHeaders(issued.cookie), device)).not.toBeNull();
});

it('the sign-out waits on the lock of the device in its row, not on another device lock', async () => {
  const old = await auth.staff.issue(userId, device, async () => true);
  const lock = await holdDeviceLock(randomUUID());
  const ended = await auth.staff.signOut(cookieHeaders(old.cookie));
  expect(ended.ended).toBe(true);
  expect(await rowsOf(old.session.sessionId)).toEqual([]);
  lock.release();
  await lock.holding;
});

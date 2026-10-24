import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { staffAuthFixture } from './staff-auth.fixture.ts';
import { staffDeviceSessionLockKey } from '../staff-session-fence.ts';

let f: Awaited<ReturnType<typeof staffAuthFixture>>;
let holder: postgres.Sql;

const cookieHeaders = (cookie: string) => new Headers({ cookie: cookie.split(';')[0] ?? '' });
const rowsOf = async (id: string) => f.owner`SELECT id FROM session WHERE id=${id}`;

beforeAll(async () => {
  f = await staffAuthFixture();
  // A second connection of its own: it holds the device lock while the sign-out and the sign-in queue on it.
  holder = postgres(f.test.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await holder?.end();
  await f?.close();
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
const waitForLockWaiters = async (count: number, deadline: number) => {
  for (;;) {
    const [row] = await f.owner`SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    if (row?.['n'] === count) return;
    if (Date.now() > deadline) throw new Error('LOCK_WAITERS_NOT_REACHED');
  }
};

it("SO-13d the sign-out that commits first ends the old session and the queued sign-in's session lives", async () => {
  const old = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const lock = await holdDeviceLock(f.device.deviceId);
  const deadline = Date.now() + 10_000;
  try {
    const signOut = f.auth.staff.signOut(cookieHeaders(old.cookie));
    void signOut.catch(() => undefined);
    await waitForLockWaiters(1, deadline);
    const replacement = f.auth.staff.issue(f.userId, f.device, async () => true);
    void replacement.catch(() => undefined);
    await waitForLockWaiters(2, deadline);
    lock.release();
    await lock.holding;
    const ended = await signOut;
    const issued = await replacement;
    expect(ended.ended).toBe(true);
    expect(await rowsOf(old.session.sessionId)).toEqual([]);
    expect(await f.auth.staff.resolve(cookieHeaders(issued.cookie), f.device)).not.toBeNull();
  } finally {
    lock.release();
    await lock.holding;
  }
});

it('SO-13e the sign-in that commits first replaces the old row, so the sign-out finds nothing to end', async () => {
  const old = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const lock = await holdDeviceLock(f.device.deviceId);
  const deadline = Date.now() + 10_000;
  try {
    const replacement = f.auth.staff.issue(f.userId, f.device, async () => true);
    void replacement.catch(() => undefined);
    await waitForLockWaiters(1, deadline);
    const signOut = f.auth.staff.signOut(cookieHeaders(old.cookie));
    void signOut.catch(() => undefined);
    await waitForLockWaiters(2, deadline);
    lock.release();
    await lock.holding;
    const issued = await replacement;
    const ended = await signOut;
    expect(ended.ended).toBe(false);
    expect(ended.cookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(await f.auth.staff.resolve(cookieHeaders(issued.cookie), f.device)).not.toBeNull();
  } finally {
    lock.release();
    await lock.holding;
  }
});

it('the sign-out waits on the lock of the device in its row, not on another device lock', async () => {
  const old = await f.auth.staff.issue(f.userId, f.device, async () => true);
  const lock = await holdDeviceLock(randomUUID());
  try {
    const ended = await f.auth.staff.signOut(cookieHeaders(old.cookie));
    expect(ended.ended).toBe(true);
    expect(await rowsOf(old.session.sessionId)).toEqual([]);
  } finally {
    lock.release();
    await lock.holding;
  }
});

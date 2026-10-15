import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createPlatformWhatsappDatabase, type PlatformWhatsappDatabase } from '../index.ts';

// #241: withDeadline returns while begin() is still inside the callback. The rollback that
// follows must reject after idle_in_transaction_session_timeout, not throw from nextWrite.
let testDb: TestDatabase;
let owner: postgres.Sql;
let whatsapp: PlatformWhatsappDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  whatsapp = createPlatformWhatsappDatabase({
    url: testDb.notificationsUrl,
    maxConnections: 1,
  });
  // Open the socket first. withGlobal's 200ms deadline starts before BEGIN, so a cold
  // connect can expire before the callback and never sit idle (#241).
  await whatsapp.ping();
});

afterAll(async () => {
  await whatsapp.close();
  await owner.end();
  await testDb.drop();
});

const openNotifications = async (): Promise<number> => {
  const rows = await owner`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = 'pospay_notifications'
      AND state IS DISTINCT FROM 'idle'`;
  return rows.length;
};

const until = async (done: () => Promise<boolean>, label: string): Promise<void> => {
  const giveUp = Date.now() + 5_000;
  while (!(await done())) {
    if (Date.now() >= giveUp) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// close is I/O; the unpatched crash is a setImmediate. A timer turn then a check turn
// runs both before the assertion.
const afterIo = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => setImmediate(resolve), 0);
  });

const captureStrayErrors = (): {
  crashes: unknown[];
  rejections: unknown[];
  stop: () => void;
} => {
  const crashes: unknown[] = [];
  const rejections: unknown[] = [];
  const onUncaught = (error: Error): void => {
    crashes.push(error);
  };
  const onUnhandled = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  return {
    crashes,
    rejections,
    stop: () => {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUnhandled);
    },
  };
};

it('rejects the abandoned rollback after the server closes the idle transaction', async () => {
  const stray = captureStrayErrors();
  let release = (): void => undefined;
  let started = false;
  let callerError: unknown;
  const idle = new Promise<void>((resolve) => {
    release = resolve;
  });
  const caller = whatsapp.withGlobal(async () => {
    started = true;
    await idle;
  });
  const settled = caller.then(
    () => ({ failed: false as const }),
    (error: unknown) => {
      callerError = error;
      return { failed: true as const, error };
    },
  );
  try {
    await until(async () => {
      if (callerError !== undefined && !started) {
        throw new Error('transaction failed before its callback', { cause: callerError });
      }
      return started;
    }, 'the transaction callback to start');
    // Idle timer is already running. Also cover a poll that missed the short window.
    const idleSince = Date.now();
    await until(
      async () => (await openNotifications()) === 0 && Date.now() - idleSince >= 200,
      'the server to close the idle transaction',
    );
    await afterIo();
    await expect(settled).resolves.toMatchObject({
      failed: true,
      error: { name: 'TimeoutError' },
    });
    release();
    await afterIo();
    expect(stray.crashes).toEqual([]);
    expect(stray.rejections).toEqual([]);
    // Same pool, without withGlobal's 200ms deadline: a busy cluster can spend that
    // budget on reconnect, which is not the closed-socket throw (#241).
    await whatsapp.ping();
    await afterIo();
    expect(stray.crashes).toEqual([]);
    expect(stray.rejections).toEqual([]);
  } finally {
    release();
    await afterIo();
    stray.stop();
  }
});

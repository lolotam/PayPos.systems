import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createPlatformWhatsappDatabase, type PlatformWhatsappDatabase } from '../index.ts';
import type { Tx } from '../with-tenant.ts';

// #241: withDeadline returns while begin() is still inside the callback. After the server
// closes that idle transaction the pool can reconnect the same Connection. A statement from
// the abandoned callback must still reject, including its rollback, and must not run inside
// the transaction that reconnected the socket.
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

type Gate = { promise: Promise<void>; open: () => void };

const gate = (): Gate => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

type StatementOutcome = { code: string } | { name: string } | 'ran' | 'pending' | 'unknown';

// tx.execute wraps the driver error. DrizzleQueryError keeps the default name "Error"
// and leaves the postgres.js error, code included, on cause.
const codeOf = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
};

const nameOf = (error: unknown): string | undefined => (error instanceof Error ? error.name : undefined);

const statementOutcome = (error: unknown): StatementOutcome => {
  const code = codeOf(error);
  if (code !== undefined) return { code };
  const name = nameOf(error);
  if (name !== undefined) return { name };
  return 'unknown';
};

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

// The throw is what makes begin() send ROLLBACK. Wait until the reconnected transaction has
// read the marker first, so a leaked set_config is visible before that rollback undoes it.
const resumeAbandoned = async (
  tx: Tx,
  resume: Promise<void>,
  outcome: { value: StatementOutcome },
  statementDone: Gate,
  markerRead: Promise<void>,
): Promise<void> => {
  await resume;
  try {
    await tx.execute(sql`SELECT set_config('pospay.closed_lease', 'dead', true)`);
    outcome.value = 'ran';
  } catch (error) {
    outcome.value = statementOutcome(error);
    statementDone.open();
    await markerRead;
    throw error;
  }
  statementDone.open();
  await markerRead;
  throw new Error('closed lease statement ran');
};

const holdReconnected = async (
  tx: Tx,
  inside: Gate,
  statementDone: Promise<void>,
  markerRead: Gate,
): Promise<string | null> => {
  const [pid] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  if (pid === undefined) throw new Error('missing backend pid');
  inside.open();
  await statementDone;
  const [row] = await tx.execute<{ marker: string | null }>(
    sql`SELECT current_setting('pospay.closed_lease', true) AS marker`,
  );
  markerRead.open();
  return row?.marker ?? null;
};

const waitUntilStarted = async (started: () => boolean, callerError: () => unknown): Promise<void> => {
  await until(async () => {
    const error = callerError();
    if (error !== undefined && !started()) {
      throw new Error('transaction failed before its callback', { cause: error });
    }
    return started();
  }, 'the transaction callback to start');
};

const trackCaller = (
  run: Promise<unknown>,
  callerError: { current: unknown },
): Promise<{ failed: boolean; error?: unknown }> =>
  run.then(
    () => ({ failed: false }),
    (error: unknown) => {
      callerError.current = error;
      return { failed: true, error };
    },
  );

const waitForServerClose = async (): Promise<void> => {
  const idleSince = Date.now();
  await until(
    async () => (await openNotifications()) === 0 && Date.now() - idleSince >= 200,
    'the server to close the idle transaction',
  );
};

const openAll = (...gates: Gate[]): void => {
  for (const item of gates) item.open();
};

const abandonOnResume = (
  resume: Promise<void>,
  statementDone: Gate,
  markerRead: Promise<void>,
  outcome: { value: StatementOutcome },
  started: { current: boolean },
): Promise<unknown> =>
  whatsapp.withGlobal(async (tx) => {
    started.current = true;
    await resumeAbandoned(tx, resume, outcome, statementDone, markerRead);
  });

type Follower =
  | { committed: true; marker: string | null }
  | { committed: false; error: unknown };

const followReconnected = (
  inside: Gate,
  statementDone: Promise<void>,
  markerRead: Gate,
): Promise<Follower> =>
  whatsapp
    .withGlobal((tx) => holdReconnected(tx, inside, statementDone, markerRead))
    .then(
      (marker) => ({ committed: true as const, marker }),
      (error: unknown) => ({ committed: false as const, error }),
    );

it('rejects the abandoned rollback after the server closes the idle transaction', async () => {
  const stray = captureStrayErrors();
  const resume = gate();
  const inside = gate();
  const statementDone = gate();
  const markerRead = gate();
  const outcome: { value: StatementOutcome } = { value: 'pending' };
  const started = { current: false };
  const callerError: { current: unknown } = { current: undefined };
  const settled = trackCaller(
    abandonOnResume(resume.promise, statementDone, markerRead.promise, outcome, started),
    callerError,
  );
  try {
    await waitUntilStarted(
      () => started.current,
      () => callerError.current,
    );
    await waitForServerClose();
    await afterIo();
    await expect(settled).resolves.toMatchObject({
      failed: true,
      error: { name: 'TimeoutError' },
    });
    const follower = followReconnected(inside, statementDone.promise, markerRead);
    await inside.promise;
    resume.open();
    const followed = await follower;
    await afterIo();
    expect(stray.crashes).toEqual([]);
    expect(stray.rejections).toEqual([]);
    expect({ statement: outcome.value, follower: followed }).toEqual({
      statement: { code: 'CONNECTION_CLOSED' },
      follower: { committed: true, marker: null },
    });
    await whatsapp.ping();
    await afterIo();
    expect(stray.crashes).toEqual([]);
    expect(stray.rejections).toEqual([]);
  } finally {
    openAll(resume, inside, statementDone, markerRead);
    await afterIo();
    stray.stop();
  }
});

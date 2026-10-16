import { readMigrationFiles } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

import { runConcurrentIndex } from './recover-concurrent-index.ts';

const CONCURRENT =
  /^\s*(?:--[^\r\n]*[\r\n]\s*)*(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i;

type DataSteps = Readonly<Record<string, (owner: postgres.Sql) => Promise<void>>>;

// Only the exact column-0 form is a marker. Any other line that mentions it (indented, inside a block comment,
// different case or spacing) would be skipped by a looser parser and silently lose its step, so it aborts instead.
const MARKER = /^-- pospay:data-step ([a-z0-9-]+)$/;
// `pospay:` inside a SQL comment is reserved for markers, so a misspelt one (data-stpe, datastep…) fails closed too.
const RESERVED = /pospay\s*:\s*data|(--|\/\*).*pospay\s*:|^\s*\*.*pospay\s*:/i;

const SESSION_LOST = 'Migration session lost its advisory lock; aborting';

// SQLSTATE for a backend that is gone, plus the codes postgres.js puts on a dead socket.
const CONNECTION_LOSS: ReadonlySet<string> = new Set([
  '57P01',
  '57P02',
  '08003',
  '08006',
  '08000',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'ECONNRESET',
]);

interface MigrationSession {
  lost: boolean;
}

interface PendingMigration {
  readonly sql: readonly string[];
  readonly hash: string;
  readonly folderMillis: number;
}

function migrationSteps(statements: readonly string[], dataSteps: DataSteps) {
  const names = [
    ...new Set(
      statements.flatMap((statement) =>
        statement
          .split(/\r?\n/)
          .filter((line) => RESERVED.test(line))
          .map((line) => {
            const name = MARKER.exec(line)?.[1];
            if (name === undefined)
              throw new Error('Malformed migration data step marker; migration aborted');
            return name;
          }),
      ),
    ),
  ];
  return names.map((name) => {
    const step = dataSteps[name];
    if (!Object.hasOwn(dataSteps, name) || step === undefined)
      throw new Error(`Unknown migration data step ${name}; migration aborted`);
    return step;
  });
}

function sessionLost(cause?: unknown): Error {
  return cause === undefined ? new Error(SESSION_LOST) : new Error(SESSION_LOST, { cause });
}

function isConnectionLoss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return typeof error.code === 'string' && CONNECTION_LOSS.has(error.code);
}

interface DeferredQuery {
  handler: (query: DeferredQuery) => unknown;
  reject: (error: Error) => void;
  then: (...args: unknown[]) => unknown;
}

function isDeferredQuery(returned: object): returned is DeferredQuery {
  return (
    'handler' in returned &&
    typeof returned.handler === 'function' &&
    'reject' in returned &&
    typeof returned.reject === 'function' &&
    'then' in returned &&
    typeof returned.then === 'function'
  );
}

// postgres.js sends a query only when it is first consumed (then, catch, finally, execute, forEach or
// cursor), and every one of those goes through query.handler. One built before the socket died would
// otherwise run on the reconnected backend without the lock, so that single hook rejects the query
// instead. Interpolation never consumes it, and a helper has no handler, so the same object is returned.
function guardDeferredQuery<T>(session: MigrationSession, returned: T): T {
  if (typeof returned !== 'object' || returned === null || !isDeferredQuery(returned))
    return returned;
  const handler = returned.handler;
  returned.handler = (query) => (session.lost ? query.reject(sessionLost()) : handler(query));
  return returned;
}

// Throw before the call: a follow-up write on a socket postgres.js already closed throws outside the
// promise. Return the client's own value; a helper, a nested fragment and PendingQuery are not Promises.
function throwIfLost<T>(session: MigrationSession, call: () => T): T {
  if (session.lost) throw sessionLost();
  return guardDeferredQuery(session, call());
}

// An in-flight statement rejects with the driver's code. Map that once for the whole run and keep the
// original error. The next call is refused before it writes, and unlock skips a dead socket.
function abortIfConnectionLost(session: MigrationSession, error: unknown): never {
  if (!isConnectionLoss(error)) throw error;
  session.lost = true;
  throw sessionLost(error);
}

function requireSingleConnection(client: postgres.Sql): void {
  if (client.options.max !== 1) {
    throw new Error(
      'applyMigrations requires a postgres.js client with max: 1 so the advisory lock and every statement share one connection',
    );
  }
}

// parseOptions stores undefined when the caller omitted onclose; the published type marks it required.
function armLossWatch(client: postgres.Sql, session: MigrationSession): () => void {
  const previous = client.options.onclose;
  client.options.onclose = (connectionId) => {
    session.lost = true;
    previous?.(connectionId);
  };
  return () => {
    client.options.onclose = previous;
  };
}

function guardedUnsafe(client: postgres.Sql, session: MigrationSession): postgres.Sql['unsafe'] {
  return ((...args: Parameters<postgres.Sql['unsafe']>) =>
    throwIfLost(session, () =>
      Reflect.apply(client.unsafe, client, args),
    )) as postgres.Sql['unsafe'];
}

function guardedBegin(client: postgres.Sql, session: MigrationSession): postgres.Sql['begin'] {
  return ((...args: Parameters<postgres.Sql['begin']>) =>
    throwIfLost(session, () => {
      if (typeof args[0] === 'string' && typeof args[1] !== 'function')
        throw new Error('Missing migration transaction callback');
      return Reflect.apply(client.begin, client, args);
    })) as postgres.Sql['begin'];
}

// file() builds a deferred query, so it gets the same loss check as unsafe. reserve() would wait for the
// only connection (the one holding the lock) and hand out a handle this guard cannot see, so it is refused.
function guardedFile(client: postgres.Sql, session: MigrationSession): postgres.Sql['file'] {
  return ((...args: Parameters<postgres.Sql['file']>) =>
    throwIfLost(session, () =>
      Reflect.apply(client.file, client, args),
    )) as postgres.Sql['file'];
}

function refuseReserve(): never {
  throw new Error('reserve() is not available in a migration data step');
}

// Refuses the next call after the socket closes, and still invokes the client the caller passed in.
function guardedSql(client: postgres.Sql, session: MigrationSession): postgres.Sql {
  const guarded = {
    begin: guardedBegin(client, session),
    unsafe: guardedUnsafe(client, session),
    file: guardedFile(client, session),
    reserve: refuseReserve,
  };
  return new Proxy(client, {
    apply(target, _thisArg, args) {
      return throwIfLost(session, () => Reflect.apply(target, target, args));
    },
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.hasOwn(guarded, property))
        return guarded[property as keyof typeof guarded];
      return Reflect.get(target, property, receiver);
    },
  });
}

async function holdMigrationLock(sql: postgres.Sql): Promise<void> {
  await sql`SELECT pg_advisory_lock(hashtext('pospay:migrations'))`;
}

async function unlockMigration(sql: postgres.Sql, session: MigrationSession): Promise<void> {
  if (session.lost) return;
  try {
    await sql`SELECT pg_advisory_unlock(hashtext('pospay:migrations'))`;
  } catch (error) {
    if (session.lost || isConnectionLoss(error)) {
      session.lost = true;
      return;
    }
    throw error;
  }
}

async function finishSession(
  sql: postgres.Sql,
  session: MigrationSession,
  restoreClose: () => void,
): Promise<void> {
  try {
    await unlockMigration(sql, session);
  } finally {
    restoreClose();
  }
}

async function applyPrefix(sql: postgres.Sql, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    if (/^\s*(?:--[^\r\n]*[\r\n]\s*)*CREATE\b/i.test(statement)) {
      await runConcurrentIndex(sql, statement);
    } else {
      await sql.unsafe(statement);
    }
  }
}

async function applyOne(
  sql: postgres.Sql,
  migration: PendingMigration,
  steps: readonly ((owner: postgres.Sql) => Promise<void>)[],
): Promise<void> {
  for (const step of steps) await step(sql);
  const statements = migration.sql.filter((statement) => statement.trim() !== '');
  const firstTransactional = statements.findIndex((statement) => !CONCURRENT.test(statement));
  const prefixLength = firstTransactional === -1 ? statements.length : firstTransactional;
  if (statements.slice(prefixLength).some((statement) => CONCURRENT.test(statement))) {
    throw new Error('Concurrent indexes must precede transactional migration statements');
  }
  await applyPrefix(sql, statements.slice(0, prefixLength));
  await sql.begin(async (tx) => {
    for (const statement of statements.slice(prefixLength)) await tx.unsafe(statement);
    await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
  });
}

async function applyPending(
  sql: postgres.Sql,
  migrations: readonly PendingMigration[],
  dataSteps: DataSteps,
): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
  const [last] = await sql<
    { created_at: string }[]
  >`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
  const after = Number(last?.created_at ?? 0);
  // Every pending marker resolves before the first statement of the run, so an unknown or malformed marker in a
  // later migration cannot leave the earlier ones applied.
  const pending = migrations
    .filter((migration) => migration.folderMillis > after)
    .map((migration) => ({ migration, steps: migrationSteps(migration.sql, dataSteps) }));
  for (const { migration, steps } of pending) await applyOne(sql, migration, steps);
}

// Loss detection holds only for one connection: the advisory lock and every statement share it, and a
// closed socket is that same connection. applyMigrations rejects any other max before it queries or arms
// the close watcher. A closed socket aborts before the next statement, so the pool cannot reconnect and
// continue without the lock. Only a concurrent-index prefix runs outside a transaction. The remaining
// DDL and the journal row commit together, as Drizzle normally does.
export async function applyMigrations(
  client: postgres.Sql,
  folder: string,
  dataSteps: DataSteps = {},
): Promise<void> {
  requireSingleConnection(client);
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const session: MigrationSession = { lost: false };
  const restoreClose = armLossWatch(client, session);
  const sql = guardedSql(client, session);
  try {
    await holdMigrationLock(sql);
    await applyPending(sql, migrations, dataSteps);
  } catch (error) {
    abortIfConnectionLost(session, error);
  } finally {
    await finishSession(client, session, restoreClose);
  }
}

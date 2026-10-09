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

// The connection is held (max:1) until the session advisory lock is released. Only a concurrent-index prefix
// may run outside a transaction. The remaining DDL and journal entry commit together, as Drizzle normally does.
export async function applyMigrations(
  client: postgres.Sql,
  folder: string,
  dataSteps: DataSteps = {},
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  await client`SELECT pg_advisory_lock(hashtext('pospay:migrations'))`;
  const [session] = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pid = session?.pid;
  // The advisory lock belongs to this session: if the connection was replaced, another runner may hold it now.
  const sameSession = async (): Promise<void> => {
    const [now] = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    if (now?.pid !== pid) throw new Error('Migration session lost its advisory lock; aborting');
  };
  try {
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const [last] = await client<
      { created_at: string }[]
    >`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
    const after = Number(last?.created_at ?? 0);
    // Every pending marker resolves before the first statement of the run, so an unknown or malformed marker in a
    // later migration cannot leave the earlier ones applied.
    const pending = migrations
      .filter((migration) => migration.folderMillis > after)
      .map((migration) => ({ migration, steps: migrationSteps(migration.sql, dataSteps) }));
    for (const { migration, steps } of pending) {
      await sameSession();
      for (const step of steps) await step(client);
      await sameSession();
      const statements = migration.sql.filter((statement) => statement.trim() !== '');
      const firstTransactional = statements.findIndex((statement) => !CONCURRENT.test(statement));
      const prefixLength = firstTransactional === -1 ? statements.length : firstTransactional;
      if (statements.slice(prefixLength).some((statement) => CONCURRENT.test(statement))) {
        throw new Error('Concurrent indexes must precede transactional migration statements');
      }
      for (const statement of statements.slice(0, prefixLength)) {
        if (/^\s*(?:--[^\r\n]*[\r\n]\s*)*CREATE\b/i.test(statement)) {
          await runConcurrentIndex(client, statement);
        } else {
          await client.unsafe(statement);
        }
      }
      await client.begin(async (tx) => {
        for (const statement of statements.slice(prefixLength)) await tx.unsafe(statement);
        await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
      });
    }
  } finally {
    await client`SELECT pg_advisory_unlock(hashtext('pospay:migrations'))`;
  }
}

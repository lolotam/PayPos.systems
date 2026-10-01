import { readMigrationFiles } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

const CONCURRENT = /^\s*(?:--[^\n]*\n\s*)*(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i;

// The connection is held (max:1) until the session advisory lock is released. Only a concurrent-index prefix
// may run outside a transaction. The remaining DDL and journal entry commit together, as Drizzle normally does.
export async function applyMigrations(client: postgres.Sql, folder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  await client`SELECT pg_advisory_lock(hashtext('pospay:migrations'))`;
  try {
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const [last] = await client<
      { created_at: string }[]
    >`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
    const after = Number(last?.created_at ?? 0);
    for (const migration of migrations) {
      if (migration.folderMillis <= after) continue;
      const statements = migration.sql.filter((statement) => statement.trim() !== '');
      const firstTransactional = statements.findIndex((statement) => !CONCURRENT.test(statement));
      const prefixLength = firstTransactional === -1 ? statements.length : firstTransactional;
      if (statements.slice(prefixLength).some((statement) => CONCURRENT.test(statement))) {
        throw new Error('Concurrent indexes must precede transactional migration statements');
      }
      for (const statement of statements.slice(0, prefixLength)) await client.unsafe(statement);
      await client.begin(async (tx) => {
        for (const statement of statements.slice(prefixLength)) await tx.unsafe(statement);
        await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
      });
    }
  } finally {
    await client`SELECT pg_advisory_unlock(hashtext('pospay:migrations'))`;
  }
}

import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

const MIGRATION = new URL(
  '../../migrations/0070_2026-10-04_staff-attendance-rls.sql',
  import.meta.url,
);
let testDb: TestDatabase, owner: postgres.Sql, guard: string;
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const statements = (await readFile(MIGRATION, 'utf8')).split('--> statement-breakpoint');
  const found = statements.filter((statement) => statement.includes('DO $$'));
  expect(found).toHaveLength(1);
  guard = found[0] ?? '';
});
afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

it('the backfill guard passes for the migration role and refuses a role that cannot bypass FORCE RLS', async () => {
  await expect(owner.unsafe(guard)).resolves.toBeDefined();
  await expect(
    owner.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE pospay_app');
      await tx.unsafe(guard);
    }),
  ).rejects.toMatchObject({ code: '42501', message: expect.stringContaining('BYPASSRLS') });
});

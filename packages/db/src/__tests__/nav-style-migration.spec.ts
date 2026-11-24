import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';

import { readNavStyleMigrationFiles } from '../../test/nav-style-migrations.ts';
import { createTestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const pending = vi.hoisted(() => ({ files: [] as { sql: string[]; folderMillis: number; hash: string }[] }));
vi.mock('drizzle-orm/migrator', () => ({ readMigrationFiles: () => pending.files }));

it('expands existing users with NULL, validates separately and rejects D without granting app access', async () => {
  const fixture = await createTestDatabase();
  const owner = postgres(fixture.ownerUrl, { max: 1, onnotice: () => undefined });
  const app = postgres(fixture.appUrl, { max: 1, onnotice: () => undefined });
  const userId = randomUUID();
  try {
    await owner`ALTER TABLE "user" DROP CONSTRAINT user_nav_style, DROP COLUMN nav_style`;
    await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Existing','existing@migration.invalid')`;
    const migrations = readNavStyleMigrationFiles();
    pending.files = migrations.slice(0, 1);
    await applyMigrations(owner, 'unused');
    expect(await owner`SELECT nav_style FROM "user" WHERE id=${userId}`).toEqual([{ nav_style: null }]);
    expect(await owner`SELECT convalidated FROM pg_constraint WHERE conname='user_nav_style'`).toEqual([{ convalidated: false }]);
    pending.files = migrations;
    await applyMigrations(owner, 'unused');
    expect(await owner`SELECT convalidated FROM pg_constraint WHERE conname='user_nav_style'`).toEqual([{ convalidated: true }]);
    await expect(owner`UPDATE "user" SET nav_style='D' WHERE id=${userId}`).rejects.toMatchObject({ code: '23514' });
    await expect(app`SELECT nav_style FROM "user"`).rejects.toMatchObject({ code: '42501' });
    await expect(app`UPDATE "user" SET nav_style='B' WHERE id=${userId}`).rejects.toMatchObject({ code: '42501' });
  } finally {
    await app.end();
    await owner.end();
    await fixture.drop();
  }
});

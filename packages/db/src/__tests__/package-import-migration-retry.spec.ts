import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const pending = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    {
      sql: pending.sql,
      folderMillis: 9_999_999_999_997,
      hash: 'package-import-index-retry',
    },
  ],
}));

it('resumes actual 0216 after its concurrent DROP succeeds and its suffix rolls back', async () => {
  const fixture = await createTestDatabase();
  const owner = postgres(fixture.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    // نعيد شكل ما قبل 0216 داخل clone فقط؛ الفشل التالي يجب أن يترك البادئة وحدها مثبتة.
    await owner`DROP INDEX package_components_service_business_fk_idx`;
    await owner`CREATE INDEX package_components_service_fk_idx ON package_components(company_id,business_id,service_id)`;
    await owner`ALTER TABLE package_components DROP CONSTRAINT package_components_service_fk,
      ADD CONSTRAINT package_components_service_fk FOREIGN KEY(company_id,business_id,service_id)
      REFERENCES services(company_id,business_id,id)`;
    const actual = readFileSync(
      new URL(
        '../../migrations/0216_2026-11-06_package-import-commit-index-validate.sql',
        import.meta.url,
      ),
      'utf8',
    ).split('--> statement-breakpoint');
    const replacement = actual.findIndex((statement) =>
      statement.includes('ADD CONSTRAINT package_components_service_fk'),
    );
    expect(replacement).toBeGreaterThan(0);
    pending.sql = [
      ...actual.slice(0, replacement + 1),
      'SELECT missing_package_import_retry_function()',
      ...actual.slice(replacement + 1),
    ];
    await expect(applyMigrations(owner, 'unused')).rejects.toThrow();
    expect(
      (await owner`SELECT to_regclass('package_components_service_fk_idx') AS old_index`)[0]?.[
        'old_index'
      ],
    ).toBeNull();
    expect(
      (
        await owner`SELECT indisvalid FROM pg_index WHERE indexrelid='package_components_service_business_fk_idx'::regclass`
      )[0]?.['indisvalid'],
    ).toBe(true);
    expect(await serviceKey(owner)).toEqual({
      columns: ['company_id', 'business_id', 'service_id'],
      convalidated: true,
    });
    expect(
      await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash='package-import-index-retry'`,
    ).toHaveLength(0);
    pending.sql = actual;
    await applyMigrations(owner, 'unused');
    await applyMigrations(owner, 'unused');
    expect(await serviceKey(owner)).toEqual({
      columns: ['company_id', 'service_id', 'business_id'],
      convalidated: true,
    });
    expect(
      await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash='package-import-index-retry'`,
    ).toHaveLength(1);
  } finally {
    await owner.end();
    await fixture.drop();
  }
});

async function serviceKey(owner: postgres.Sql) {
  const [key] = await owner`SELECT c.convalidated,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns
    FROM pg_constraint c WHERE c.conrelid='package_components'::regclass AND c.conname='package_components_service_fk'`;
  return key;
}

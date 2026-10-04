import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { t } from '@pospay/i18n';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { defaultDocumentTypes } from '../domain/default-document-types.ts';
import { createStaffDocumentDefaults } from '../index.ts';

const ids = systemUuidV7();
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const event = (companyId: string) =>
  ({
    id: ids.newId(),
    companyId,
    eventType: 'CompanyCreated',
    payload: {},
  }) as unknown as ClaimedEvent;
const typesOf = (companyId: string) =>
  owner`SELECT code,name_en,name_ar,alert_days,requires_expiry FROM document_types
    WHERE company_id=${companyId} ORDER BY code`;

it('the CompanyCreated consumer seeds the five types once, inside the tenant, and keeps manager edits', async () => {
  const consumer = createStaffDocumentDefaults(ids);
  expect(consumer.eventTypes).toEqual(['CompanyCreated']);
  await db.withTenant(TENANT.A.company, (tx) => consumer.handle(tx, event(TENANT.A.company)));
  await owner`UPDATE document_types SET name_en='Kuwaiti civil ID' WHERE company_id=${TENANT.A.company} AND code='civil_id'`;
  await db.withTenant(TENANT.A.company, (tx) => consumer.handle(tx, event(TENANT.A.company)));
  const rows = await typesOf(TENANT.A.company);
  expect(rows).toHaveLength(5);
  expect(rows.find((r) => r['code'] === 'civil_id')?.['name_en']).toBe('Kuwaiti civil ID');
  expect(await typesOf(TENANT.B.company)).toHaveLength(0);
  const [ids7] = await owner`SELECT count(*)::int AS n FROM document_types
    WHERE company_id=${TENANT.A.company} AND substring(id::text,15,1)='7'`;
  expect(ids7?.['n']).toBe(5);
});

it('the migration seeds existing companies with exactly the consumer list, idempotently', async () => {
  const migration = readFileSync(
    new URL(
      '../../../../../../packages/db/migrations/0074_2026-10-04_staff-employee-documents-rls.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const seed = migration.split('--> statement-breakpoint').at(-1) ?? '';
  await owner.unsafe(seed);
  await owner.unsafe(seed);
  const expected = [...defaultDocumentTypes()]
    .map(({ name_key, ...type }) => ({
      ...type,
      name_en: t('en', `employeeDocuments.${name_key}`),
      name_ar: t('ar', `employeeDocuments.${name_key}`),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  expect(await typesOf(TENANT.B.company)).toEqual(expected);
  const [count] = await db.withTenant(TENANT.B.company, (tx) =>
    tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM document_types`),
  );
  expect(count?.n).toBe(5);
});

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, owner: postgres.Sql;
const { A } = TENANT;
const MIGRATION = new URL('../../migrations/0138_2026-10-16_performer-identity-snapshot.sql', import.meta.url);
const NEW_CHECKS = ['service_line_edits_editor_role_snapshot', 'service_line_edits_editor_name_length', 'service_line_edits_editor_identity'];

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
});
afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

function history(revision: number, role: string | null, nameEn: string | null) {
  return owner`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,new_price,new_discount,new_net,
    previous_effective_discount_bps,previous_limit_source,new_effective_discount_bps,new_limit_source,
    reason,changed_at,changed_by,changed_by_membership_id,editor_name_en,editor_role)
    VALUES(${A.company},gen_random_uuid(),${A.business},${ORDER_IDS.line},${revision},${revision - 1},
      1.000,0.000,1.000,2.000,0.000,2.000,0,'OWNER',0,'OWNER','Legacy reason',now(),${USER},${ORDER_IDS.membership},${nameEn},${role})`;
}

it('re-adds the new CHECKs as NOT VALID over history written under the old shape, and still enforces them on new rows', async () => {
  for (const name of NEW_CHECKS) await owner.unsafe(`ALTER TABLE service_line_edits DROP CONSTRAINT ${name}`);
  await history(2, 'owner', null);
  await history(3, 'manager', null);
  await history(4, null, null);
  const statements = readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint');
  const checks = statements.filter((statement) => NEW_CHECKS.some((name) => statement.includes(`ADD CONSTRAINT "${name}"`)));
  expect(checks).toHaveLength(NEW_CHECKS.length);
  for (const statement of checks) await owner.unsafe(statement);
  const validated = await owner`SELECT conname,convalidated FROM pg_constraint WHERE conname = ANY(${NEW_CHECKS}) ORDER BY conname`;
  expect(validated).toHaveLength(NEW_CHECKS.length);
  expect(validated.every((row) => row['convalidated'] === false)).toBe(true);
  await expect(history(5, null, null)).rejects.toThrow(/service_line_edits_editor_identity/);
  await expect(history(6, 'owner', null)).rejects.toThrow(/service_line_edits_editor_role_snapshot/);
});

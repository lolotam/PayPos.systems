import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => { await owner?.end(); await testDb?.drop(); });

it('keeps a parseable recovery_feature_started_at marker on service_session_recoveries', async () => {
  const [row] = await owner`SELECT obj_description('public.service_session_recoveries'::regclass) AS marker`;
  const marker = String(row?.['marker'] ?? '');
  const instant = marker.match(/recovery_feature_started_at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)/)?.[1];
  expect(instant).toBeDefined();
  expect(Number.isNaN(Date.parse(instant ?? ''))).toBe(false);
});

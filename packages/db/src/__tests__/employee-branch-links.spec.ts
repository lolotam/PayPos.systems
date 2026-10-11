import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  createDatabase,
  currentAttachment,
  employeeDefaultShiftsStatement,
  type BranchDay,
  type Database,
} from '../index.ts';

const COMPANY = '019a0000-0000-7000-8000-000000000001';
const BRANCH = '019a0000-0000-7000-8000-000000000002';
let testDb: TestDatabase;
let database: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  database = createDatabase({ url: testDb.appUrl, ids: { newId: () => COMPANY } });
});
afterAll(async () => {
  await database?.close();
  await testDb?.drop();
});

it.each([
  [null, '2026-10-11', true],
  ['2026-10-12', '2026-10-11', true],
  ['2026-10-11', '2026-10-11', false],
  ['2026-10-10', '2026-10-11', false],
  ['2026-10-12', null, true],
] as const)(
  'checks exclusive end %s against the injected branch day %s',
  async (end, today, expected) => {
    const days: BranchDay[] = today === null ? [] : [{ branchId: BRANCH, today }];
    const rows = await database.withTenant(COMPANY, (tx) =>
      tx.execute<{ current: boolean }>(
        sql`SELECT ${currentAttachment(days)} AS current
      FROM (VALUES (${BRANCH}::uuid, ${end}::date)) AS eb(branch_id,"to")`,
      ),
    );
    expect(rows[0]?.current).toBe(expected);
  },
);

it('accepts a caller-supplied SQL day without weakening the exclusive end', async () => {
  const rows = await database.withTenant(COMPANY, (tx) =>
    tx.execute<{ current: boolean }>(
      sql`SELECT ${currentAttachment(sql`'2026-10-11'::date`)} AS current
      FROM (VALUES ('2026-10-11'::date)) AS eb("to")`,
    ),
  );
  expect(rows[0]?.current).toBe(false);
});

it('projects no default hours when the caller authorizes no branches', async () => {
  const rows = await database.withTenant(COMPANY, (tx) =>
    tx.execute(employeeDefaultShiftsStatement({ companyId: COMPANY, employeeId: COMPANY }, [])),
  );
  expect(rows).toHaveLength(0);
});

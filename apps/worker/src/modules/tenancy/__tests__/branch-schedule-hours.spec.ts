import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { branchScheduleHours } from '../persistence/branch-schedule-hours.ts';

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

function read(companyId: string, branchId: string) {
  return db.withTenant(companyId, (tx) => branchScheduleHours(tx, companyId, branchId));
}

it('returns a branch timezone and its stored opening hours', async () => {
  const hours = [{ weekday: 1, intervals: [{ opens: '18:00', closes: '02:00' }] }];
  await owner`UPDATE businesses SET timezone='Asia/Riyadh'
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.business}`;
  await owner`UPDATE branches SET timezone='Asia/Dubai', opening_hours=${owner.json(hours)}
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  expect(await read(TENANT.A.company, TENANT.A.branch)).toEqual({
    openingHours: hours,
    timeZone: 'Asia/Dubai',
  });
});

it('falls back to the business timezone when the branch timezone is null', async () => {
  const hours = [{ weekday: 2, intervals: [{ opens: '10:00', closes: '22:00' }] }];
  await owner`UPDATE businesses SET timezone='Asia/Dubai'
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.business}`;
  await owner`UPDATE branches SET timezone=NULL, opening_hours=${owner.json(hours)}
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  expect(await read(TENANT.A.company, TENANT.A.branch)).toEqual({
    openingHours: hours,
    timeZone: 'Asia/Dubai',
  });
});

it('keeps null opening hours null', async () => {
  await owner`UPDATE branches SET timezone='Asia/Kuwait', opening_hours=NULL
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  expect(await read(TENANT.A.company, TENANT.A.branch)).toEqual({
    openingHours: null,
    timeZone: 'Asia/Kuwait',
  });
});

it('returns null for another tenant branch under withTenant', async () => {
  expect(await read(TENANT.A.company, TENANT.B.branch)).toBeNull();
});

it('rejects a stored value that does not satisfy the opening-hours contract', async () => {
  await owner`UPDATE branches SET opening_hours=${JSON.stringify({ weekday: 1 })}::jsonb
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  await expect(read(TENANT.A.company, TENANT.A.branch)).rejects.toThrow(
    'BRANCH_OPENING_HOURS_INVALID',
  );
});

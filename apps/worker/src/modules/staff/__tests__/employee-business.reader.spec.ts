import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

import { createDatabase, type Database, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { readEmployeeBusiness } from '../index.ts';
import { takeTestEmployeeNumber } from './test-employee-number.ts';

const ids = systemUuidV7();
const A = TENANT.A;
const B = TENANT.B;
const active = ids.newId();
const deleted = ids.newId();
const foreign = ids.newId();
const otherEmployee = ids.newId();
const otherBusiness = ids.newId();
const otherBranch = ids.newId();
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

async function insertEmployee(tx: Tx, employeeId: string, business: string, branch: string) {
  await tx.execute(sql`
    INSERT INTO employees
      (company_id, id, business_id, primary_branch_id, name_en, name_en_key,
       role_code, hire_date, employee_number)
    VALUES (${A.company}, ${employeeId}, ${business}, ${branch},
      'Synthetic reader employee', 'synthetic reader employee', 'staff', '2026-01-01',
      ${takeTestEmployeeNumber(A.company)})`);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO businesses (company_id,id,vertical_type,name_en)
    VALUES (${A.company},${otherBusiness},'salon','Synthetic second business')`;
  await owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${A.company},${otherBranch},${otherBusiness},'Synthetic second branch')`;
  await db.withTenant(A.company, async (tx) => {
    await insertEmployee(tx, active, A.business, A.branch);
    await insertEmployee(tx, deleted, A.business, A.branch);
    await insertEmployee(tx, otherEmployee, otherBusiness, otherBranch);
  });
  // تجهيز الحالة التاريخية بالمالك؛ دور التطبيق لا يملك تعديل deleted_at.
  await owner`UPDATE employees SET deleted_at = '2026-10-01T00:00:00Z'
    WHERE company_id = ${A.company} AND id = ${deleted}`;
  await owner`INSERT INTO employees
    (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${B.company},${foreign},${B.business},${B.branch},'Synthetic foreign employee',
      'synthetic foreign employee','staff','2026-01-01',${takeTestEmployeeNumber(B.company)})`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

describe('readEmployeeBusiness on real Postgres', () => {
  it('preserves the public scalar signature', () => {
    expectTypeOf(readEmployeeBusiness).toEqualTypeOf<
      (tx: Tx, companyId: string, employeeId: string) => Promise<string | null>
    >();
  });

  it('returns only the stored business for active and soft-deleted employees', async () => {
    await db.withTenant(A.company, async (tx) => {
      expect(await readEmployeeBusiness(tx, A.company, active)).toBe(A.business);
      expect(await readEmployeeBusiness(tx, A.company, deleted)).toBe(A.business);
      expect(await readEmployeeBusiness(tx, A.company, otherEmployee)).toBe(otherBusiness);
      expect(await readEmployeeBusiness(tx, A.company, ids.newId())).toBeNull();
    });
  });

  it('enforces company qualification and RLS even with a foreign company argument', async () => {
    await db.withTenant(A.company, async (tx) => {
      expect(await readEmployeeBusiness(tx, A.company, foreign)).toBeNull();
      expect(await readEmployeeBusiness(tx, B.company, foreign)).toBeNull();
      expect(await readEmployeeBusiness(tx, B.company, active)).toBeNull();
    });
    await db.withTenant(B.company, async (tx) => {
      expect(await readEmployeeBusiness(tx, B.company, foreign)).toBe(B.business);
      expect(await readEmployeeBusiness(tx, A.company, active)).toBeNull();
    });
  });

  it('sees an uncommitted employee on the caller transaction and loses it after rollback', async () => {
    const employeeId = ids.newId();
    const rollback = new Error('SYNTHETIC_READER_ROLLBACK');
    await expect(
      db.withTenant(A.company, async (tx) => {
        await insertEmployee(tx, employeeId, otherBusiness, otherBranch);
        expect(await readEmployeeBusiness(tx, A.company, employeeId)).toBe(otherBusiness);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await db.withTenant(A.company, async (tx) => {
      expect(await readEmployeeBusiness(tx, A.company, employeeId)).toBeNull();
    });
  });
});

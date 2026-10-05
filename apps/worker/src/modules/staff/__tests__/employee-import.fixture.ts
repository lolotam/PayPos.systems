import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';
import { employeeImportTransactions } from '../persistence/employee-import.transactions.ts';
import type { ImportEmployeeRow } from '../domain/employee-import.ts';

/** تجهيز العامل مستقل عن تطبيق API: الطلب المقبول محفوظ كصف ثابت في قاعدة الاختبار. */
export async function employeeImportFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic import requester','worker-import@example.test') ON CONFLICT (id) DO NOTHING`;
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  const clock = { value: new Date('2026-10-05T10:00:00Z') };
  const { company, business, branch } = TENANT.A;
  const file = ids.newId();
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${company},${file},${business},'staff',${business},${`staging/${file}`},${`verified/${file}`},
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'read:files:business',${USER},now(),'READY')`;
  return {
    db,
    owner,
    ids,
    clock,
    company,
    business,
    branch,
    userId: USER,
    otherCompany: TENANT.B.company,
    worker: new CommitEmployeeImport(employeeImportTransactions(db, ids), ids, {
      now: () => clock.value,
    }),
    async requested(
      name: string,
      options: { requestedAt?: Date; expiresAt?: Date; branchId?: string; count?: number } = {},
    ) {
      const id = ids.newId();
      const rows: ImportEmployeeRow[] = Array.from({ length: options.count ?? 1 }, () => ({
        name_en: name,
        name_ar: null,
        role_code: 'staff',
        hire_date: '2026-01-01',
        contract_end: null,
        primary_branch_id: options.branchId ?? branch,
      }));
      const requestedAt = options.requestedAt ?? clock.value;
      const expiresAt = options.expiresAt ?? new Date('2026-10-06T10:00:00Z');
      await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
        status,requested_at,row_count,error_count,rows,errors)
        VALUES(${company},${id},${business},'employees',${file},${USER},'2026-10-04T10:00:00Z',${expiresAt},
          'commit_requested',${requestedAt},${rows.length},0,${owner.json(rows.map((row) => ({ ...row })))},'[]')`;
      return id;
    },
    async close() {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type EmployeeImportFixture = Awaited<ReturnType<typeof employeeImportFixture>>;

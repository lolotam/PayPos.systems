import postgres from 'postgres';
import { createDatabase, PROVISIONAL_PLAN_ID, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { DetectDocumentExpiries } from '../use-cases/detect-document-expiries/detect-document-expiries.ts';
import { documentExpiryTransactions } from '../persistence/document-expiry.transactions.ts';
import type { DocumentExpiryTransactions } from '../ports/document-expiry.port.ts';

export interface Tenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}

export { TENANT };
export const A = TENANT.A;
export const B = TENANT.B;

/** قاعدة اختبار مستنسخة لكل ملف، والوظيفة تعمل كـ pospay_app فقط. */
export async function documentExpiryFixture() {
  const ids = systemUuidV7();
  const testDb: TestDatabase = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  const db: Database = createDatabase({ url: testDb.appUrl, ids });
  const userId = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic expiry staff','document-expiry@example.test')`;
  let instant = new Date('2026-10-05T10:00:00Z');
  const clock = { now: () => new Date(instant) };
  const transactions = documentExpiryTransactions(db, ids);
  return {
    ids,
    owner,
    db,
    testDb,
    userId,
    clock,
    transactions,
    setNow: (at: Date) => {
      instant = at;
    },
    detect: (port: DocumentExpiryTransactions = transactions) =>
      new DetectDocumentExpiries(port, clock),
    tenant: () => newTenant(owner, userId, ids.newId(), ids.newId(), ids.newId()),
    employee: (tenant: Tenant) => newEmployee(owner, ids.newId(), tenant),
    type: (tenant: Tenant, code: string, alertDays = 30, requiresExpiry = true) =>
      newType(owner, ids.newId(), tenant, code, alertDays, requiresExpiry),
    document: (tenant: Tenant, employeeId: string, typeCode: string, expiresOn: string | null) =>
      newDocument(owner, ids.newId(), tenant, employeeId, typeCode, expiresOn, userId),
    replace: (
      tenant: Tenant,
      employeeId: string,
      typeCode: string,
      oldDocumentId: string,
      expiresOn: string | null,
    ) =>
      replaceCurrent(
        owner,
        ids.newId(),
        tenant,
        employeeId,
        typeCode,
        oldDocumentId,
        expiresOn,
        userId,
      ),
    setAlertDays: (tenant: Tenant, typeCode: string, alertDays: number) =>
      setTypeAlertDays(owner, tenant, typeCode, alertDays),
    close: () => closeFixture(db, owner, testDb),
  };
}
export type DocumentExpiryFixture = Awaited<ReturnType<typeof documentExpiryFixture>>;

async function closeFixture(db: Database, owner: postgres.Sql, testDb: TestDatabase) {
  await db.close();
  await owner.end();
  await testDb.drop();
}

async function newTenant(
  owner: postgres.Sql,
  userId: string,
  company: string,
  business: string,
  branch: string,
): Promise<Tenant> {
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${company},'Synthetic expiry',${userId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${business},${company},'salon','Synthetic expiry')`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${branch},${company},${business},'Synthetic expiry')`;
  return { company, business, branch };
}

async function newEmployee(owner: postgres.Sql, id: string, tenant: Tenant) {
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${tenant.company},${id},${tenant.business},${tenant.branch},'Synthetic expiry employee','staff','2026-01-01')`;
  return id;
}

async function newType(
  owner: postgres.Sql,
  id: string,
  tenant: Tenant,
  code: string,
  alertDays: number,
  requiresExpiry: boolean,
) {
  await owner`INSERT INTO document_types(company_id,id,code,name_en,name_ar,alert_days,requires_expiry,active,revision)
    VALUES(${tenant.company},${id},${code},${code},NULL,${alertDays},${requiresExpiry},true,1)`;
  return code;
}

async function newDocument(
  owner: postgres.Sql,
  id: string,
  tenant: Tenant,
  employeeId: string,
  typeCode: string,
  expiresOn: string | null,
  uploadedBy: string,
) {
  await owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,expires_on,uploaded_by,recorded_at)
    VALUES(${tenant.company},${id},${tenant.business},${employeeId},${typeCode},${`synthetic/${id}.pdf`},
      ${expiresOn}::date,${uploadedBy},clock_timestamp())`;
  return id;
}

async function replaceCurrent(
  owner: postgres.Sql,
  id: string,
  tenant: Tenant,
  employeeId: string,
  typeCode: string,
  oldDocumentId: string,
  expiresOn: string | null,
  uploadedBy: string,
) {
  await owner`UPDATE employee_documents SET replaced_at=clock_timestamp()
    WHERE company_id=${tenant.company} AND id=${oldDocumentId} AND replaced_at IS NULL`;
  return newDocument(owner, id, tenant, employeeId, typeCode, expiresOn, uploadedBy);
}

async function setTypeAlertDays(
  owner: postgres.Sql,
  tenant: Tenant,
  typeCode: string,
  alertDays: number,
) {
  await owner`UPDATE document_types SET alert_days=${alertDays}, revision=revision+1
    WHERE company_id=${tenant.company} AND code=${typeCode}`;
}

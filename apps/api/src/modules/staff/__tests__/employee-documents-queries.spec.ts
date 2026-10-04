import { documentTypeList } from '@pospay/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { documentStatus } from '../domain/employee-documents.ts';
import { createEmployeeDocumentReadAccess } from '../persistence/document-access.adapter.ts';
import { documentTypesStatement, listDocumentTypes } from '../queries/document-types.query.ts';
import {
  employeeDocuments,
  employeeDocumentsStatement,
} from '../queries/employee-documents.query.ts';
import {
  documentClock,
  documentIds,
  documentFile,
  documentsFixture,
  KUWAIT_TODAY,
  recordCommand,
  type DocumentsFixture,
} from './documents.fixture.ts';

let f: DocumentsFixture;
let fileId: string;
beforeAll(async () => {
  f = await documentsFixture();
  fileId = await documentFile(f);
  await f.record.execute(recordCommand(f, fileId));
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const context = () => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  employeeId: f.employee.id,
});

it('the employee view and the type list return the contract shape; another tenant sees no rows', async () => {
  const view = await f.db.withTenant(f.company, (tx) =>
    employeeDocuments(tx, context(), createEmployeeDocumentReadAccess(documentClock)),
  );
  expect(view).toMatchObject({
    today: KUWAIT_TODAY,
    can_manage: true,
    items: [{ type_code: 'civil_id', status: 'EXPIRING', employee_id: f.employee.id }],
  });
  const types = await f.db.withTenant(f.company, (tx) => listDocumentTypes(tx, f.company));
  expect(documentTypeList.parse(types).items.map((t) => [t.code, t.active])).toEqual([
    ['civil_id', true],
    ['passport', true],
    ['work_contract', true],
  ]);
  const foreign = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(employeeDocumentsStatement(f.company, f.employee.id, KUWAIT_TODAY)),
  );
  expect(foreign[0]).toEqual({ items: [], types: [] });
});

it('every read the documents use plans on a tenant index', async () => {
  const statements: [SQL, string][] = [
    [documentTypesStatement(f.company), 'document_types'],
    [employeeDocumentsStatement(f.company, f.employee.id, KUWAIT_TODAY), 'employee_documents'],
  ];
  for (const [statement, table] of statements) {
    const plan = await f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement}`);
    });
    const text = JSON.stringify(plan);
    expect(text).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    expect(text).toContain(`"Relation Name":"${table}"`);
  }
});

it('the SQL badge equals documentStatus at every boundary of the rule', async () => {
  const cases = [
    ['2026-10-04', 30],
    ['2026-10-05', 0],
    ['2026-10-06', 0],
    ['2026-11-04', 30],
    ['2026-11-05', 30],
    ['2027-10-05', 365],
    [null, 30],
  ] as const;
  for (const [index, [expiresOn, alertDays]] of cases.entries()) {
    const code = `parity_${index}`;
    await f.h
      .owner`INSERT INTO document_types(company_id,id,code,name_en,alert_days,requires_expiry)
      VALUES (${f.company},${documentIds.newId()},${code},${code},${alertDays},false)`;
    await f.h
      .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,expires_on,uploaded_by,recorded_at)
      VALUES (${f.company},${documentIds.newId()},${f.business},${f.other.id},${code},${`parity-key-${index}`},${expiresOn},${f.userId},now())`;
  }
  const [row] = await f.db.withTenant(f.company, (tx) =>
    tx.execute<{ items: { type_code: string; status: string }[] }>(
      employeeDocumentsStatement(f.company, f.other.id, KUWAIT_TODAY),
    ),
  );
  const statuses = new Map(row?.items.map((item) => [item.type_code, item.status]));
  for (const [index, [expiresOn, alertDays]] of cases.entries())
    expect(statuses.get(`parity_${index}`), `${expiresOn} ${alertDays}`).toBe(
      documentStatus(expiresOn, alertDays, KUWAIT_TODAY),
    );
});

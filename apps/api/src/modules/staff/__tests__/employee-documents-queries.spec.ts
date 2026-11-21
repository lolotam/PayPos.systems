import { documentTypeList, employeeDocumentNumbersQuery } from '@pospay/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { documentStatus } from '../domain/employee-documents.js';
import { createEmployeeDocumentReadAccess } from '../persistence/document-access.adapter.ts';
import { documentTypesStatement, listDocumentTypes } from '../queries/document-types.query.ts';
import {
  employeeDocuments,
  employeeDocumentsStatement,
} from '../queries/employee-documents.query.ts';
import {
  employeeDocumentNumbersStatement,
  readEmployeeDocumentNumbers,
} from '../queries/employee-document-numbers.query.ts';
import {
  documentClock,
  documentIds,
  documentFile,
  documentsFixture,
  KUWAIT_TODAY,
  recordCommand,
  type DocumentsFixture,
} from './documents.fixture.ts';
import { termsFor } from './employees.fixture.ts';

let f: DocumentsFixture;
let numberedId: string;
beforeAll(async () => {
  f = await documentsFixture();
  const seededFileId = await documentFile(f);
  await f.record.execute(recordCommand(f, seededFileId));
  const third = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic third'),
  });
  numberedId = documentIds.newId();
  const replacedId = documentIds.newId();
  const noNumberId = documentIds.newId();
  const deletedEmployeeId = documentIds.newId();
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${numberedId},${f.business},${f.employee.id},'work_contract','dn09-current',${f.userId},now(),'SYN-DOC-0009')`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,replaced_at,document_number)
    VALUES (${f.company},${replacedId},${f.business},${f.employee.id},'civil_id','dn09-replaced',${f.userId},now(),now(),'SYN-DOC-REPLACED')`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${noNumberId},${f.business},${f.employee.id},'passport','dn09-nonumber',${f.userId},now(),NULL)`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,document_number)
    VALUES (${f.company},${deletedEmployeeId},${f.business},${third.id},'civil_id','dn09-deleted',${f.userId},now(),'SYN-DOC-DELETED')`;
  await f.h
    .owner`UPDATE employee_documents SET replaced_at=now() WHERE company_id=${f.company} AND id=${replacedId}`;
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${third.id}`;
  await f.h
    .owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,replaced_at,document_number)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.employee.id},'work_contract','dn09-bulk-'||g,${f.userId},now(),now(),NULL
    FROM generate_series(1,300) g`;
  await f.h.owner`ANALYZE employee_documents`;
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
  if (view === null || view === 'FEATURE_DISABLED') throw new Error('view unexpectedly refused');
  expect(view).toMatchObject({ today: KUWAIT_TODAY, can_manage: true });
  const civil = view.items.find((item) => item.type_code === 'civil_id');
  expect(civil).toMatchObject({
    status: 'EXPIRING',
    employee_id: f.employee.id,
    document_number: null,
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

it('DN-09 the list carries document_number and the lookup returns only current, numbered, live-employee rows', async () => {
  const view = await f.db.withTenant(f.company, (tx) =>
    employeeDocuments(tx, context(), createEmployeeDocumentReadAccess(documentClock)),
  );
  if (view === null || view === 'FEATURE_DISABLED') throw new Error('view unexpectedly refused');
  const numbered = view.items.find((item) => item.id === numberedId);
  expect(numbered).toMatchObject({ document_number: 'SYN-DOC-0009' });
  const current = view.items.find((item) => item.object_key === 'dn09-nonumber');
  expect(current).toMatchObject({ document_number: null });
  const result = await f.db.withTenant(f.company, (tx) =>
    readEmployeeDocumentNumbers(
      tx,
      { companyId: f.company, userId: f.userId, businessId: f.business },
      employeeDocumentNumbersQuery.parse({
        ids: `${numberedId},${documentIds.newId()}`,
      }).ids,
      createEmployeeDocumentReadAccess(documentClock),
    ),
  );
  expect(result.items).toEqual([{ document_id: numberedId, document_number: 'SYN-DOC-0009' }]);
  const otherBusiness = await f.db.withTenant(f.company, (tx) =>
    readEmployeeDocumentNumbers(
      tx,
      { companyId: f.company, userId: f.userId, businessId: f.secondBusiness },
      employeeDocumentNumbersQuery.parse({ ids: numberedId }).ids,
      createEmployeeDocumentReadAccess(documentClock),
    ),
  );
  expect(otherBusiness.items).toEqual([]);
});

it('DN-09 the lookup statement plans on employee_documents indexes without a seq scan', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${employeeDocumentNumbersStatement(
        { companyId: f.company, businessId: f.business },
        Array.from({ length: 20 }, () => documentIds.newId())
          .concat([numberedId])
          .slice(-20),
      )}`,
    );
  });
  const planText = JSON.stringify(plan);
  expect(planText).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
  expect(planText).toContain('"Relation Name":"employee_documents"');
  expect(planText).not.toContain('Seq Scan');
});

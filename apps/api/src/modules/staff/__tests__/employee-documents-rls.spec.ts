import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  documentFile,
  documentIds,
  documentsFixture,
  recordCommand,
  type DocumentsFixture,
} from './documents.fixture.ts';

let f: DocumentsFixture;
let documentId: string;
let typeId: string;
beforeAll(async () => {
  f = await documentsFixture();
  documentId = (await f.record.execute(recordCommand(f, await documentFile(f)))).id;
  const [type] = await f.h
    .owner`SELECT id FROM document_types WHERE company_id=${f.company} AND code='civil_id'`;
  typeId = type?.['id'] as string;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const asOther = (statement: ReturnType<typeof sql>) =>
  f.db.withTenant(f.otherCompany, (tx) => tx.execute(statement));
const asOwnCompany = (statement: ReturnType<typeof sql>) =>
  f.db.withTenant(f.company, (tx) => tx.execute(statement));

it('FORCE RLS hides both tables from another tenant: reads and updates see nothing, inserts fail', async () => {
  expect(await asOther(sql`SELECT id FROM employee_documents WHERE id=${documentId}`)).toHaveLength(
    0,
  );
  expect(await asOther(sql`SELECT id FROM document_types WHERE id=${typeId}`)).toHaveLength(0);
  expect(
    await asOther(
      sql`UPDATE employee_documents SET replaced_at=now() WHERE id=${documentId} RETURNING id`,
    ),
  ).toHaveLength(0);
  expect(
    await asOther(sql`UPDATE document_types SET active=false WHERE id=${typeId} RETURNING id`),
  ).toHaveLength(0);
  await expect(
    asOther(sql`INSERT INTO document_types(company_id,id,code,name_en,alert_days,requires_expiry)
      VALUES (${f.company},${documentIds.newId()},'intruder','Intruder',1,false)`),
  ).rejects.toThrow();
  await expect(
    asOther(sql`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at)
      VALUES (${f.company},${documentIds.newId()},${f.business},${f.employee.id},'civil_id','intruder-key',${f.userId},now())`),
  ).rejects.toThrow();
});

it('another tenant cannot point its rows at this tenant’s employee or type', async () => {
  await expect(
    asOther(sql`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at)
      VALUES (${f.otherCompany},${documentIds.newId()},${f.business},${f.employee.id},'civil_id','foreign-key',${f.userId},now())`),
  ).rejects.toThrow();
});

it('runtime cannot delete, rehome or rewrite recorded identity, key, expiry or a type code', async () => {
  for (const statement of [
    sql`DELETE FROM employee_documents WHERE id=${documentId}`,
    sql`DELETE FROM document_types WHERE id=${typeId}`,
    sql`UPDATE employee_documents SET object_key='other' WHERE id=${documentId}`,
    sql`UPDATE employee_documents SET expires_on='2099-01-01' WHERE id=${documentId}`,
    sql`UPDATE employee_documents SET company_id=${f.otherCompany} WHERE id=${documentId}`,
    sql`UPDATE document_types SET code='renamed' WHERE id=${typeId}`,
    sql`UPDATE document_types SET company_id=${f.otherCompany} WHERE id=${typeId}`,
  ])
    await expect(asOwnCompany(statement)).rejects.toThrow();
  const tables = await f.h.owner`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname IN ('document_types','employee_documents') ORDER BY relname`;
  expect(tables.map((t) => [t['relname'], t['relrowsecurity'], t['relforcerowsecurity']])).toEqual([
    ['document_types', true, true],
    ['employee_documents', true, true],
  ]);
});

it('one current document per employee and type, and one record per file, hold in the database too', async () => {
  await expect(
    asOwnCompany(sql`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at)
      VALUES (${f.company},${documentIds.newId()},${f.business},${f.employee.id},'civil_id','second-current',${f.userId},now())`),
  ).rejects.toThrow();
  const [row] = await f.h.owner`SELECT object_key FROM employee_documents WHERE id=${documentId}`;
  await expect(
    asOwnCompany(sql`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,replaced_at)
      VALUES (${f.company},${documentIds.newId()},${f.business},${f.employee.id},'passport',${row?.['object_key'] as string},${f.userId},now(),NULL)`),
  ).rejects.toThrow();
});

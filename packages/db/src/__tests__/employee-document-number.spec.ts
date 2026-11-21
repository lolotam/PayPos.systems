import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedEmployee } from '../../test/staff-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const { A } = TENANT;
const type = '01930000-0000-7000-8000-00000000a001';
const employee = '01930000-0000-7000-8000-00000000e001';
let documentSeq = 0;

const insertDocument = async (documentNumber: string | null) => {
  documentSeq += 1;
  const id = `01930000-0000-7000-8000-00000000d${documentSeq.toString().padStart(3, '0')}`;
  const key = `dn-check-${documentSeq}`;
  const replaced = documentSeq === 1 ? sql`NULL` : sql`now()`;
  const statement = sql`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,uploaded_by,recorded_at,replaced_at,document_number)
    VALUES (${A.company},${id},${A.business},${employee},'civil_id',${key},${USER},now(),${replaced},${documentNumber})`;
  await db.withTenant(A.company, (tx) => tx.execute(statement));
  return id;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedTwoTenants(testDb.ownerUrl);
  await owner`INSERT INTO "user"(id,name,email) VALUES (${USER},'Synthetic uploader','uploader@example.test')
  ON CONFLICT (id) DO NOTHING`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => employee } });
  await owner`INSERT INTO document_types(company_id,id,code,name_en,alert_days,requires_expiry)
    VALUES (${A.company},${type},'civil_id','Synthetic civil id',30,false)`;
  await seedEmployee(owner, A.company, employee);
});
afterAll(async () => {
  await owner.end();
  await db?.close();
  await testDb.drop();
});

it('DN-19 accepts NULL and a trimmed number of up to 64 code points, supplementary included', async () => {
  const nullId = await insertDocument(null);
  const plainId = await insertDocument('SYN-DOC-0064');
  const emoji = '🏛'.repeat(64);
  const emojiId = await insertDocument(emoji);
  const stored = await owner`SELECT object_key,document_number FROM employee_documents
    WHERE company_id=${A.company} AND id IN (${nullId},${plainId},${emojiId}) ORDER BY object_key`;
  expect(stored.map((row) => row['object_key'])).toEqual([
    'dn-check-1',
    'dn-check-2',
    'dn-check-3',
  ]);
  expect(stored.map((row) => row['document_number'])).toEqual([null, 'SYN-DOC-0064', emoji]);
});

it.each([
  { name: 'empty string', value: '' },
  { name: 'edge spaces', value: '  SYN-DOC  ' },
  { name: 'edge NBSP', value: ' SYN-DOC ' },
  { name: '65 code points', value: 'خ'.repeat(65) },
  { name: 'tab inside', value: 'SYN\tDOC' },
  { name: 'control inside', value: 'SYN\u0007DOC' },
  { name: 'c1 inside', value: 'SYN\u009fDOC' },
])('DN-20 the CHECK refuses $name', async ({ value }) => {
  await expectPgError(insertDocument(value), '23514', 'employee_documents_document_number');
});

it('DN-20 the application role cannot update the number but can still touch replaced_at', async () => {
  const id = await insertDocument('SYN-DOC-KEEP');
  const rewrite = () =>
    db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`UPDATE employee_documents SET document_number='SYN-REWRITE' WHERE company_id=${A.company} AND id=${id}`,
      ),
    );
  await expectPgError(rewrite(), '42501');
  await db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`UPDATE employee_documents SET replaced_at=now() WHERE company_id=${A.company} AND id=${id}`,
    ),
  );
});

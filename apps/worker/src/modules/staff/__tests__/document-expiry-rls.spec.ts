import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { documentExpiryFixture, type DocumentExpiryFixture } from './document-expiry.fixture.ts';

let f: DocumentExpiryFixture;
beforeAll(async () => {
  f = await documentExpiryFixture();
});
afterAll(async () => {
  await f?.close();
});

it('employee_document_expiry_notices enforces FORCE RLS, hides reads and refuses cross-tenant writes', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const employee = await f.employee(a);
  await f.type(a, 'passport', 30);
  const document = await f.document(a, employee, 'passport', '2026-10-06');
  const noticeId = f.ids.newId();
  await f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
    VALUES(${a.company},${noticeId},${document},${employee},${a.business},'passport','2026-10-06',now())`;

  const [flags] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='employee_document_expiry_notices'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });

  await f.db.withTenant(b.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM employee_document_expiry_notices`)).toHaveLength(0);
  });
  await expect(
    f.db.withTenant(b.company, (tx) =>
      tx.execute(sql`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
        VALUES(${a.company},${f.ids.newId()},${document},${employee},${a.business},'passport','2026-10-06',now())`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`UPDATE employee_document_expiry_notices SET id=id`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`UPDATE employee_document_expiry_notices SET recipients_attached_at=now()`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`DELETE FROM employee_document_expiry_notices`),
    ),
  ).rejects.toThrow();

  const raw = postgres(f.testDb.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(f.testDb.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe('SELECT id FROM employee_document_expiry_notices')).toHaveLength(0);
    await expect(auth.unsafe('SELECT id FROM employee_document_expiry_notices')).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('the tenant-qualified primary key stops a notice pointing at another company document', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const bEmployee = await f.employee(b);
  await f.type(b, 'passport', 30);
  const bDocument = await f.document(b, bEmployee, 'passport', '2026-10-06');
  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
        VALUES(${a.company},${f.ids.newId()},${bDocument},${bEmployee},${b.business},'passport','2026-10-06',now())`),
    ),
  ).rejects.toThrow();
});

import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { businessToday, documentExpiryCandidate } from '../domain/document-expiry.ts';
import { documentExpiryFixture, type DocumentExpiryFixture } from './document-expiry.fixture.ts';

let f: DocumentExpiryFixture;
beforeAll(async () => {
  f = await documentExpiryFixture();
});
afterAll(async () => {
  await f?.close();
});

it.each([
  ['Asia/Kuwait', '2026-10-05T21:00:00Z', '2026-10-06'],
  ['America/New_York', '2026-03-08T04:59:59Z', '2026-03-07'],
  ['America/New_York', '2026-03-08T07:00:00Z', '2026-03-08'],
  ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01'],
  ['America/New_York', '2026-11-01T06:30:00Z', '2026-11-01'],
])('SQL/domain and notification agree for %s at %s', async (zone, instant, today) => {
  const tenant = await f.tenant();
  await f.owner`UPDATE businesses SET timezone=${zone} WHERE company_id=${tenant.company} AND id=${tenant.business}`;
  await f.type(tenant, 'passport', 0);
  const document = await f.document(tenant, await f.employee(tenant), 'passport', today);
  const employee = await f.employee(tenant);
  const outside = zone === 'Asia/Kuwait' ? '2026-10-05' : '2026-12-01';
  const other = await f.document(tenant, employee, 'passport', outside);
  const at = new Date(instant);
  f.setNow(at);
  expect(businessToday(at, zone)).toBe(today);
  const rows = await f.transactions.candidates(
    tenant.company,
    tenant.business,
    zone,
    at,
    null,
    100,
  );
  expect(rows.map((row) => row.documentId)).toEqual([document]);
  expect(documentExpiryCandidate(outside, 0, today)).toBe(false);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  const events = await f.owner`SELECT payload FROM outbox WHERE event_type='DocumentExpiring'
    AND payload->>'document_id' IN (${document}, ${other})`;
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toMatchObject({
    today,
    days_remaining: 0,
    detected_at: at.toISOString(),
  });
});

it('expires_on is immutable for the runtime role', async () => {
  const tenant = await f.tenant();
  await f.type(tenant, 'passport', 30);
  const document = await f.document(tenant, await f.employee(tenant), 'passport', '2026-10-20');
  await expect(
    f.db.withTenant(tenant.company, (tx) =>
      tx.execute(sql`
    UPDATE employee_documents SET expires_on='2026-10-21' WHERE company_id=${tenant.company} AND id=${document}`),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
});

it('business discovery uses bounded keyset pages across more than 100 businesses', async () => {
  const tenant = await f.tenant();
  await f.type(tenant, 'passport', 30);
  await f.owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
    SELECT ${tenant.company}, gen_random_uuid(), 'salon', 'Synthetic paged business' FROM generate_series(1,105)`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    SELECT company_id,gen_random_uuid(),id,'Synthetic paged branch' FROM businesses
    WHERE company_id=${tenant.company} AND name_en='Synthetic paged business'`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT company_id,gen_random_uuid(),business_id,id,'Synthetic paged employee',${employeeNameMatchKey('Synthetic paged employee')},'staff','2026-01-01'
    FROM branches WHERE company_id=${tenant.company} AND name_en='Synthetic paged branch'`;
  await f.owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,expires_on,uploaded_by,recorded_at)
    SELECT company_id,gen_random_uuid(),business_id,id,'passport','synthetic/paged-'||id||'.pdf','2026-10-20',${f.userId},now()
    FROM employees WHERE company_id=${tenant.company} AND name_en='Synthetic paged employee'`;
  const first = await f.transactions.businesses(tenant.company, null, 100);
  const last = first.at(-1);
  if (last === undefined) throw new Error('SYNTHETIC_BUSINESS_PAGE_EMPTY');
  const second = await f.transactions.businesses(tenant.company, last, 100);
  expect(first).toHaveLength(100);
  expect(second).toHaveLength(5);
  expect(new Set([...first, ...second]).size).toBe(105);
  f.setNow(new Date('2026-10-05T10:00:00Z'));
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 105 });
});

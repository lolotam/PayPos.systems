import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { documentExpiryCandidatesStatement } from '../persistence/document-expiry.transactions.ts';
import { documentExpiryFixture, type DocumentExpiryFixture, type Tenant } from './document-expiry.fixture.ts';

let f: DocumentExpiryFixture;
beforeAll(async () => {
  f = await documentExpiryFixture();
});
afterAll(async () => {
  await f?.close();
});

const notices = (documentId: string) =>
  f.owner`SELECT document_id, expires_on, notified_at FROM employee_document_expiry_notices
    WHERE document_id=${documentId}`;
const events = (documentId: string) =>
  f.owner`SELECT payload FROM outbox WHERE event_type='DocumentExpiring'
    AND payload->>'document_id'=${documentId}`;

async function setup(tenant: Tenant, code: string, alertDays = 30, requiresExpiry = true) {
  const employee = await f.employee(tenant);
  await f.type(tenant, code, alertDays, requiresExpiry);
  return employee;
}

it('emits exactly once per document per expiry date across two runs, and a re-run writes nothing', async () => {
  const tenant = await f.tenant();
  const employee = await setup(tenant, 'passport', 30);
  const document = await f.document(tenant, employee, 'passport', '2026-11-04');

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await notices(document)).toHaveLength(1);
  const [event] = await events(document);
  expect(event?.['payload']).toMatchObject({
    document_id: document,
    employee_id: employee,
    business_id: tenant.business,
    type_code: 'passport',
    expires_on: '2026-11-04',
    days_remaining: 30,
    alert_days: 30,
    today: '2026-10-05',
    detected_at: f.clock.now().toISOString(),
  });
  expect(
    await f.owner`SELECT actor_user_id FROM audit_log WHERE action='document_expiring.notified'
      AND entity_id=${document}`,
  ).toEqual([{ actor_user_id: null }]);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await notices(document)).toHaveLength(1);
  expect(await events(document)).toHaveLength(1);
  await expect(
    f.owner`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
      VALUES(${tenant.company},${f.ids.newId()},${document},${employee},${tenant.business},'passport','2026-11-04',now())`,
  ).rejects.toMatchObject({ code: '23505' });
});

it('alert_days 0 fires on the expiry day only, never the day before or after', async () => {
  const tenant = await f.tenant();
  await f.type(tenant, 'civil_id', 0);
  const today = await f.document(tenant, await f.employee(tenant), 'civil_id', '2026-10-05');
  const tomorrow = await f.document(tenant, await f.employee(tenant), 'civil_id', '2026-10-06');
  const yesterday = await f.document(tenant, await f.employee(tenant), 'civil_id', '2026-10-04');

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await notices(today)).toHaveLength(1);
  expect(await notices(tomorrow)).toHaveLength(0);
  expect(await notices(yesterday)).toHaveLength(0);
  expect(await events(today)).toHaveLength(1);
});

it('a replaced document stops being scanned and the replacement gets its own single event', async () => {
  const tenant = await f.tenant();
  const employee = await setup(tenant, 'residency', 30);
  const first = await f.document(tenant, employee, 'residency', '2026-10-06');
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });

  const second = await f.replace(tenant, employee, 'residency', first, '2026-10-06');
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await notices(first)).toHaveLength(1);
  expect(await notices(second)).toHaveLength(1);
  expect(await events(second)).toHaveLength(1);

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await events(first)).toHaveLength(1);
  expect(await events(second)).toHaveLength(1);
});

it('an edited alert_days cannot re-emit after leaving and re-entering the window', async () => {
  const tenant = await f.tenant();
  const employee = await setup(tenant, 'health_certificate', 30);
  const document = await f.document(tenant, employee, 'health_certificate', '2026-11-24');

  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  await f.setAlertDays(tenant, 'health_certificate', 60);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await events(document)).toHaveLength(1);

  await f.setAlertDays(tenant, 'health_certificate', 0);
  await f.setAlertDays(tenant, 'health_certificate', 60);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await notices(document)).toHaveLength(1);
  expect(await events(document)).toHaveLength(1);
});

it('ignores a current document without an expiry date', async () => {
  const tenant = await f.tenant();
  const employee = await setup(tenant, 'work_contract', 30, false);
  const document = await f.document(tenant, employee, 'work_contract', null);
  expect(await f.detect().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await notices(document)).toHaveLength(0);
  expect(await events(document)).toHaveLength(0);
});

it('works only inside the scheduled company: another tenant is never read or written', async () => {
  const a = await f.tenant();
  const b = await f.tenant();
  const bEmployee = await setup(b, 'passport', 30);
  const bDocument = await f.document(b, bEmployee, 'passport', '2026-10-06');

  expect(await f.detect().execute(a.company)).toEqual({ notified: 0 });
  expect(await notices(bDocument)).toHaveLength(0);
  expect(await f.detect().execute(b.company)).toEqual({ notified: 1 });
  expect(await notices(bDocument)).toHaveLength(1);

  await expect(
    f.db.withTenant(a.company, (tx) =>
      tx.execute(sql`INSERT INTO employee_document_expiry_notices(company_id,id,document_id,employee_id,business_id,type_code,expires_on,notified_at)
        VALUES(${b.company},${f.ids.newId()},${bDocument},${bEmployee},${b.business},'passport','2026-10-06',now())`),
    ),
  ).rejects.toThrow();
  await f.db.withTenant(a.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM employee_document_expiry_notices`)).toHaveLength(0);
  });
});

it('pages through more candidates than one page and reads them through the scan index', async () => {
  const tenant = await f.tenant();
  await setup(tenant, 'passport', 30);
  const count = 105;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch},
      'Synthetic bulk employee', 'staff', '2026-01-01'
    FROM generate_series(1, ${count})`;
  await f.owner`INSERT INTO employee_documents(company_id,id,business_id,employee_id,type_code,object_key,expires_on,uploaded_by,recorded_at)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, e.id, 'passport',
      'synthetic/bulk-'||e.id||'.pdf', '2026-10-20'::date, ${f.userId}, clock_timestamp()
    FROM employees e WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic bulk employee'`;

  expect((await f.detect().execute(tenant.company)).notified).toBe(count);
  const plan = await f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${documentExpiryCandidatesStatement(
        tenant.company,
        tenant.business,
        'Asia/Kuwait',
        f.clock.now(),
        null,
        100,
      )}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employee_document_expiry_scan_idx');
});

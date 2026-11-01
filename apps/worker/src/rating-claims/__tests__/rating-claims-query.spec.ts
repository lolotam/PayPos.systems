import { sql, type SQL } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  ratingClaimRepository,
  ratingPageIdsStatement,
  ratingRequestStatement,
  ratingUpperIdStatement,
} from '../../modules/customers/persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from '../../modules/customers/persistence/rating-claim.transactions.ts';
import {
  everyDay,
  ratingClaimsFixture,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';

const KUWAIT = 'Asia/Kuwait';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const VISIT = new Date('2026-06-01T12:10:00.000Z');
const TENANT_A_ROWS = 2400;
const TENANT_B_ROWS = 50;

let f: RatingClaimsFixture;

beforeEach(async () => {
  f = await ratingClaimsFixture();
});

afterEach(async () => {
  await f?.close();
});

/** يزرع عميلاً اصطناعياً للشركة اللي مش عندها عميل. */
async function seedCustomer(companyId: string, id: string, phone: string): Promise<void> {
  await f.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${id}, ${`Query customer ${id.slice(0, 8)}`}, ${phone}, 'ar', now(), now())`;
}

/**
 * دفعة صفوف كبيرة لشركة واحدة، في جملة واحدة: صف مستحق، صف مستقبلي، وصف ملغى.
 * قاعدة الإدراج بتسمح بالحالة المجدولة أو الملغاة بس، فالدفعة بتدخل كده وبعدين
 * بتتحرك على المسار المسموح بجملتين محددتين.
 */
async function seedBulk(
  companyId: string,
  businessId: string,
  branchId: string,
  customerId: string,
  count: number,
): Promise<void> {
  await f.owner`
    INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, status, cancel_reason)
    SELECT
      ${companyId},
      ('0192' || lpad(to_hex(n), 4, '0') || '-7000-8000-0000-' || lpad(to_hex(n), 12, '0'))::uuid,
      ${businessId},
      ${customerId},
      (DATE '2025-01-01' + (n || ' days')::interval)::date,
      ${branchId},
      CASE n % 3 WHEN 0 THEN TIMESTAMPTZ '2026-01-01 09:00:00+00'
                 WHEN 1 THEN TIMESTAMPTZ '2026-06-01 09:00:00+00'
                 ELSE TIMESTAMPTZ '2027-01-01 09:00:00+00' END,
      CASE n % 6 WHEN 0 THEN 'CANCELLED' ELSE 'SCHEDULED' END,
      CASE n % 6 WHEN 0 THEN 'REQUESTS_OFF' ELSE NULL END
    FROM generate_series(1, ${count}::int) AS n`;
}

/**
 * بيعني جزء من الصفوف للإرسال: من مجدول لمُرسل، ببصمة الرابط ودليل الجاهزية
 * اللي القيود بتطلبهم، وكل القيم بتتم في جملة واحدة.
 */
async function advanceToSending(companyId: string, customerId: string): Promise<void> {
  await f.owner`
    UPDATE rating_requests
       SET status = 'SENDING',
           token_hash = decode(md5(id::text) || md5(id::text || 'x'), 'hex'),
           token_key_version = 1,
           claimed_at = TIMESTAMPTZ '2026-05-01 09:00:00+00',
           expires_at = TIMESTAMPTZ '2026-05-01 09:00:00+00' + interval '168 hours',
           ready_event_id = md5(id::text)::uuid,
           updated_at = now()
     WHERE company_id = ${companyId}
       AND customer_id = ${customerId}
       AND status = 'SCHEDULED'
       AND (business_date - DATE '2025-01-01') % 6 IN (1, 2)`;
}

/** بيبعت جزء من الصفوف المرسلة، وده آخر انتقال مسموح في المسار. */
async function advanceToSent(companyId: string, customerId: string): Promise<void> {
  await f.owner`
    UPDATE rating_requests
       SET status = 'SENT', sent_at = TIMESTAMPTZ '2026-05-02 09:00:00+00', updated_at = now()
     WHERE company_id = ${companyId}
       AND customer_id = ${customerId}
       AND status = 'SENDING'
       AND (business_date - DATE '2025-01-01') % 6 = 2`;
}

/** صفوف شركة الأولى: حجم كافي يخلي المخطط يختار فهرس المفتاح الأساسي. */
async function seedTenantA(customerId: string, branchId: string): Promise<void> {
  await seedBulk(TENANT.A.company, TENANT.A.business, branchId, customerId, TENANT_A_ROWS);
  await advanceToSending(TENANT.A.company, customerId);
  await advanceToSent(TENANT.A.company, customerId);
}

/** صفوف الشركة التانية، بأقل حجم، عشان عزل المستأجر يتأكد. */
async function seedTenantB(): Promise<void> {
  const customerId = f.ids.newId();
  await seedCustomer(TENANT.B.company, customerId, '+99999990001');
  await seedBulk(TENANT.B.company, TENANT.B.business, TENANT.B.branch, customerId, TENANT_B_ROWS);
  await advanceToSending(TENANT.B.company, customerId);
  await advanceToSent(TENANT.B.company, customerId);
}

/** خطة التنفيذ لنص جملة، مجمّعة من سطور EXPLAIN. */
async function planOf(statement: SQL): Promise<string> {
  const rows = await f.db.withTenant(TENANT.A.company, (tx) =>
    tx.execute<Record<string, string>>(sql`EXPLAIN (ANALYZE, BUFFERS) ${statement}`),
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

/** الخطط المتوقعة: بحث بالمفتاح الأساسي، من غير مسح متسلسل ولا ترتيب ولا أقفال. */
async function expectIndexPlans(cursor: string, upper: string, requestId: string): Promise<void> {
  const upperPlan = await planOf(ratingUpperIdStatement(TENANT.A.company));
  expect(upperPlan).toContain('rating_requests_pkey');
  expect(upperPlan).toMatch(/Index (Only )?Scan/);
  expect(upperPlan).not.toMatch(/Seq Scan on rating_requests/);
  expect(upperPlan).not.toMatch(/Sort/);
  expect(upperPlan).not.toMatch(/LockRows/);

  const pagePlan = await planOf(ratingPageIdsStatement(TENANT.A.company, cursor, upper, 10));
  expect(pagePlan).toContain('rating_requests_pkey');
  expect(pagePlan).toMatch(/Index (Only )?Scan/);
  expect(pagePlan).not.toMatch(/Seq Scan on rating_requests/);
  expect(pagePlan).not.toMatch(/Sort/);
  expect(pagePlan).not.toMatch(/LockRows/);

  const pointPlan = await planOf(ratingRequestStatement(TENANT.A.company, requestId));
  expect(pointPlan).toContain('rating_requests_pkey');
  expect(pointPlan).toMatch(/Index Scan/);
  expect(pointPlan).not.toMatch(/Seq Scan on rating_requests/);
  expect(pointPlan).not.toMatch(/LockRows/);
}

it('query_shape_and_explain_use_company_primary_key', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({ customerId: customer, branchId, occurredAt: VISIT });
  await f.schedule(session.sessionId);
  const historyCustomer = await f.customer();
  await seedTenantA(historyCustomer, branchId);
  await seedTenantB();
  await f.owner`ANALYZE rating_requests`;

  const scheduled = await f.requestIds(customer);
  expect(scheduled).toHaveLength(1);
  const transactions = ratingClaimTransactions(f.db);

  const upper = await transactions.upperId(TENANT.A.company);
  const upperRows = await f.owner`SELECT id FROM rating_requests
    WHERE company_id = ${TENANT.A.company} ORDER BY id DESC LIMIT 1`;
  expect(upper).toBe(upperRows[0]?.['id']);

  const firstPage = await transactions.pageIds(TENANT.A.company, null, upper ?? '', 3);
  expect(firstPage).toHaveLength(3);
  expect([...firstPage].sort()).toEqual(firstPage);
  expect(firstPage.every((id) => id <= (upper ?? ''))).toBe(true);

  const cursor = firstPage[firstPage.length - 1] ?? '';
  const secondPage = await transactions.pageIds(TENANT.A.company, cursor, upper ?? '', 10);
  expect(secondPage.length).toBeGreaterThan(0);
  expect(secondPage.every((id) => id > cursor && id <= (upper ?? ''))).toBe(true);

  const otherUpper = await transactions.upperId(TENANT.B.company);
  const otherRows = await f.owner`SELECT id FROM rating_requests
    WHERE company_id = ${TENANT.B.company} ORDER BY id DESC LIMIT 1`;
  expect(otherUpper).toBe(otherRows[0]?.['id']);

  const read = await f.db.withTenant(TENANT.A.company, (tx) =>
    ratingClaimRepository.findRequest(tx, TENANT.A.company, scheduled[0] ?? ''),
  );
  expect(read?.status).toBe('SCHEDULED');
  expect(read?.dueAt).toBeInstanceOf(Date);
  expect(read?.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const missing = await f.db.withTenant(TENANT.A.company, (tx) =>
    ratingClaimRepository.findRequest(tx, TENANT.A.company, f.ids.newId()),
  );
  expect(missing).toBeNull();

  const seen = await transactions.withRequest(
    TENANT.A.company,
    scheduled[0] ?? '',
    async (_tx, request) => (request === null ? 'ABSENT' : request.status),
  );
  expect(seen).toBe('SCHEDULED');

  await expectIndexPlans(cursor, upper ?? '', scheduled[0] ?? '');
});

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

let f: RatingClaimsFixture;

beforeEach(async () => {
  f = await ratingClaimsFixture();
});

afterEach(async () => {
  await f?.close();
});

interface SeedRequest {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly id: string;
  readonly dueAt: string;
  readonly businessDate: string;
  readonly status: 'SCHEDULED' | 'CANCELLED';
}

/** يزرع طلب تقييم بحالة معلومة: مستحق أو مستقبلي أو ملغى. */
async function seedRequest(row: SeedRequest): Promise<void> {
  const reason = row.status === 'CANCELLED' ? 'REQUESTS_OFF' : null;
  await f.owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, status, cancel_reason)
    VALUES (${row.companyId}, ${row.id}, ${row.businessId}, ${row.customerId}, ${row.businessDate},
      ${row.branchId}, ${row.dueAt}::timestamptz, ${row.status}, ${reason})`;
}

/** يزرع عميلاً اصطناعياً للشركة التانية عشان ليها طلبات. */
async function seedCustomer(companyId: string, id: string, phone: string): Promise<void> {
  await f.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${id}, ${`Query customer ${id.slice(0, 8)}`}, ${phone}, 'ar', now(), now())`;
}

/** خطة التنفيذ لنص جملة، مجمّعة من سطور EXPLAIN. */
async function planOf(statement: SQL): Promise<string> {
  const rows = await f.db.withTenant(TENANT.A.company, (tx) =>
    tx.execute<Record<string, string>>(sql`EXPLAIN (ANALYZE, BUFFERS) ${statement}`),
  );
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

/** المزيج المطلوب: تاريخ مستحق، صف مستقبلي، صف ملغى، وصفوف شركة تانية. */
async function seedMix(
  historyCustomer: string,
  branchId: string,
): Promise<{ own: string[]; other: string[] }> {
  const own: string[] = [];
  for (const day of ['2026-04-01', '2026-04-02', '2026-04-03']) {
    const id = f.ids.newId();
    own.push(id);
    await seedRequest({
      companyId: TENANT.A.company,
      businessId: TENANT.A.business,
      branchId,
      customerId: historyCustomer,
      id,
      dueAt: `${day}T09:00:00.000Z`,
      businessDate: day,
      status: 'SCHEDULED',
    });
  }
  const future = f.ids.newId();
  own.push(future);
  await seedRequest({
    companyId: TENANT.A.company,
    businessId: TENANT.A.business,
    branchId,
    customerId: historyCustomer,
    id: future,
    dueAt: '2027-01-01T09:00:00.000Z',
    businessDate: '2027-01-01',
    status: 'SCHEDULED',
  });
  const terminal = f.ids.newId();
  own.push(terminal);
  await seedRequest({
    companyId: TENANT.A.company,
    businessId: TENANT.A.business,
    branchId,
    customerId: historyCustomer,
    id: terminal,
    dueAt: '2026-05-01T09:00:00.000Z',
    businessDate: '2026-05-01',
    status: 'CANCELLED',
  });
  const otherCustomer = f.ids.newId();
  await seedCustomer(TENANT.B.company, otherCustomer, '+99999990001');
  const other: string[] = [];
  for (const day of ['2026-04-10', '2026-04-11']) {
    const id = f.ids.newId();
    other.push(id);
    await seedRequest({
      companyId: TENANT.B.company,
      businessId: TENANT.B.business,
      branchId: TENANT.B.branch,
      customerId: otherCustomer,
      id,
      dueAt: `${day}T09:00:00.000Z`,
      businessDate: day,
      status: 'SCHEDULED',
    });
  }
  return { own, other };
}

function largest(ids: readonly string[]): string {
  return ids.reduce((max, id) => (id > max ? id : max), ids[0] ?? '');
}

it('query_shape_and_explain_use_company_primary_key', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({ customerId: customer, branchId, occurredAt: VISIT });
  await f.schedule(session.sessionId);
  const historyCustomer = await f.customer();
  const mix = await seedMix(historyCustomer, branchId);
  const scheduled = await f.requestIds(customer);
  expect(scheduled).toHaveLength(1);
  const own = [...scheduled, ...mix.own];
  const transactions = ratingClaimTransactions(f.db);

  const upper = await transactions.upperId(TENANT.A.company);
  expect(upper).toBe(largest(own));

  const firstPage = await transactions.pageIds(TENANT.A.company, null, upper ?? '', 3);
  expect(firstPage).toHaveLength(3);
  expect([...firstPage].sort()).toEqual(firstPage);
  expect(firstPage.every((id) => id <= (upper ?? ''))).toBe(true);
  expect(firstPage.some((id) => mix.other.includes(id))).toBe(false);

  const cursor = firstPage[firstPage.length - 1] ?? '';
  const secondPage = await transactions.pageIds(TENANT.A.company, cursor, upper ?? '', 10);
  expect(secondPage.length).toBeGreaterThan(0);
  expect(secondPage.every((id) => id > cursor && id <= (upper ?? ''))).toBe(true);
  expect(secondPage.some((id) => mix.other.includes(id))).toBe(false);

  const otherUpper = await transactions.upperId(TENANT.B.company);
  expect(otherUpper).toBe(largest(mix.other));

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

  const seen = await transactions.withRequest(TENANT.A.company, scheduled[0] ?? '', async (_tx, request) =>
    request === null ? 'ABSENT' : request.status,
  );
  expect(seen).toBe('SCHEDULED');

  await expectIndexPlans(cursor, upper ?? '', scheduled[0] ?? '');
});

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

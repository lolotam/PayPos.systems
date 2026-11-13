import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const CATEGORY_A = '01920000-0000-7000-8000-0000000007a1';
const CATEGORY_A_OTHER_BUSINESS = '01920000-0000-7000-8000-0000000007a2';
const CATEGORY_B = '01920000-0000-7000-8000-0000000007b1';
const SECOND_BUSINESS_A = '01920000-0000-7000-8000-0000000007b2';
const CLOSING_B = '01920000-0000-7000-8000-0000000007c1';
const CLOSING_CROSS_TENANT = '01920000-0000-7000-8000-0000000007c2';
const CLOSING_FOREIGN_CATEGORY = '01920000-0000-7000-8000-0000000007c3';
const CLOSING_A = '01920000-0000-7000-8000-0000000007c4';

let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES (${USER},'Closings RLS user','closings-rls@example.test',true,now(),now())
    ON CONFLICT DO NOTHING`;
  // نشاط تاني لنفس الشركة A: التصنيف بتاعه لازم ما يتقفلش بطلب_activity_activity من نشاط تاني.
  await owner`INSERT INTO businesses (id,company_id,vertical_type,name_en)
    VALUES (${SECOND_BUSINESS_A},${A.company},'salon','Second business A')`;
  await owner`INSERT INTO service_categories (company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${A.company},${CATEGORY_A},${A.business},'Category A','تصنيف أ','BUSINESS'),
           (${A.company},${CATEGORY_A_OTHER_BUSINESS},${SECOND_BUSINESS_A},'Category A second','تصنيف أ٢','BUSINESS'),
           (${B.company},${CATEGORY_B},${B.business},'Category B','تصنيف ب','BUSINESS')`;
  // طلب قفل معلق لشركة B: ده الصف اللي A مش المفروض تشوفه ولا تكتب فيه.
  await owner`INSERT INTO service_category_closings
    (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
      requested_by,requested_at,deadline_at)
    VALUES (${B.company},${CLOSING_B},${B.business},${CATEGORY_B},'close','pending',1,1,
      ${USER},now(),now()+interval '15 minutes')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => CLOSING_A } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** قراءة أو كتابة باسم شركة A: الـ RLS نفسه هو اللي بيرفض أي صف مش بتاع A. */
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));

/** صف طلب قفل: بيانات الطلب ثابتة، واللي بيتغيّر بس هو الشركة والنشاط والتصنيف. */
const closingInsert = (
  id: string,
  companyId: string,
  businessId: string,
  categoryId: string,
) => sql`INSERT INTO service_category_closings
  (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
    requested_by,requested_at,deadline_at)
  VALUES (${companyId},${id},${businessId},${categoryId},'close','pending',1,1,
    ${USER},now(),now()+interval '15 minutes') RETURNING id`;

async function rejectsWith(work: Promise<unknown>, expected: RegExp): Promise<void> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}

it('the table has row-level security enabled and forced', async () => {
  const [row] = await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
    WHERE oid='service_category_closings'::regclass`;
  expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});

it('a cross-tenant read of a closing request returns no rows', async () => {
  expect(await asA(sql`SELECT id FROM service_category_closings`)).toEqual([]);
  expect(await asA(sql`SELECT id FROM service_category_closings WHERE id=${CLOSING_B}`)).toEqual(
    [],
  );
  // الصف موجود فعلاً عند مالكه: صفر الصفوف عند A مش لأن الصف مش موجود.
  expect(await owner`SELECT id FROM service_category_closings WHERE id=${CLOSING_B}`).toHaveLength(
    1,
  );
});

it('a cross-tenant update of a closing request touches no rows', async () => {
  const touched = await asA(sql`UPDATE service_category_closings
    SET status='completed',services_changed=1,finished_at=now()
    WHERE company_id=${B.company} AND id=${CLOSING_B} RETURNING id`);
  expect(touched).toEqual([]);
  const [row] = await owner`SELECT status,services_changed FROM service_category_closings
    WHERE id=${CLOSING_B}`;
  expect(row).toMatchObject({ status: 'pending', services_changed: null });
});

it('a cross-tenant insert of a closing request is refused by the row-level policy', async () => {
  await rejectsWith(
    asA(closingInsert(CLOSING_CROSS_TENANT, B.company, B.business, CATEGORY_B)),
    /row-level security/,
  );
  expect(
    await owner`SELECT id FROM service_category_closings WHERE id=${CLOSING_CROSS_TENANT}`,
  ).toHaveLength(0);
});

it('a closing request cannot point at a category of another business of the same company', async () => {
  await rejectsWith(
    asA(closingInsert(CLOSING_FOREIGN_CATEGORY, A.company, A.business, CATEGORY_A_OTHER_BUSINESS)),
    /service_category_closings_category_fk/,
  );
  expect(
    await owner`SELECT id FROM service_category_closings WHERE id=${CLOSING_FOREIGN_CATEGORY}`,
  ).toHaveLength(0);
});

it('a closing request of its own company is accepted', async () => {
  const rows = await asA(closingInsert(CLOSING_A, A.company, A.business, CATEGORY_A));
  expect(rows).toHaveLength(1);
  expect(await owner`SELECT id FROM service_category_closings WHERE id=${CLOSING_A}`).toHaveLength(
    1,
  );
});

it('a delete of a closing request is refused: the record of the operation is kept', async () => {
  await rejectsWith(
    asA(sql`DELETE FROM service_category_closings WHERE id=${CLOSING_B}`),
    /permission denied/,
  );
  expect(await owner`SELECT id FROM service_category_closings WHERE id=${CLOSING_B}`).toHaveLength(
    1,
  );
});

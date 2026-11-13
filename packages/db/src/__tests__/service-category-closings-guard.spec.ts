import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A } = TENANT;
// تصنيف لكل حالة على حدة: صف معلق في تصنيف بيمنع صف تاني معلق في التصنيف نفسه.
const CATEGORY_UNIQUE = '01920000-0000-7000-8000-0000000008a1';
const CATEGORY_COMPLETED = '01920000-0000-7000-8000-0000000008a2';
const CATEGORY_FAILED = '01920000-0000-7000-8000-0000000008a3';
const CATEGORY_TERMINAL = '01920000-0000-7000-8000-0000000008a4';
const CATEGORY_BACK_TO_PENDING = '01920000-0000-7000-8000-0000000008a5';
const CATEGORY_REVISION = '01920000-0000-7000-8000-0000000008a6';
const CATEGORY_GRANT = '01920000-0000-7000-8000-0000000008a7';
const CATEGORY_INSERT = '01920000-0000-7000-8000-0000000008a8';
const CATEGORY_IDS = [
  CATEGORY_UNIQUE,
  CATEGORY_COMPLETED,
  CATEGORY_FAILED,
  CATEGORY_TERMINAL,
  CATEGORY_BACK_TO_PENDING,
  CATEGORY_REVISION,
  CATEGORY_GRANT,
  CATEGORY_INSERT,
];
const REQUESTED_AT = '2026-11-13T09:00:00Z';
const DEADLINE_AT = '2026-11-13T09:15:00Z';

let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES (${USER},'Closings guard user','closings-guard@example.test',true,now(),now())
    ON CONFLICT DO NOTHING`;
  for (const [index, id] of CATEGORY_IDS.entries()) {
    await owner`INSERT INTO service_categories (company_id,id,business_id,name_en,name_ar,visibility)
      VALUES (${A.company},${id},${A.business},${'Category ' + (index + 1)},${'تصنيف ' + (index + 1)},
        'BUSINESS')`;
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => CATEGORY_UNIQUE } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** الكتابة كـ pospay_app: الحارس والصلاحيات وقت التشغيل هما اللي بيتحققوا هنا. */
const asApp = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(query));

const pendingInsert = (id: string, categoryId: string) => sql`INSERT INTO service_category_closings
  (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
    requested_by,requested_at,deadline_at)
  VALUES (${A.company},${id},${A.business},${categoryId},'close','pending',1,1,
    ${USER},${REQUESTED_AT}::timestamptz,${DEADLINE_AT}::timestamptz) RETURNING id`;

const insertWithStatus = (
  id: string,
  categoryId: string,
  status: string,
) => sql`INSERT INTO service_category_closings
  (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
    requested_by,requested_at,deadline_at)
  VALUES (${A.company},${id},${A.business},${categoryId},'close',${status},1,1,
    ${USER},${REQUESTED_AT}::timestamptz,${DEADLINE_AT}::timestamptz) RETURNING id`;

/** خطأ القاعدة نفسه: الـ Drizzle بيغلّفه، فننزل للغلاف ونفحص الأصلي. */
async function pgError(work: Promise<unknown>): Promise<Record<string, unknown>> {
  const thrown = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(thrown).toBeInstanceOf(Error);
  const cause = (thrown as Error & { cause?: unknown }).cause;
  const source = cause instanceof Error ? cause : (thrown as Error);
  return source as unknown as Record<string, unknown>;
}

/** صف الطلب الكامل، واللي بيتغيّر في كل حالة هو الحقول الناقصة أو الغلط. */
const BASE_ROW = {
  company_id: A.company,
  business_id: A.business,
  category_id: CATEGORY_UNIQUE,
  action: 'close',
  status: 'pending',
  expected_revision: 1,
  expected_service_count: 1,
  services_changed: null,
  error_code: null,
  requested_by: USER,
  requested_at: REQUESTED_AT,
  deadline_at: DEADLINE_AT,
  finished_at: null,
};

interface CheckCase {
  readonly label: string;
  readonly overrides: Record<string, unknown>;
  readonly constraint: string;
}

/** القيد نفسه هو اللي بيتفحص: بنوقف الحارس جوه معاملة بتتلغي، فالباقي هو القيد. */
const insertWithoutGuard = async (row: Record<string, unknown>): Promise<unknown> =>
  owner.begin(async (tx) => {
    await tx`ALTER TABLE service_category_closings DISABLE TRIGGER service_category_closing_guard`;
    await tx`INSERT INTO service_category_closings ${tx(row)}`;
  });

it('only one pending row per category: a second one is refused and a completed row frees the category', async () => {
  const first = randomUUID();
  await asApp(pendingInsert(first, CATEGORY_UNIQUE));
  const error = await pgError(asApp(pendingInsert(randomUUID(), CATEGORY_UNIQUE)));
  expect(error['code']).toBe('23505');
  expect(error['constraint_name']).toBe('service_category_closings_one_pending_uq');
  await asApp(sql`UPDATE service_category_closings SET status='completed',services_changed=1,
    finished_at=${REQUESTED_AT}::timestamptz WHERE id=${first} RETURNING id`);
  expect(await asApp(pendingInsert(randomUUID(), CATEGORY_UNIQUE))).toHaveLength(1);
});

it('the guard accepts a pending row that becomes completed or failed', async () => {
  const toComplete = randomUUID();
  await asApp(pendingInsert(toComplete, CATEGORY_COMPLETED));
  expect(
    await asApp(sql`UPDATE service_category_closings SET status='completed',services_changed=1,
      finished_at=${REQUESTED_AT}::timestamptz WHERE id=${toComplete} RETURNING id,status`),
  ).toEqual([{ id: toComplete, status: 'completed' }]);

  const toFail = randomUUID();
  await asApp(pendingInsert(toFail, CATEGORY_FAILED));
  expect(
    await asApp(sql`UPDATE service_category_closings SET status='failed',
      error_code='SERVICE_CATEGORY_CLOSING_FAILED',finished_at=${REQUESTED_AT}::timestamptz
      WHERE id=${toFail} RETURNING id,status`),
  ).toEqual([{ id: toFail, status: 'failed' }]);
});

it('the guard refuses an insert that is not pending', async () => {
  const error = await pgError(asApp(insertWithStatus(randomUUID(), CATEGORY_INSERT, 'completed')));
  expect(error['code']).toBe('23514');
  expect(String(error['message'])).toContain('SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID');
});

it('the guard refuses a completed row that moves to failed', async () => {
  const row = randomUUID();
  await asApp(pendingInsert(row, CATEGORY_TERMINAL));
  await asApp(sql`UPDATE service_category_closings SET status='completed',services_changed=1,
    finished_at=${REQUESTED_AT}::timestamptz WHERE id=${row}`);
  const error = await pgError(
    asApp(sql`UPDATE service_category_closings SET status='failed',
      error_code='SERVICE_CATEGORY_CLOSING_FAILED',finished_at=${REQUESTED_AT}::timestamptz
      WHERE id=${row} RETURNING id`),
  );
  expect(error['code']).toBe('23514');
  expect(String(error['message'])).toContain('SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID');
});

it('the guard refuses a failed row that moves back to pending', async () => {
  const row = randomUUID();
  await asApp(pendingInsert(row, CATEGORY_BACK_TO_PENDING));
  await asApp(sql`UPDATE service_category_closings SET status='failed',
    error_code='SERVICE_CATEGORY_CLOSING_FAILED',finished_at=${REQUESTED_AT}::timestamptz
    WHERE id=${row}`);
  const error = await pgError(
    asApp(sql`UPDATE service_category_closings SET status='pending' WHERE id=${row} RETURNING id`),
  );
  expect(error['code']).toBe('23514');
  expect(String(error['message'])).toContain('SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID');
});

it('the guard refuses a change of the planned revision of a pending row', async () => {
  const row = randomUUID();
  await asApp(pendingInsert(row, CATEGORY_REVISION));
  // الـ owner هو اللي يقدر يعدّل عمود الطلب: دور الـ app ما عندوش صلاحية عليه أصلاً.
  const error = await pgError(
    owner`UPDATE service_category_closings SET expected_revision=5 WHERE id=${row} RETURNING id`,
  );
  expect(error['code']).toBe('23514');
  expect(String(error['message'])).toContain('SERVICE_CATEGORY_CLOSING_TRANSITION_INVALID');
});

it('the app role cannot change the planned count of a pending row', async () => {
  const row = randomUUID();
  await asApp(pendingInsert(row, CATEGORY_GRANT));
  const error = await pgError(
    asApp(
      sql`UPDATE service_category_closings SET expected_service_count=9 WHERE id=${row} RETURNING id`,
    ),
  );
  expect(error['code']).toBe('42501');
  expect(String(error['message'])).toContain('permission denied');
});

it('the CHECK refuses every malformed shape of the row', async () => {
  const cases: CheckCase[] = [
    {
      label: 'a pending row with a finish time',
      overrides: { finished_at: REQUESTED_AT },
      constraint: 'service_category_closings_shape_check',
    },
    {
      label: 'a completed row without a changed count',
      overrides: { status: 'completed', finished_at: REQUESTED_AT },
      constraint: 'service_category_closings_shape_check',
    },
    {
      label: 'a failed row without an error code',
      overrides: { status: 'failed', finished_at: REQUESTED_AT },
      constraint: 'service_category_closings_shape_check',
    },
    {
      label: 'an error code outside the six codes',
      overrides: {
        status: 'failed',
        error_code: 'SERVICE_CATEGORY_UNKNOWN',
        finished_at: REQUESTED_AT,
      },
      constraint: 'service_category_closings_error_code_check',
    },
    {
      label: 'an expected count of zero',
      overrides: { expected_service_count: 0 },
      constraint: 'service_category_closings_expected_service_count_check',
    },
    {
      label: 'a deadline that is not after the request',
      overrides: { deadline_at: REQUESTED_AT },
      constraint: 'service_category_closings_deadline_at_check',
    },
  ];
  for (const testCase of cases) {
    const error = await insertWithoutGuard({
      ...BASE_ROW,
      id: randomUUID(),
      ...testCase.overrides,
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error, testCase.label).not.toBeNull();
    expect(error, testCase.label).toMatchObject({
      code: '23514',
      constraint_name: testCase.constraint,
    });
  }
});

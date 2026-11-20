import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { insertCommissionPlanVersion } from '../../test/commission-plan-version-fixtures.ts';
import {
  COMMISSION_TENANT,
  OTHER_COMMISSION_IDS,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionBlockedCorrection,
  lockTargetStatement,
} from '../../test/commission-correction-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = COMMISSION_TENANT;
const OPEN_KEY = 'commission_blocked_corrections_open_key';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));

/** بيقفل كشف هدف لشهر معيّن ويرجّع معرّفه، عشان المفاتيح المركّبة تتكتب على كشف حقيقي. */
const statementOf = (period: string) =>
  lockTargetStatement({ db, companyId: A.company, businessId: A.business, period, ids });

/** بيكتب صف موقوف صحيح افتراضي كـ pospay_app ويرجّع معرّفه، مع تجاوزات محدودة. */
const insertBlock = async (
  statementId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  let blockId = '';
  await db.withTenant(A.company, async (tx) => {
    blockId = await insertCommissionBlockedCorrection(tx, A, ids, statementId, overrides);
  });
  return blockId;
};

/** بيحلّ صف موقوف كـ pospay_app: عمودا الحل ممنوحين بالاسم، وده إثبات إن المنح بيشتغل. */
const resolveRow = (blockId: string, generation: number) =>
  asA(
    sql`UPDATE commission_blocked_corrections
      SET resolved_at='2026-11-05T08:00:00Z', resolved_generation=${generation}
      WHERE id=${blockId} RETURNING id`,
  );

it('C1: one open row per employee and month — a duplicate fails, a resolved month opens again', async () => {
  const statementId = await statementOf('2026-11');
  const first = await insertBlock(statementId);
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, statementId, { id: ids.newId() }),
    ),
    '23505',
    OPEN_KEY,
  );
  expect(await resolveRow(first, 1)).toHaveLength(1);
  const second = await insertBlock(statementId);
  expect(second).not.toEqual(first);
  expect(await resolveRow(second, 2)).toHaveLength(1);
});

it('C2: a block code outside NO_PLAN and NO_SALARY is refused', async () => {
  const statementId = await statementOf('2026-11');
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, statementId, {
        sourcePeriod: '2026-09',
        code: 'NO_EMPLOYEE',
      }),
    ),
    '23514',
    'commission_blocked_corrections_code',
  );
});

it('C3: the held target is a later month and a real statement of the same business', async () => {
  const novemberId = await statementOf('2026-11');
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, novemberId, {
        sourcePeriod: '2026-08',
        targetPeriod: '2026-07',
      }),
    ),
    '23514',
    'commission_blocked_corrections_target_after_source',
  );
  // الكشف الممرّر كشف نوفمبر، والشهر المحتجز مكتوب ديسمبر: الزوج ما بيتطابقش، فالـ FK بيرفض.
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, novemberId, {
        sourcePeriod: '2026-08',
        targetPeriod: '2026-12',
        targetStatementId: novemberId,
      }),
    ),
    '23503',
    'commission_blocked_corrections_target_statement_fk',
  );
  // كشف نشاط تاني بنفس الشركة: المفتاح المركّب بيمنع الاحتجاز على كشف من نشاط مختلف.
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertCommissionBlockedCorrection(tx, A, ids, novemberId, {
        sourcePeriod: '2026-08',
        businessId: OTHER_COMMISSION_IDS.business,
        employeeId: OTHER_COMMISSION_IDS.employee,
        targetStatementId: novemberId,
      }),
    ),
    '23503',
    'commission_blocked_corrections_target_statement_fk',
  );
});

it('C4: the code of an open row moves NO_PLAN to NO_SALARY and back', async () => {
  const statementId = await statementOf('2026-11');
  const blockId = await insertBlock(statementId, { sourcePeriod: '2026-07' });
  expect(
    await asA(
      sql`UPDATE commission_blocked_corrections SET code='NO_SALARY'
        WHERE id=${blockId} RETURNING code`,
    ),
  ).toEqual([{ code: 'NO_SALARY' }]);
  expect(
    await asA(
      sql`UPDATE commission_blocked_corrections SET code='NO_PLAN'
        WHERE id=${blockId} RETURNING code`,
    ),
  ).toEqual([{ code: 'NO_PLAN' }]);
});

it('C5: a resolved row refuses every update, resolved_at returning to null included', async () => {
  const statementId = await statementOf('2026-11');
  const blockId = await insertBlock(statementId, { sourcePeriod: '2026-06' });
  expect(await resolveRow(blockId, 1)).toHaveLength(1);
  const frozen = 'commission_blocked_corrections_resolved_immutable';
  await expectPgError(
    asA(sql`UPDATE commission_blocked_corrections SET code='NO_SALARY' WHERE id=${blockId}`),
    '23514',
    frozen,
  );
  await expectPgError(
    asA(
      sql`UPDATE commission_blocked_corrections SET resolved_at='2026-12-01T08:00:00Z'
        WHERE id=${blockId}`,
    ),
    '23514',
    frozen,
  );
  await expectPgError(
    asA(sql`UPDATE commission_blocked_corrections SET resolved_generation=2 WHERE id=${blockId}`),
    '23514',
    frozen,
  );
  await expectPgError(
    asA(sql`UPDATE commission_blocked_corrections SET resolved_at=NULL WHERE id=${blockId}`),
    '23514',
    frozen,
  );
});

it('C6: the held target is updatable by no privilege, and by no role including the owner', async () => {
  const novemberId = await statementOf('2026-11');
  const decemberId = await statementOf('2026-12');
  const blockId = await insertBlock(novemberId, { sourcePeriod: '2026-05' });
  const immutable = 'commission_blocked_corrections_target_immutable';
  await expectPgError(
    asA(sql`UPDATE commission_blocked_corrections SET target_period='2026-12' WHERE id=${blockId}`),
    '42501',
  );
  await expectPgError(
    asA(
      sql`UPDATE commission_blocked_corrections SET target_statement_id=${decemberId}
        WHERE id=${blockId}`,
    ),
    '42501',
  );
  await expectPgError(
    owner`UPDATE commission_blocked_corrections SET target_period='2026-12' WHERE id=${blockId}`,
    '23514',
    immutable,
  );
  await expectPgError(
    owner`UPDATE commission_blocked_corrections SET target_statement_id=${decemberId}
      WHERE id=${blockId}`,
    '23514',
    immutable,
  );
  expect(await resolveRow(blockId, 1)).toHaveLength(1);
});

it('C7: resolved_at and resolved_generation come together or not at all, and a row is born open', async () => {
  const statementId = await statementOf('2026-11');
  const blockId = await insertBlock(statementId, { sourcePeriod: '2026-04' });
  const pair = 'commission_blocked_corrections_resolution_pair';
  // الصف بيتولد مفتوح بس: إدخال pospay_app بعمود الحل مرفوض بالصلاحية قبل أي قيد.
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`INSERT INTO commission_blocked_corrections(
          company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
          target_statement_id,created_at,resolved_at)
          VALUES (${A.company},${ids.newId()},${A.business},${A.employee},'2026-01','NO_PLAN',
            ${ids.newId()},'2026-11',${statementId},'2026-11-01T08:00:00Z','2026-11-05T08:00:00Z')`,
      ),
    ),
    '42501',
  );
  // كـ owner الإدخال بعمود حل واحد بس بيرفض بقيد الزوج في الاتجاهين.
  await expectPgError(
    owner`INSERT INTO commission_blocked_corrections(
      company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
      target_statement_id,created_at,resolved_at)
      VALUES (${A.company},${ids.newId()},${A.business},${A.employee},'2026-01','NO_PLAN',
        ${ids.newId()},'2026-11',${statementId},'2026-11-01T08:00:00Z','2026-11-05T08:00:00Z')`,
    '23514',
    pair,
  );
  await expectPgError(
    owner`INSERT INTO commission_blocked_corrections(
      company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
      target_statement_id,created_at,resolved_generation)
      VALUES (${A.company},${ids.newId()},${A.business},${A.employee},'2026-01','NO_PLAN',
        ${ids.newId()},'2026-11',${statementId},'2026-11-01T08:00:00Z',1)`,
    '23514',
    pair,
  );
  await expectPgError(
    asA(
      sql`UPDATE commission_blocked_corrections SET resolved_at='2026-11-05T08:00:00Z'
        WHERE id=${blockId}`,
    ),
    '23514',
    pair,
  );
});

it('C8: pospay_app may not delete a blocked correction', async () => {
  const statementId = await statementOf('2026-11');
  const blockId = await insertBlock(statementId, { sourcePeriod: '2026-03' });
  await expectPgError(
    asA(sql`DELETE FROM commission_blocked_corrections WHERE id=${blockId}`),
    '42501',
  );
});

it('C9: the FR-048 predicate reads the open blocks of a statement through the partial target index', async () => {
  const novemberId = await statementOf('2026-11');
  const decemberId = await statementOf('2026-12');
  // حجم واقعي: 3000 صف مفتوح على كشف الديسمبر و5 بس على كشف نوفمبر، عشان المخطط يميّز
  // بالانتقائية مش بالتجربة، زي ما بيذاكر الاختبارات التانية (ANALYZE وإعدادات المخطط الافتراضية).
  await owner`
    INSERT INTO commission_blocked_corrections(
      company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
      target_statement_id,created_at)
    SELECT ${A.company}, ('01980000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
      ${A.business}, ${A.employee},
      to_char(make_date(1000 + (n / 12), 1 + (n % 12), 1), 'YYYY-MM'),
      'NO_PLAN', ('01980001-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
      '2026-12', ${decemberId}, '2026-11-01T08:00:00Z'
    FROM generate_series(1,3000) AS n`;
  for (const month of ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05']) {
    await insertBlock(novemberId, { sourcePeriod: month });
  }
  await owner`ANALYZE commission_blocked_corrections`;
  const plan = await db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1 FROM commission_blocked_corrections
        WHERE company_id = app_company_id() AND target_statement_id = ${novemberId}
        AND resolved_at IS NULL LIMIT 1`,
    ),
  );
  const text = JSON.stringify(plan);
  expect(text).toContain('commission_blocked_corrections_target_statement_open_idx');
  expect(text).not.toContain('Seq Scan');
});

it('C10: a repair version starts exactly at the first day of its repair month', async () => {
  const insertVersion = (row: Record<string, unknown>) =>
    db.withTenant(A.company, (tx) => insertCommissionPlanVersion(tx, A, ids, row));
  await expectPgError(
    insertVersion({ effectiveFrom: '2026-09-15', repairPeriod: '2026-09' }),
    '23514',
    'commission_plan_versions_repair_matches_effective_from',
  );
  await insertVersion({ effectiveFrom: '2026-09-01', repairPeriod: '2026-09' });
  await expectPgError(
    insertVersion({ effectiveFrom: '2026-09-01', repairPeriod: '2026-09', wholePeriod: true }),
    '23514',
    'commission_plan_versions_whole_or_repair',
  );
});

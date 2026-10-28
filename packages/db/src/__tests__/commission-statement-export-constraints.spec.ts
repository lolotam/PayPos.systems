import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createDatabase,
  lockStatementPeriods,
  type Database,
  type StatementStatus,
  type Tx,
} from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  insertStatementExport,
  OTHER_COMMISSION_IDS,
  SECOND_REVIEWER,
  seedCommissionStatementTenants,
  walkCommissionStatement,
  type CommissionTenant,
  type StatementExportOverrides,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;

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

let periods = 0;
// كل حالة اختبار بتاخد شهر جديد: الشهر المجمّد بيتقفل بعد أول استخدام، والصفوف بتتصادمش.
const nextPeriod = (): string => {
  periods += 1;
  const year = 2027 + Math.floor(periods / 12);
  const month = (periods % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const approved = async (
  tenant: CommissionTenant = A,
  to: Exclude<StatementStatus, 'DRAFT'> = 'APPROVED',
): Promise<{ period: string; statementId: string }> => {
  const period = nextPeriod();
  const statementId = await walkCommissionStatement(db, { tenant, period, ids, to });
  return { period, statementId };
};

const insertExport = (
  tenant: CommissionTenant,
  statementId: string,
  period: string,
  overrides: StatementExportOverrides = {},
): Promise<string> =>
  db.withTenant(tenant.company, (tx) =>
    insertStatementExport(tx, { tenant, statementId, period, ids }, overrides),
  );

it('the scope, the language and the month are checked by the table', async () => {
  const { period, statementId } = await approved();
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'ALL' }),
    '23514',
    'commission_statement_exports_scope',
  );
  await expectPgError(
    insertExport(A, statementId, period, { language: 'fr' }),
    '23514',
    'commission_statement_exports_language',
  );
  await expectPgError(
    insertExport(A, statementId, '2026-13'),
    '23514',
    'commission_statement_exports_period',
  );
});

it('the scope decides whether the request carries the branch and the employee arrays', async () => {
  const { period, statementId } = await approved();
  const arrays = 'commission_statement_exports_scope_arrays';
  // BRANCHES من غير مصفوفات.
  await expectPgError(insertExport(A, statementId, period, { scope: 'BRANCHES' }), '23514', arrays);
  // BRANCHES بمصفوفة واحدة بس.
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BRANCHES', branchIds: [A.branch] }),
    '23514',
    arrays,
  );
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BRANCHES', employeeIds: [A.employee] }),
    '23514',
    arrays,
  );
  // BUSINESS بمصفوفات.
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BUSINESS', branchIds: [A.branch] }),
    '23514',
    arrays,
  );
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BUSINESS', employeeIds: [A.employee] }),
    '23514',
    arrays,
  );
  await expectPgError(
    insertExport(A, statementId, period, {
      scope: 'BUSINESS',
      branchIds: [A.branch],
      employeeIds: [A.employee],
    }),
    '23514',
    arrays,
  );
  // فرع من غير فروع: المصفوفة الفاضية مش اختيار صالح.
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BRANCHES', branchIds: [], employeeIds: [] }),
    '23514',
    arrays,
  );
});

it('BRANCHES with an empty employee list is a valid request', async () => {
  const { period, statementId } = await approved();
  const exportId = await insertExport(A, statementId, period, {
    scope: 'BRANCHES',
    branchIds: [A.branch],
    employeeIds: [],
  });
  expect(
    await asA(sql`SELECT id FROM commission_statement_exports WHERE id=${exportId}`),
  ).toHaveLength(1);
});

it('an array may not carry a null element', async () => {
  const { period, statementId } = await approved();
  await expectPgError(
    insertExport(A, statementId, period, { scope: 'BRANCHES', branchIds: [null], employeeIds: [] }),
    '23514',
    'commission_statement_exports_branch_ids_elements',
  );
  await expectPgError(
    insertExport(A, statementId, period, {
      scope: 'BRANCHES',
      branchIds: [A.branch],
      employeeIds: [null],
    }),
    '23514',
    'commission_statement_exports_employee_ids_elements',
  );
});

it('the request points at the statement of the same month and the same business', async () => {
  const { period, statementId } = await approved();
  // شهر غير شهر الكشف: المفتاح المركّب هو اللي بيرفض.
  await expectPgError(
    insertExport(A, statementId, '2026-11'),
    '23503',
    'commission_statement_exports_statement_fk',
  );
  // كشف نشاط تاني في نفس الشركة.
  const otherPeriod = nextPeriod();
  const otherStatementId = await walkCommissionStatement(db, {
    tenant: { ...A, business: OTHER_COMMISSION_IDS.business },
    period: otherPeriod,
    ids,
  });
  await expectPgError(
    insertExport(A, otherStatementId, otherPeriod),
    '23503',
    'commission_statement_exports_statement_fk',
  );
  // عضوية مستخدم تاني: الطلب لازم يكون من العضو نفسه.
  await expectPgError(
    insertExport(A, statementId, period, { requestedMembershipId: SECOND_REVIEWER.membership }),
    '23503',
    'commission_statement_exports_membership_fk',
  );
});

it('a request may not point at another tenant statement or membership', async () => {
  const { period: aPeriod, statementId: aStatementId } = await approved(A);
  // كشف شركة تانية: تريغر الإدراج مش شايفه من جلسة الشركة المحلية.
  await expectPgError(
    insertExport(B, aStatementId, aPeriod),
    '23503',
    'commission_statement_exports_statement_fk',
  );
  // عضوية شركة تانية: المفتاح المركّب للعضوية بيرفض.
  const { period: bPeriod, statementId: bStatementId } = await approved(B);
  await expectPgError(
    insertExport(B, bStatementId, bPeriod, { requestedMembershipId: A.membership }),
    '23503',
    'commission_statement_exports_membership_fk',
  );
});

it('the insert guard takes an approved or a paid statement only', async () => {
  const draftPeriod = nextPeriod();
  const [draft] = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: [draftPeriod], ids }),
  );
  if (draft === undefined) throw new Error('the draft statement is missing after its lock');
  await expectPgError(
    insertExport(A, draft.statementId, draftPeriod),
    '23514',
    'commission_statement_exports_insert_guard',
  );
  const reviewed = await approved(A, 'REVIEWED');
  await expectPgError(
    insertExport(A, reviewed.statementId, reviewed.period),
    '23514',
    'commission_statement_exports_insert_guard',
  );
  const approvedStatement = await approved(A, 'APPROVED');
  expect(
    await insertExport(A, approvedStatement.statementId, approvedStatement.period),
  ).toBeTruthy();
  const paid = await approved(A, 'PAID');
  expect(await insertExport(A, paid.statementId, paid.period)).toBeTruthy();
});

it('the render id is unique inside the company and free across companies', async () => {
  const { period, statementId } = await approved();
  const renderId = ids.newId();
  await insertExport(A, statementId, period, { renderId });
  await expectPgError(
    insertExport(A, statementId, period, { renderId }),
    '23505',
    'commission_statement_exports_render_key',
  );
  const other = await approved(B);
  expect(await insertExport(B, other.statementId, other.period, { renderId })).toBeTruthy();
});

it('the request is collected once and only the collection time moves', async () => {
  const { period, statementId } = await approved();
  await expectPgError(
    insertExport(A, statementId, period, { collectedAt: '2026-11-02T08:00:00Z' }),
    '23514',
    'commission_statement_exports_not_collected',
  );
  const exportId = await insertExport(A, statementId, period);
  await asA(
    sql`UPDATE commission_statement_exports SET collected_at='2026-11-02T08:00:00Z'
      WHERE company_id=${A.company} AND id=${exportId}`,
  );
  await expectPgError(
    asA(
      sql`UPDATE commission_statement_exports SET collected_at='2026-11-03T08:00:00Z'
        WHERE company_id=${A.company} AND id=${exportId}`,
    ),
    '23514',
    'commission_statement_exports_collect_once',
  );
  await expectPgError(
    asA(
      sql`UPDATE commission_statement_exports SET collected_at=NULL
        WHERE company_id=${A.company} AND id=${exportId}`,
    ),
    '23514',
    'commission_statement_exports_collect_once',
  );
  // أي عمود تاني مرفوض بالصلاحية: التحديث المسموح على collected_at بس.
  await expectPgError(
    asA(
      sql`UPDATE commission_statement_exports SET scope='BRANCHES'
        WHERE company_id=${A.company} AND id=${exportId}`,
    ),
    '42501',
  );
});

it('the owner may not change any column but the collection time either', async () => {
  const { period, statementId } = await approved();
  const exportId = await insertExport(A, statementId, period);
  // دور المالك بيعمل التحديث من غير صلاحية الأعمدة، فالحارس هو اللي بيمنع تغيير أي عمود تاني.
  await expectPgError(
    owner`UPDATE commission_statement_exports SET language='en'
      WHERE company_id=${A.company} AND id=${exportId}`,
    '23514',
    'commission_statement_exports_immutable',
  );
  expect(
    await asA(sql`SELECT language FROM commission_statement_exports WHERE id=${exportId}`),
  ).toEqual([{ language: 'ar' }]);
});

// pg_backend_pid بتاع المعاملة؛ عشان الاختبار يثبت إن التانية مستنية قفل الأولى فعلاً.
const backendPid = async (tx: Tx) => {
  const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  return Number(row?.pid);
};

const waitUntilBlocked = async (waiter: () => number | undefined, holder: number) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const pid = waiter();
    if (pid !== undefined) {
      const [row] = await owner<{ blocked: boolean }[]>`
        SELECT ${holder} = ANY(pg_blocking_pids(${pid})) AS blocked`;
      if (row?.blocked === true) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second collector never waited on the first one');
};

it('two collectors of the same row: the one that waited on the lock is refused', async () => {
  const { period, statementId } = await approved();
  const exportId = await insertExport(A, statementId, period);
  const collect = (at: string) =>
    sql`UPDATE commission_statement_exports SET collected_at=${at}
      WHERE company_id=${A.company} AND id=${exportId}`;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holderPid = 0;
  let firstWrote: () => void = () => undefined;
  const wrote = new Promise<void>((resolve) => {
    firstWrote = resolve;
  });
  const first = db.withTenant(A.company, async (tx) => {
    holderPid = await backendPid(tx);
    await tx.execute(collect('2026-11-02T08:00:00Z'));
    firstWrote();
    await gate;
  });
  await wrote;
  let waiterPid: number | undefined;
  const second = db.withTenant(A.company, async (tx) => {
    waiterPid = await backendPid(tx);
    await tx.execute(collect('2026-11-02T08:00:01Z'));
  });
  const refusal = expectPgError(second, '23514', 'commission_statement_exports_collect_once');
  await waitUntilBlocked(() => waiterPid, holderPid);
  release();
  await first;
  await refusal;
  const [row] = await owner<{ collected_at: Date }[]>`
    SELECT collected_at FROM commission_statement_exports WHERE id=${exportId}`;
  expect(row?.collected_at.toISOString()).toBe('2026-11-02T08:00:00.000Z');
});

import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database, type Tx } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  FINGERPRINTS,
  insertCommissionAttachment,
  insertCommissionLine,
  OTHER_COMMISSION_IDS,
  refusalCode,
  seedCommissionStatementTenants,
  walkCommissionStatement,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;
let periods = 0;

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

// كل حالة شهور جديدة، عشان القيد الفريد على (الشركة، النشاط، الشهر) ما يقفش قدام حالة تانية.
const nextPeriod = (): string => {
  periods += 1;
  const year = 2027 + Math.floor(periods / 12);
  const month = (periods % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

// الصفوف المجمّدة ما بتتقبلش إلا في معاملة الاعتماد نفسها، فكل حالة بتاخد شهرها وتعمله.
const withApproved = (
  work: (tx: Tx, statementId: string, period: string) => Promise<void>,
  period = nextPeriod(),
): Promise<string> =>
  walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    afterApproved: async (tx, statementId) => work(tx, statementId, period),
  });

// لقطة الارتباط مقصوصة على شهر الكشف، فمداها لازم يبقى جوه الشهر نفسه.
const monthRange = (period: string) => {
  const [year, month] = period.split('-');
  const last = new Date(Number(year), Number(month), 0).getDate();
  return { attachedFrom: `${period}-01`, attachedTo: `${period}-${String(last).padStart(2, '0')}` };
};

it('a statement of a business of another company is refused', async () => {
  await expectPgError(
    asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES(${A.company},${ids.newId()},${B.business},${nextPeriod()},'DRAFT')`),
    '23503',
    'commission_statements_business_fk',
  );
});

it('a statement reviewed by a membership of another company is refused', async () => {
  const period = nextPeriod();
  await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids }),
  );
  await expectPgError(
    asA(sql`UPDATE commission_statements SET status='REVIEWED', reviewed_fingerprint=${FINGERPRINTS.reviewed},
      reviewed_statement_fingerprint=${FINGERPRINTS.statement}, reviewed_by=${USER},
      reviewed_membership_id=${B.membership}, reviewed_at=now()
      WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`),
    '23503',
    'commission_statements_reviewed_membership_fk',
  );
});

it('a frozen line of an employee of another business is refused', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { employeeId: OTHER_COMMISSION_IDS.employee }),
    ),
    '23503',
    'commission_statement_lines_employee_fk',
  );
});

it('a frozen line of a branch of another business is refused', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, {
        kind: 'COMMISSION',
        sourceBranchId: OTHER_COMMISSION_IDS.branch,
      }),
    ),
    '23503',
    'commission_statement_lines_source_branch_fk',
  );
});

it('a frozen attachment of an employee or a branch of another business is refused', async () => {
  await expectPgError(
    withApproved((tx, statementId, period) =>
      insertCommissionAttachment(tx, A, statementId, ids, {
        ...monthRange(period),
        employeeId: OTHER_COMMISSION_IDS.employee,
      }),
    ),
    '23503',
    'commission_statement_attachments_employee_fk',
  );
  await expectPgError(
    withApproved((tx, statementId, period) =>
      insertCommissionAttachment(tx, A, statementId, ids, {
        ...monthRange(period),
        branchId: OTHER_COMMISSION_IDS.branch,
      }),
    ),
    '23503',
    'commission_statement_attachments_branch_fk',
  );
});

it('a frozen row without its statement is refused', async () => {
  const missing = ids.newId();
  expect(['23503', '23514']).toContain(
    await refusalCode(withApproved((tx) => insertCommissionLine(tx, A, missing, ids))),
  );
  expect(await asA(sql`SELECT id FROM commission_statement_lines`)).toEqual([]);
});

it('the checks refuse a malformed period, a fingerprint that is not hex and a negative revision', async () => {
  await expectPgError(
    asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES(${A.company},${ids.newId()},${A.business},'2026-13','DRAFT')`),
    '23514',
    'commission_statements_period',
  );
  await expectPgError(
    asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status,current_fingerprint)
      VALUES(${A.company},${ids.newId()},${A.business},${nextPeriod()},'DRAFT','not-a-fingerprint')`),
    '23514',
    'commission_statements_fingerprints',
  );
  await expectPgError(
    asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status,revision)
      VALUES(${A.company},${ids.newId()},${A.business},${nextPeriod()},'DRAFT',-1)`),
    '23514',
    'commission_statements_revision',
  );
});

it('the stage check refuses a draft that still carries a review', async () => {
  await expectPgError(
    asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status,reviewed_fingerprint)
      VALUES(${A.company},${ids.newId()},${A.business},${nextPeriod()},'DRAFT',${FINGERPRINTS.reviewed})`),
    '23514',
    'commission_statements_stage',
  );
});

it('the line checks refuse an unknown kind and a correction without its two amounts', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'BONUS' }),
    ),
    '23514',
    'commission_statement_lines_kind',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'CORRECTION', previousAmount: null }),
    ),
    '23514',
    'commission_statement_lines_correction_amounts',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'CORRECTION', amount: '1.000' }),
    ),
    '23514',
    'commission_statement_lines_correction_amounts',
  );
});

it('the line checks refuse a source row without its branch, a carry with branches and an employee row with money', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'COMMISSION', sourceBranchId: null }),
    ),
    '23514',
    'commission_statement_lines_source_fields',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, {
        kind: 'CARRY_COMMISSION',
        attachedBranchIds: [A.branch],
      }),
    ),
    '23514',
    'commission_statement_lines_carry_branches',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'EMPLOYEE', amount: '1.000' }),
    ),
    '23514',
    'commission_statement_lines_employee_amount',
  );
});

it('the line checks refuse a detail on a row that has none and a commission row without its visit', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, {
        kind: 'TIP_CARD',
        lineId: OTHER_COMMISSION_IDS.line,
      }),
    ),
    '23514',
    'commission_statement_lines_detail',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'COMMISSION', lineId: null }),
    ),
    '23514',
    'commission_statement_lines_commission_detail',
  );
});

it('the line checks refuse an amount that is not a number', async () => {
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, { kind: 'COMMISSION', amount: 'NaN' }),
    ),
    '23514',
    'commission_statement_lines_amounts',
  );
});

// صيغة شهر المصدر بتتأكد على نوع بيلزمه شهر مصدر؛ الأنواع التانية بترفض أي شهر، فالفرق بين
// الشهر الغلط والسنة الغلط بيضيع لو اتأكد على نوع مش محتاج شهر.
it('the source period format is proved on a kind that carries one', async () => {
  const accepted = await withApproved((tx, statementId) =>
    insertCommissionLine(tx, A, statementId, ids, { kind: 'CORRECTION', sourcePeriod: '2026-12' }),
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_lines WHERE statement_id=${accepted}`),
  ).toHaveLength(1);
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, {
        kind: 'CORRECTION',
        sourcePeriod: '2026-13',
      }),
    ),
    '23514',
    'commission_statement_lines_source_period',
  );
  await expectPgError(
    withApproved((tx, statementId) =>
      insertCommissionLine(tx, A, statementId, ids, {
        kind: 'CORRECTION',
        sourcePeriod: '0000-05',
      }),
    ),
    '23514',
    'commission_statement_lines_source_period',
  );
});

// شهر المصدر مطلوب في التصحيحات والcarry بس، وباقي الأنواع ما ليهاش شهر مصدر.
const SOURCE_PERIOD_CASES = [
  { kind: 'CORRECTION', sourcePeriod: null },
  { kind: 'CARRY_COMMISSION', sourcePeriod: null },
  { kind: 'COMMISSION', sourcePeriod: '2026-09' },
  { kind: 'SALE', sourcePeriod: '2026-09' },
  { kind: 'EMPLOYEE', sourcePeriod: '2026-09' },
];

it.each(SOURCE_PERIOD_CASES)(
  'the source period of a $kind row is refused',
  async ({ kind, sourcePeriod }) => {
    await expectPgError(
      withApproved((tx, statementId) =>
        insertCommissionLine(tx, A, statementId, ids, { kind, sourcePeriod }),
      ),
      '23514',
      'commission_statement_lines_source_period',
    );
  },
);

it('the year zero is refused by the statement period', async () => {
  await expectPgError(
    owner`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES(${A.company},${ids.newId()},${A.business},'0000-05','DRAFT')`,
    '23514',
    'commission_statements_period',
  );
});

it('the attachment check refuses a range that ends before it starts', async () => {
  await expectPgError(
    withApproved((tx, statementId, period) =>
      insertCommissionAttachment(tx, A, statementId, ids, {
        attachedFrom: `${period}-20`,
        attachedTo: `${period}-10`,
      }),
    ),
    '23514',
    'commission_statement_attachments_range',
  );
});

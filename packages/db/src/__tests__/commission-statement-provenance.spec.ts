import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  FINGERPRINTS,
  insertCommissionLine,
  SECOND_REVIEWER,
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
const { A } = COMMISSION_TENANT;
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

// شهر بالرقم: من شهر الكشف بنزح شهور، عشان نختبر الشهر المساوي واللي بعده واللي قبله.
const shiftMonth = (period: string, offset: number): string => {
  const [year, month] = period.split('-');
  const shifted = new Date(Number(year), Number(month) - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
};

it('the reviewer and the membership have to be the same person', async () => {
  const period = nextPeriod();
  await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids }),
  );
  await expectPgError(
    asA(sql`UPDATE commission_statements SET status='REVIEWED',
      reviewed_fingerprint=${FINGERPRINTS.reviewed}, reviewed_statement_fingerprint=${FINGERPRINTS.statement},
      reviewed_by=${USER}, reviewed_membership_id=${SECOND_REVIEWER.membership}, reviewed_at=now()
      WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`),
    '23503',
    'commission_statements_reviewed_membership_fk',
  );
  expect(await asA(sql`SELECT status FROM commission_statements WHERE period=${period}`)).toEqual([
    { status: 'DRAFT' },
  ]);
});

it('the reviewer and the membership of the same person are accepted', async () => {
  const period = nextPeriod();
  await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  expect(await asA(sql`SELECT status FROM commission_statements WHERE period=${period}`)).toEqual([
    { status: 'REVIEWED' },
  ]);
});

// الأنواع الخمسة اللي لازم تحمل شهر المصدر: التصحيحات التلاتة والـ carry اتنين.
const SOURCE_PERIOD_KINDS = [
  'CORRECTION',
  'CORRECTION_TIP_CARD',
  'CORRECTION_TIP_CASH',
  'CARRY_COMMISSION',
  'CARRY_TIP_CARD',
];

// شهر المصدر لازم يكون قبل شهر الكشف بس: المساوي أو اللي بعده مرفوض، واللي قبله مقبول.
// الحالات المرفوضة هي كل نوع في كل علاقة: مساوي أو بعده.
const SOURCE_MONTH_REFUSALS = SOURCE_PERIOD_KINDS.flatMap((kind) =>
  ['equal', 'later'].map((relation) => ({ kind, relation })),
);

it.each(SOURCE_MONTH_REFUSALS)(
  'a $kind line whose source month is $relation to the statement month is refused',
  async ({ kind, relation }) => {
    const period = nextPeriod();
    const sourcePeriod = relation === 'equal' ? period : shiftMonth(period, 1);
    await expectPgError(
      walkCommissionStatement(db, {
        tenant: A,
        period,
        ids,
        afterApproved: async (tx, id) =>
          insertCommissionLine(tx, A, id, ids, { kind, sourcePeriod }),
      }),
      '23514',
      'commission_statement_lines_source_before_statement',
    );
  },
);

it.each(SOURCE_PERIOD_KINDS)(
  'a %s line from an earlier month is frozen with its statement',
  async (kind) => {
    const period = nextPeriod();
    const statementId = await walkCommissionStatement(db, {
      tenant: A,
      period,
      ids,
      afterApproved: async (tx, id) =>
        insertCommissionLine(tx, A, id, ids, { kind, sourcePeriod: shiftMonth(period, -1) }),
    });
    expect(
      await asA(sql`SELECT id FROM commission_statement_lines WHERE statement_id=${statementId}`),
    ).toHaveLength(1);
  },
);

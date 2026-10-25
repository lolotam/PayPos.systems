import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  FINGERPRINTS,
  insertCommissionAttachment,
  insertCommissionLine,
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

// قفل شهر واحد وإرجاع معرّف كشفه؛ الصفوف المجمّدة بتتبنى على معرّف الكشف ده.
const lockOne = async (period: string): Promise<string> => {
  const [row] = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids }),
  );
  if (row === undefined)
    throw new Error(`the statement row of ${period} is missing after its lock`);
  return row.statementId;
};

// كل حالة شهور جديدة، عشان القيد الفريد على (الشركة، النشاط، الشهر) ما يقفش قدام حالة تانية.
const nextPeriod = (): string => {
  periods += 1;
  const year = 2027 + Math.floor(periods / 12);
  const month = (periods % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

// حدود شهر الكشف: أول يوم وآخر يوم، واليوم اللي قبل الأول واللي بعد الأخير — دول اللي تريغر الشهر يرفضهم.
const monthBounds = (period: string) => {
  const [year, month] = period.split('-');
  const first = new Date(Number(year), Number(month) - 1, 1);
  const last = new Date(Number(year), Number(month), 0);
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    first: day(first),
    last: day(last),
    beforeFirst: day(new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1)),
    afterLast: day(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)),
  };
};

// لقطة الارتباط مقصوصة على شهر الكشف، فمداها لازم يبقى جوه الشهر نفسه.
const monthRange = (period: string) => {
  const bounds = monthBounds(period);
  return { attachedFrom: bounds.first, attachedTo: bounds.last };
};

const lineInsert = (statementId: string, sourceRef: string) =>
  sql`INSERT INTO commission_statement_lines(company_id,id,business_id,statement_id,employee_id,
    employee_number,employee_name_en,source_ref,kind,amount)
    VALUES(${A.company},${ids.newId()},${A.business},${statementId},${A.employee},1,'Frozen employee',
      ${sourceRef},'EMPLOYEE','0.000')`;

it('the freeze takes the rows of the approving transaction', async () => {
  const period = nextPeriod();
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    afterApproved: async (tx, id) => {
      await insertCommissionLine(tx, A, id, ids);
      await insertCommissionAttachment(tx, A, id, ids, monthRange(period));
    },
  });
  expect(
    await asA(
      sql`SELECT source_ref FROM commission_statement_lines WHERE statement_id=${statementId}`,
    ),
  ).toHaveLength(1);
  expect(
    await asA(
      sql`SELECT attached_from FROM commission_statement_attachments WHERE statement_id=${statementId}`,
    ),
  ).toHaveLength(1);
});

it('a savepoint does not change the proof of the approval', async () => {
  const period = nextPeriod();
  const statementId = await walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    afterApproved: async (tx, id) => {
      await tx.execute(sql`SAVEPOINT frozen_probe`);
      await insertCommissionLine(tx, A, id, ids, { sourceRef: 'probe:rolled-back' });
      await tx.execute(sql`ROLLBACK TO SAVEPOINT frozen_probe`);
      await insertCommissionLine(tx, A, id, ids, { sourceRef: 'probe:kept' });
    },
  });
  expect(
    await asA(
      sql`SELECT source_ref FROM commission_statement_lines WHERE statement_id=${statementId}`,
    ),
  ).toEqual([{ source_ref: 'probe:kept' }]);
});

it('a later transaction cannot freeze into an approved month', async () => {
  const period = nextPeriod();
  const statementId = await walkCommissionStatement(db, { tenant: A, period, ids });
  await expectPgError(asA(lineInsert(statementId, 'probe:later')), '23514');
  expect(
    await asA(sql`SELECT id FROM commission_statement_lines WHERE source_ref='probe:later'`),
  ).toEqual([]);
});

it('a month that is not approved refuses the frozen rows', async () => {
  const draftPeriod = nextPeriod();
  const draftId = await lockOne(draftPeriod);
  await expectPgError(asA(lineInsert(draftId, 'probe:draft')), '23514');
  const reviewedPeriod = nextPeriod();
  const reviewedId = await walkCommissionStatement(db, {
    tenant: A,
    period: reviewedPeriod,
    ids,
    to: 'REVIEWED',
  });
  await expectPgError(asA(lineInsert(reviewedId, 'probe:reviewed')), '23514');
  expect(
    await asA(sql`SELECT id FROM commission_statement_lines
      WHERE source_ref IN ('probe:draft','probe:reviewed')`),
  ).toEqual([]);
});

it('a frozen row without its statement is refused', async () => {
  const period = nextPeriod();
  await walkCommissionStatement(db, { tenant: A, period, ids });
  expect(['23503', '23514']).toContain(
    await refusalCode(asA(lineInsert(ids.newId(), 'probe:missing'))),
  );
  expect(
    await asA(sql`SELECT id FROM commission_statement_lines WHERE source_ref='probe:missing'`),
  ).toEqual([]);
});

it('an attachment outside the month of its statement is refused', async () => {
  // الرفض بيوقّف معاملة الاعتماد، فكل حالة مرفوضة ليها شهر لوحدها؛ والإدراج جوّه معاملة الاعتماد
  // عشان تريغر الشهر هو اللي يرفض، مش تريغر دليل الاعتماد.
  const beforePeriod = nextPeriod();
  await expectPgError(
    walkCommissionStatement(db, {
      tenant: A,
      period: beforePeriod,
      ids,
      afterApproved: async (tx, id) =>
        insertCommissionAttachment(tx, A, id, ids, {
          ...monthRange(beforePeriod),
          attachedFrom: monthBounds(beforePeriod).beforeFirst,
        }),
    }),
    '23514',
    'commission_statement_attachments_in_month',
  );
  const afterPeriod = nextPeriod();
  await expectPgError(
    walkCommissionStatement(db, {
      tenant: A,
      period: afterPeriod,
      ids,
      afterApproved: async (tx, id) =>
        insertCommissionAttachment(tx, A, id, ids, {
          ...monthRange(afterPeriod),
          attachedTo: monthBounds(afterPeriod).afterLast,
        }),
    }),
    '23514',
    'commission_statement_attachments_in_month',
  );
  expect(await asA(sql`SELECT id FROM commission_statements WHERE period=${beforePeriod}`)).toEqual(
    [],
  );
  expect(await asA(sql`SELECT id FROM commission_statements WHERE period=${afterPeriod}`)).toEqual(
    [],
  );
});

it('an attachment on the exact edges of the month of its statement is accepted', async () => {
  // القيد الفريد على (الكشف، الموظف، الفرع، بداية المدى) بيمنع مدين بنفس البداية في نفس الكشف،
  // فحالة "يوم واحد في أول الشهر" ليها شهر لوحدها.
  const fullPeriod = nextPeriod();
  const fullBounds = monthBounds(fullPeriod);
  const fullStatement = await walkCommissionStatement(db, {
    tenant: A,
    period: fullPeriod,
    ids,
    afterApproved: async (tx, id) => {
      await insertCommissionAttachment(tx, A, id, ids, monthRange(fullPeriod));
      await insertCommissionAttachment(tx, A, id, ids, {
        attachedFrom: fullBounds.last,
        attachedTo: fullBounds.last,
      });
    },
  });
  expect(
    await asA(sql`SELECT count(*)::int AS total FROM commission_statement_attachments
      WHERE statement_id=${fullStatement}`),
  ).toEqual([{ total: 2 }]);
  const firstPeriod = nextPeriod();
  const firstBounds = monthBounds(firstPeriod);
  const firstStatement = await walkCommissionStatement(db, {
    tenant: A,
    period: firstPeriod,
    ids,
    afterApproved: async (tx, id) =>
      insertCommissionAttachment(tx, A, id, ids, {
        attachedFrom: firstBounds.first,
        attachedTo: firstBounds.first,
      }),
  });
  expect(
    await asA(sql`SELECT count(*)::int AS total FROM commission_statement_attachments
      WHERE statement_id=${firstStatement}`),
  ).toEqual([{ total: 1 }]);
});

it('the FR-044 seed freezes a closed period the way the guard accepts', async () => {
  const period = nextPeriod();
  const seeded = await db.withTenant(A.company, async (tx) => {
    const [statement] = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: [period],
      ids,
    });
    if (statement === undefined) throw new Error('the statement row is missing after its lock');
    const id = statement.statementId;
    await tx.execute(sql`UPDATE commission_statements SET status='REVIEWED',
      reviewed_fingerprint=${FINGERPRINTS.reviewed}, reviewed_statement_fingerprint=${FINGERPRINTS.statement},
      reviewed_by=${USER}, reviewed_membership_id=${A.membership}, reviewed_at=now() WHERE id=${id}`);
    await tx.execute(sql`UPDATE commission_statements SET status='APPROVED', approved_by=${USER},
      approved_at=now(), input_fingerprint=${FINGERPRINTS.input},
      statement_fingerprint=${FINGERPRINTS.statement} WHERE id=${id}`);
    await insertCommissionLine(tx, A, id, ids);
    await insertCommissionAttachment(tx, A, id, ids, monthRange(period));
    const [row] =
      await tx.execute(sql`SELECT id::text AS id, status, approval_xact_id::text AS proof,
      pg_current_xact_id()::text AS xact FROM commission_statements WHERE id=${id}`);
    return { id: row?.['id'], status: row?.['status'], proof: row?.['proof'], xact: row?.['xact'] };
  });
  expect(seeded.status).toBe('APPROVED');
  expect(seeded.proof).toBe(seeded.xact);
  expect(
    await asA(sql`SELECT count(*)::int AS total FROM commission_statement_lines
      WHERE statement_id=${seeded.id}`),
  ).toEqual([{ total: 1 }]);
  expect(
    await asA(sql`SELECT count(*)::int AS total FROM commission_statement_attachments
      WHERE statement_id=${seeded.id}`),
  ).toEqual([{ total: 1 }]);
});

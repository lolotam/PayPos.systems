import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  FINGERPRINTS,
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

// أعمدة الحالة الهدف؛ تريغر التحديث بيقارنها بالحالة القديمة، فالتغيير المسموح بس هو ده.
const setClause = (to: string) => {
  switch (to) {
    case 'REVIEWED':
      return sql`status='REVIEWED', reviewed_fingerprint=${FINGERPRINTS.reviewed},
        reviewed_statement_fingerprint=${FINGERPRINTS.statement}, reviewed_by=${USER},
        reviewed_membership_id=${A.membership}, reviewed_at=now()`;
    case 'APPROVED':
      return sql`status='APPROVED', approved_by=${USER}, approved_at=now(),
        input_fingerprint=${FINGERPRINTS.input}, statement_fingerprint=${FINGERPRINTS.statement}`;
    case 'PAID':
      return sql`status='PAID'`;
    default:
      return sql`status='DRAFT', reviewed_fingerprint=NULL, reviewed_statement_fingerprint=NULL,
        reviewed_by=NULL, reviewed_membership_id=NULL, reviewed_at=NULL`;
  }
};

const prepare = async (period: string, state: string): Promise<void> => {
  if (state === 'DRAFT') {
    await db.withTenant(A.company, (tx) =>
      lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids }),
    );
    return;
  }
  await walkCommissionStatement(db, {
    tenant: A,
    period,
    ids,
    to: state as 'REVIEWED' | 'APPROVED' | 'PAID',
  });
};

const transition = async (period: string, to: string): Promise<boolean> => {
  const work = db.withTenant(A.company, (tx) =>
    tx.execute(sql`UPDATE commission_statements SET ${setClause(to)}
      WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`),
  );
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error === null;
};

it('a statement is inserted DRAFT only', async () => {
  const id = ids.newId();
  await asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
    VALUES(${A.company},${id},${A.business},${nextPeriod()},'DRAFT')`);
  expect(await asA(sql`SELECT status FROM commission_statements WHERE id=${id}`)).toEqual([
    { status: 'DRAFT' },
  ]);
  for (const status of ['REVIEWED', 'APPROVED', 'PAID']) {
    await expectPgError(
      asA(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
        VALUES(${A.company},${ids.newId()},${A.business},${nextPeriod()},${status})`),
      '23514',
    );
  }
  expect(await asA(sql`SELECT status FROM commission_statements WHERE status <> 'DRAFT'`)).toEqual(
    [],
  );
});

const TRANSITIONS = [
  { from: 'DRAFT', to: 'REVIEWED', allowed: true },
  { from: 'DRAFT', to: 'APPROVED', allowed: false },
  { from: 'DRAFT', to: 'PAID', allowed: false },
  { from: 'REVIEWED', to: 'APPROVED', allowed: true },
  { from: 'REVIEWED', to: 'DRAFT', allowed: true },
  { from: 'REVIEWED', to: 'PAID', allowed: false },
  { from: 'APPROVED', to: 'PAID', allowed: true },
  { from: 'APPROVED', to: 'REVIEWED', allowed: false },
  { from: 'APPROVED', to: 'DRAFT', allowed: false },
  { from: 'PAID', to: 'DRAFT', allowed: false },
  { from: 'PAID', to: 'REVIEWED', allowed: false },
  { from: 'PAID', to: 'APPROVED', allowed: false },
  { from: 'PAID', to: 'PAID', allowed: false },
] as const;

it.each(TRANSITIONS)('from $from to $to is $allowed', async ({ from, to, allowed }) => {
  const period = nextPeriod();
  await prepare(period, from);
  expect(await transition(period, to)).toBe(allowed);
  const rows = await asA(sql`SELECT status FROM commission_statements WHERE period=${period}`);
  expect(rows[0]?.['status']).toBe(allowed ? to : from);
});

it('a change that is not a transition touches an open month only', async () => {
  const draftPeriod = nextPeriod();
  await prepare(draftPeriod, 'DRAFT');
  await asA(sql`UPDATE commission_statements SET current_fingerprint=${FINGERPRINTS.current}
    WHERE company_id=${A.company} AND business_id=${A.business} AND period=${draftPeriod}`);
  expect(
    await asA(
      sql`SELECT current_fingerprint FROM commission_statements WHERE period=${draftPeriod}`,
    ),
  ).toEqual([{ current_fingerprint: FINGERPRINTS.current }]);
  const approvedPeriod = nextPeriod();
  const approvedId = await walkCommissionStatement(db, { tenant: A, period: approvedPeriod, ids });
  await expectPgError(
    asA(sql`UPDATE commission_statements SET current_fingerprint=${FINGERPRINTS.current}
      WHERE company_id=${A.company} AND id=${approvedId}`),
    '23514',
  );
  const paidPeriod = nextPeriod();
  const paidId = await walkCommissionStatement(db, {
    tenant: A,
    period: paidPeriod,
    ids,
    to: 'PAID',
  });
  await expectPgError(
    asA(sql`UPDATE commission_statements SET current_fingerprint=${FINGERPRINTS.current}
      WHERE company_id=${A.company} AND id=${paidId}`),
    '23514',
  );
});

it('the approval proof is the approving transaction and only that one', async () => {
  const period = nextPeriod();
  const proof = await db.withTenant(A.company, async (tx) => {
    const [statement] = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: [period],
      ids,
    });
    if (statement === undefined) throw new Error('the statement row is missing after its lock');
    const id = statement.statementId;
    const [draft] = await tx.execute(
      sql`SELECT approval_xact_id::text AS proof FROM commission_statements WHERE id=${id}`,
    );
    await tx.execute(sql`UPDATE commission_statements SET ${setClause('REVIEWED')} WHERE id=${id}`);
    const [reviewed] = await tx.execute(
      sql`SELECT approval_xact_id::text AS proof FROM commission_statements WHERE id=${id}`,
    );
    await tx.execute(sql`UPDATE commission_statements SET ${setClause('APPROVED')} WHERE id=${id}`);
    const [approved] = await tx.execute(
      sql`SELECT approval_xact_id::text AS proof, pg_current_xact_id()::text AS xact
        FROM commission_statements WHERE id=${id}`,
    );
    return { draft, reviewed, approved };
  });
  expect(proof.draft?.['proof']).toBeNull();
  expect(proof.reviewed?.['proof']).toBeNull();
  expect(proof.approved?.['proof']).not.toBeNull();
  expect(proof.approved?.['proof']).toBe(proof.approved?.['xact']);
  const later = await asA(
    sql`SELECT approval_xact_id::text AS proof, pg_current_xact_id()::text AS xact
      FROM commission_statements WHERE period=${period}`,
  );
  expect(later[0]?.['proof']).not.toBe(later[0]?.['xact']);
});

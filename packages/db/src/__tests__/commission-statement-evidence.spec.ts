import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  FINGERPRINTS,
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

// الأدلة اللي بتتغيّر مع المراجعة؛ الاعتماد ما يقدرش يعيد كتابتها (FR-001 و D-5).
const REVIEW_EVIDENCE = [
  { column: 'reviewed_fingerprint', value: FINGERPRINTS.current },
  { column: 'reviewed_statement_fingerprint', value: FINGERPRINTS.current },
  { column: 'reviewed_by', value: SECOND_REVIEWER.user },
  { column: 'reviewed_membership_id', value: SECOND_REVIEWER.membership },
  { column: 'reviewed_at', value: '2026-11-03T08:00:00Z' },
];

it.each(REVIEW_EVIDENCE)('approving does not rewrite $column', async ({ column, value }) => {
  const period = nextPeriod();
  await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  await expectPgError(
    asA(sql`UPDATE commission_statements SET status='APPROVED', approved_by=${USER}, approved_at=now(),
      input_fingerprint=${FINGERPRINTS.input}, statement_fingerprint=${FINGERPRINTS.statement},
      ${sql.identifier(column)}=${value}
      WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`),
    '23514',
    'commission_statements_review_evidence',
  );
  expect(await asA(sql`SELECT status FROM commission_statements WHERE period=${period}`)).toEqual([
    { status: 'REVIEWED' },
  ]);
});

it('a re-review may rewrite the review evidence', async () => {
  const period = nextPeriod();
  await walkCommissionStatement(db, { tenant: A, period, ids, to: 'REVIEWED' });
  await asA(sql`UPDATE commission_statements SET reviewed_fingerprint=${FINGERPRINTS.current},
    reviewed_statement_fingerprint=${FINGERPRINTS.current}, reviewed_by=${SECOND_REVIEWER.user},
    reviewed_membership_id=${SECOND_REVIEWER.membership}, reviewed_at='2026-11-05T08:00:00Z'
    WHERE company_id=${A.company} AND business_id=${A.business} AND period=${period}`);
  expect(
    await asA(
      sql`SELECT reviewed_fingerprint, reviewed_by FROM commission_statements WHERE period=${period}`,
    ),
  ).toEqual([{ reviewed_fingerprint: FINGERPRINTS.current, reviewed_by: SECOND_REVIEWER.user }]);
});

it('the approval cannot freeze inputs other than the reviewed ones', async () => {
  await expectPgError(
    walkCommissionStatement(db, {
      tenant: A,
      period: nextPeriod(),
      ids,
      inputFingerprint: FINGERPRINTS.current,
    }),
    '23514',
    'commission_statements_input_matches_review',
  );
});

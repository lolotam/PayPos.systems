import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  assertStatementPeriodsOpen,
  createDatabase,
  lockStatementPeriods,
  StatementPeriodClosedError,
  StatementPeriodFormatError,
  type Database,
  type IdGenerator,
} from '../index.ts';
import {
  COMMISSION_TENANT,
  FINGERPRINTS,
  seedCommissionStatementTenants,
  walkCommissionStatement,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

class FakeIds implements IdGenerator {
  readonly calls: string[] = [];
  private readonly values: string[];
  constructor(values: string[]) {
    this.values = values;
  }
  newId(): string {
    const id = this.values[this.calls.length];
    if (id === undefined) throw new Error('fake IdGenerator exhausted');
    this.calls.push(id);
    return id;
  }
}

const uuid = (value: number) => `01920000-0000-7000-8000-${value.toString(16).padStart(12, '0')}`;
const ids = new FakeIds(Array.from({ length: 80 }, (_, index) => uuid(index + 1)));
const { A } = COMMISSION_TENANT;
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const pause = () => new Promise((resolve) => setTimeout(resolve, 60));

// ينتظر لحد ما المعاملة تصير موقوفة ورا pid معيّن، بنفس تقنية packages/db/test/statement-lock-order.ts.
const waitForBlocker = async (
  observer: postgres.Sql,
  pid: () => number | undefined,
  blocker: number,
  limitMs = 10_000,
): Promise<boolean> => {
  const deadline = performance.now() + limitMs;
  while (performance.now() < deadline) {
    const current = pid();
    if (current !== undefined) {
      const [row] = await observer<{ blocked: boolean }[]>`
        SELECT ${blocker} = ANY(pg_blocking_pids(${current})) AS blocked`;
      if (row?.blocked === true) return true;
    }
    await pause();
  }
  return false;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`CREATE TABLE statement_period_probe(company_id uuid, id uuid, note text)`;
  await owner`GRANT SELECT, INSERT ON statement_period_probe TO pospay_app`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('CM-01 creates and locks one DRAFT with the injected id and declares no id default', async () => {
  const before = ids.calls.length;
  const locked = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: ['2026-10'], ids }),
  );
  expect(locked).toEqual([{ period: '2026-10', statementId: uuid(1), status: 'DRAFT' }]);
  expect(ids.calls).toHaveLength(before + 1);
  expect(await owner`SELECT status FROM commission_statements WHERE id=${uuid(1)}`).toEqual([
    { status: 'DRAFT' },
  ]);
  const [column] = await owner`SELECT column_default FROM information_schema.columns
    WHERE table_name='commission_statements' AND column_name='id'`;
  expect(column).toEqual({ column_default: null });
});

it('CM-01 concurrent callers wait, create one row and return the same statement id', async () => {
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held = new Promise<void>((resolve) => (locked = resolve));
  const first = db.withTenant(A.company, async (tx) => {
    const result = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2026-11'],
      ids,
    });
    locked();
    await gate;
    return result;
  });
  await held;
  let secondFinished = false;
  const second = db.withTenant(A.company, async (tx) => {
    const result = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2026-11'],
      ids,
    });
    secondFinished = true;
    return result;
  });
  await pause();
  expect(secondFinished).toBe(false);
  release();
  const [a, b] = await Promise.all([first, second]);
  expect(a[0]?.statementId).toBe(b[0]?.statementId);
  expect(await owner`SELECT id FROM commission_statements WHERE period='2026-11'`).toHaveLength(1);
});

it('CM-02 locks the periods in ascending order so opposite orders cannot deadlock', async () => {
  const holder = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    // الشهور بتتحب قبل القفل: الاختبار على ترتيب الأقفال مش على الإنشاء.
    await db.withTenant(A.company, (tx) =>
      lockStatementPeriods(tx, { businessId: A.business, periods: ['2026-10', '2026-11'], ids }),
    );
    await holder.unsafe('BEGIN');
    const [held] = await holder<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid FROM commission_statements
      WHERE company_id = ${A.company} AND business_id = ${A.business} AND period = '2026-11'
      FOR UPDATE`;
    if (held === undefined)
      throw new Error('the November row is missing before the barrier starts');

    let firstPid: number | undefined;
    const first = db.withTenant(A.company, async (tx) => {
      const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      firstPid = row?.pid;
      return lockStatementPeriods(tx, {
        businessId: A.business,
        periods: ['2026-10', '2026-11'],
        ids,
      });
    });
    first.catch(() => undefined);
    expect(await waitForBlocker(observer, () => firstPid, held.pid)).toBe(true);
    if (firstPid === undefined) throw new Error('the first writer never reported its backend pid');

    let secondPid: number | undefined;
    const second = db.withTenant(A.company, async (tx) => {
      const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      secondPid = row?.pid;
      return lockStatementPeriods(tx, {
        businessId: A.business,
        periods: ['2026-11', '2026-10'],
        ids,
      });
    });
    second.catch(() => undefined);
    expect(await waitForBlocker(observer, () => secondPid, firstPid)).toBe(true);
    if (secondPid === undefined)
      throw new Error('the second writer never reported its backend pid');

    // B واقف على October ورا A مش على November ورا H: ده الفرق بين الترتيب التصاعدي وأي ترتيب تاني.
    const [blocked] = await observer<{ blockers: number[] }[]>`
      SELECT pg_blocking_pids(${secondPid}) AS blockers`;
    expect(blocked?.blockers).toContain(firstPid);
    expect(blocked?.blockers).not.toContain(held.pid);

    await holder.unsafe('COMMIT');
    const [firstRows, secondRows] = await Promise.all([first, second]);
    expect(firstRows.map((row) => row.period)).toEqual(['2026-10', '2026-11']);
    expect(secondRows.map((row) => row.period)).toEqual(['2026-10', '2026-11']);
  } finally {
    await holder.unsafe('ROLLBACK').catch(() => undefined);
    await holder.end();
    await observer.end();
  }
});

it('CM-03 refuses every closed period and rolls back the simulated writer', async () => {
  await walkCommissionStatement(db, { tenant: A, period: '2027-05', ids });
  await walkCommissionStatement(db, { tenant: A, period: '2027-06', ids, to: 'PAID' });
  const work = db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO statement_period_probe(company_id,id,note)
      VALUES (${A.company},${uuid(500)},'must roll back')`);
    const locked = await lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2027-06', '2027-05'],
      ids,
    });
    assertStatementPeriodsOpen(locked);
  });
  await expect(work).rejects.toMatchObject({
    name: 'StatementPeriodClosedError',
    code: 'COMMISSION_PERIOD_CLOSED',
    periods: ['2027-05', '2027-06'],
  });
  expect(await owner`SELECT id FROM statement_period_probe`).toHaveLength(0);
  await walkCommissionStatement(db, { tenant: A, period: '2027-07', ids, to: 'REVIEWED' });
  const open = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: ['2027-08', '2027-07'], ids }),
  );
  expect(() => assertStatementPeriodsOpen(open)).not.toThrow();
  expect(new StatementPeriodClosedError(['2027-05']).periods).toEqual(['2027-05']);
});

it.each(['2026-13', '26-10', '2026-1', '0000-01', ''])(
  'rejects malformed period %s before drawing an id',
  async (period) => {
    const calls = ids.calls.length;
    const work = db.withTenant(A.company, (tx) =>
      lockStatementPeriods(tx, { businessId: A.business, periods: [period], ids }),
    );
    await expect(work).rejects.toBeInstanceOf(StatementPeriodFormatError);
    await expect(work).rejects.toMatchObject({ period, code: 'COMMISSION_PERIOD_FORMAT' });
    expect(ids.calls).toHaveLength(calls);
  },
);

it('normalises duplicates and unsorted input and draws one id per distinct existing period', async () => {
  const calls = ids.calls.length;
  const rows = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, {
      businessId: A.business,
      periods: ['2027-02', '2027-01', '2027-02'],
      ids,
    }),
  );
  expect(rows.map((row) => row.period)).toEqual(['2027-01', '2027-02']);
  expect(ids.calls).toHaveLength(calls + 2);
  const empty = await db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: [], ids }),
  );
  expect(empty).toEqual([]);
  expect(ids.calls).toHaveLength(calls + 2);
});

it('returns the status committed by the lock holder after the wait', async () => {
  let release!: () => void;
  let held!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const locked = new Promise<void>((resolve) => (held = resolve));
  const first = db.withTenant(A.company, async (tx) => {
    await lockStatementPeriods(tx, { businessId: A.business, periods: ['2027-09'], ids });
    await tx.execute(sql`UPDATE commission_statements SET status='REVIEWED',
      reviewed_fingerprint=${FINGERPRINTS.reviewed}, reviewed_statement_fingerprint=${FINGERPRINTS.statement},
      reviewed_by=${USER}, reviewed_membership_id=${A.membership}, reviewed_at=now() WHERE period='2027-09'`);
    held();
    await gate;
  });
  await locked;
  const second = db.withTenant(A.company, (tx) =>
    lockStatementPeriods(tx, { businessId: A.business, periods: ['2027-09'], ids }),
  );
  await pause();
  release();
  await first;
  expect((await second)[0]?.status).toBe('REVIEWED');
});

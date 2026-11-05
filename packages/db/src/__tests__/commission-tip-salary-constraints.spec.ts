import { sql } from 'drizzle-orm';
import { parseMoney } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  OTHER_COMMISSION_IDS,
  seedCommissionStatementTenants,
  expectPgError,
} from '../../test/commission-statement-fixtures.ts';
import { insertTipSalary, tipSalaryIds as ids } from '../../test/commission-tip-salary-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const { A, B } = COMMISSION_TENANT;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

it.each(['0.000', '12.345', '99999999999.999'])(
  'round trips exact tip and salary money %s',
  async (amount) => {
    const session = ids.newId();
    const salaryId = ids.newId();
    await db.withTenant(A.company, async (tx) => {
      await insertTipSalary(tx, 'commission_tip_heads', A, { session });
      await insertTipSalary(tx, 'commission_tips', A, { session, amount });
      await insertTipSalary(tx, 'commission_salaries', A, {
        id: salaryId,
        amount,
        effectiveFrom: `2026-11-${amount === '0.000' ? '01' : amount === '12.345' ? '02' : '03'}`,
      });
      const tips = await tx.execute<{ amount: string }>(
        sql`SELECT amount FROM commission_tips WHERE session_id=${session}`,
      );
      const salaries = await tx.execute<{ amount: string }>(
        sql`SELECT amount FROM commission_salaries WHERE id=${salaryId}`,
      );
      expect(tips).toEqual([{ amount }]);
      expect(salaries).toEqual([{ amount }]);
      for (const tip of tips) expect(parseMoney(tip.amount)).toBe(parseMoney(amount));
    });
  },
);

it.each(['-0.001', 'NaN', '100000000000.000'])(
  'rejects invalid projection money %s',
  async (amount) => {
    for (const table of ['commission_tips', 'commission_salaries'] as const) {
      await expectPgError(
        db.withTenant(A.company, async (tx) => {
          const session = ids.newId();
          if (table === 'commission_tips')
            await insertTipSalary(tx, 'commission_tip_heads', A, { session });
          await insertTipSalary(tx, table, A, { session, amount, effectiveFrom: '2026-12-01' });
        }),
        amount === '100000000000.000' ? '22003' : '23514',
      );
    }
  },
);

it.each([{ revision: 0 }, { revision: -1 }, { period: '2026-13' }, { period: '2026-12' }])(
  'rejects an invalid head %j',
  async (overrides) => {
    await expectPgError(
      db.withTenant(A.company, (tx) => insertTipSalary(tx, 'commission_tip_heads', A, overrides)),
      '23514',
    );
  },
);

it('rejects invalid method and salary revision', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const session = ids.newId();
      await insertTipSalary(tx, 'commission_tip_heads', A, { session });
      await insertTipSalary(tx, 'commission_tips', A, { session, method: 'CHEQUE' });
    }),
    '23514',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertTipSalary(tx, 'commission_salaries', A, { revision: 0, effectiveFrom: '2026-12-02' }),
    ),
    '23514',
  );
});

it('enforces natural identities independently of generated row ids', async () => {
  const session = ids.newId();
  await db.withTenant(A.company, async (tx) => {
    await insertTipSalary(tx, 'commission_tip_heads', A, { session });
    await insertTipSalary(tx, 'commission_tips', A, { session });
    await insertTipSalary(tx, 'commission_salaries', A, { effectiveFrom: '2026-12-03' });
  });
  for (const table of ['commission_tip_heads', 'commission_tips', 'commission_salaries'] as const) {
    await expectPgError(
      db.withTenant(A.company, (tx) =>
        insertTipSalary(tx, table, A, { session, effectiveFrom: '2026-12-03' }),
      ),
      '23505',
    );
  }
});

it('qualifies employee, branch and head references by both tenant and business', async () => {
  for (const branch of [B.branch, OTHER_COMMISSION_IDS.branch]) {
    await expectPgError(
      db.withTenant(A.company, (tx) => insertTipSalary(tx, 'commission_tip_heads', A, { branch })),
      '23503',
    );
  }
  for (const employee of [B.employee, OTHER_COMMISSION_IDS.employee]) {
    await expectPgError(
      db.withTenant(A.company, (tx) =>
        insertTipSalary(tx, 'commission_salaries', A, { employee, effectiveFrom: '2026-12-04' }),
      ),
      '23503',
    );
  }
  const session = ids.newId();
  await db.withTenant(A.company, (tx) =>
    insertTipSalary(tx, 'commission_tip_heads', A, { session }),
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertTipSalary(tx, 'commission_tips', A, {
        session,
        business: OTHER_COMMISSION_IDS.business,
        employee: OTHER_COMMISSION_IDS.employee,
      }),
    ),
    '23503',
  );
});

it('upserts salary revisions only inside the current tenant', async () => {
  const id = ids.newId();
  await db.withTenant(A.company, (tx) =>
    insertTipSalary(tx, 'commission_salaries', A, { id, effectiveFrom: '2026-12-05' }),
  );
  const upsert = sql`INSERT INTO commission_salaries(company_id,id,business_id,employee_id,effective_from,amount,revision)
    VALUES(${A.company},${id},${A.business},${A.employee},'2026-12-05','99.001',2)
    ON CONFLICT(company_id,employee_id,effective_from) DO UPDATE SET amount=excluded.amount,revision=excluded.revision`;
  await expectPgError(
    db.withTenant(B.company, (tx) => tx.execute(upsert)),
    '42501',
  );
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(upsert);
    expect(
      await tx.execute(sql`SELECT amount,revision FROM commission_salaries WHERE id=${id}`),
    ).toEqual([{ amount: '99.001', revision: 2 }]);
  });
});

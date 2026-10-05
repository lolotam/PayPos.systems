import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSalaryTransactions } from '../persistence/drizzle-salary-transactions.ts';
import { salaryHistory } from '../queries/salary-history.query.ts';
import { createSalaryAccess } from '../persistence/employee-salary-access.adapter.ts';
import { SetSalaryUseCase } from '../use-cases/set-salary/set-salary.usecase.ts';
import {
  salaryFixture,
  salaryCommand,
  salaryTerms,
  salaryIds,
  type SalaryFixture,
} from './salary.fixture.ts';
let f: SalaryFixture;
beforeAll(async () => {
  f = await salaryFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('owner sets zero, replaces same date, audits before/after actor/reason and emits state', async () => {
  const first = await f.set.execute(salaryCommand(f, '0.000'));
  const second = await f.set.execute(salaryCommand(f, '123.456'));
  expect(second).toMatchObject({ id: first.id, revision: 2, amount: '123.456' });
  const rows = await f.h
    .owner`SELECT * FROM employee_salaries WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  expect(rows).toHaveLength(1);
  const [audit] = await f.h
    .owner`SELECT * FROM audit_log WHERE company_id=${f.company} AND entity_id=${first.id} ORDER BY at DESC,id DESC LIMIT 1`;
  expect(audit).toMatchObject({
    actor_user_id: f.userId,
    before: { amount: '0.000', revision: 1 },
    after: { amount: '123.456', reason: salaryTerms().reason, revision: 2 },
  });
  const events = await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${f.employee.id} AND event_type='SalaryChanged' ORDER BY seq`;
  expect(events.map((e) => e['payload'])).toEqual([
    { employee_id: f.employee.id, effective_from: '2026-01-01', amount: '0.000', revision: 1 },
    { employee_id: f.employee.id, effective_from: '2026-01-01', amount: '123.456', revision: 2 },
  ]);
});
it('concurrent same-date writers emit both revisions in commit order', async () => {
  const results = await Promise.all([
    f.set.execute(salaryCommand(f, '200.000', '2026-02-01')),
    f.set.execute(salaryCommand(f, '300.000', '2026-02-01')),
  ]);
  expect(results.map((r) => r.revision).sort()).toEqual([1, 2]);
  const events = await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${f.employee.id} AND payload->>'effective_from'='2026-02-01' ORDER BY seq`;
  expect(events.map((e) => e['payload']['revision'])).toEqual([1, 2]);
  const [row] = await f.h
    .owner`SELECT amount::text FROM employee_salaries WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND effective_from='2026-02-01'`;
  expect(row?.['amount']).toBe(events[1]?.['payload']['amount']);
});
it('replays concurrent duplicate key and rejects a changed fingerprint without another revision', async () => {
  const cmd = salaryCommand(f, '400.000', '2026-03-01');
  const [a, b] = await Promise.all([f.set.execute(cmd), f.set.execute(cmd)]);
  expect(a).toEqual(b);
  await expect(f.set.execute({ ...cmd, fingerprint: 'b'.repeat(64) })).rejects.toThrow(
    'different request',
  );
  const rows = await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${f.employee.id} AND payload->>'effective_from'='2026-03-01'`;
  expect(rows).toHaveLength(1);
});
it('rolls back salary audit event and response if the transaction fails after save', async () => {
  const actual = createSalaryTransactions(f.db, salaryIds);
  const broken = new SetSalaryUseCase(
    {
      run: (ctx, work) =>
        actual.run(ctx, async (tx) => {
          await work(tx);
          throw new Error('Synthetic failure');
        }),
    },
    salaryIds,
  );
  const command = salaryCommand(f, '500.000', '2026-04-01');
  await expect(broken.execute(command)).rejects.toThrow('SALARY_PERSISTENCE_FAILED');
  expect(
    await f.h
      .owner`SELECT id FROM employee_salaries WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND effective_from='2026-04-01'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND aggregate_id=${f.employee.id} AND payload->>'effective_from'='2026-04-01'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity='employee_salary' AND "after"->>'effective_from'='2026-04-01'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT key FROM idempotency_keys WHERE company_id=${f.company} AND operation='set-salary' AND key=${command.key}`,
  ).toHaveLength(0);
});
it('history has exact shape, descending date cursor, past/future dates and indexed plan', async () => {
  await f.set.execute(salaryCommand(f, '100.001', '1900-01-01'));
  await f.set.execute(salaryCommand(f, '99999999999.999', '2099-01-01'));
  const page = await f.db.withTenant(f.company, (tx) =>
    salaryHistory(tx, f.context, { limit: 1 }, createSalaryAccess()),
  );
  expect(page).toEqual({
    items: [
      expect.objectContaining({
        employee_id: f.employee.id,
        effective_from: '2099-01-01',
        amount: '99999999999.999',
        set_by: f.userId,
        reason: salaryTerms().reason,
        revision: 1,
      }),
    ],
    next_cursor: '2099-01-01',
    can_manage: true,
  });
  const next = await f.db.withTenant(f.company, (tx) =>
    salaryHistory(tx, f.context, { limit: 1, cursor: '2099-01-01' }, createSalaryAccess()),
  );
  expect(next).toMatchObject({ items: [{ effective_from: '2026-03-01' }] });
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id,employee_id,effective_from,amount,set_by,revision,reason FROM employee_salaries WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND effective_from < '2099-01-01' ORDER BY effective_from DESC LIMIT 20`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employee_salaries_employee_date_key');
});

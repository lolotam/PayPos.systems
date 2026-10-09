import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeIban, employeeIbanStatement } from '../queries/employee-iban.query.ts';
import {
  employeeIbanHistory,
  employeeIbanHistoryStatement,
} from '../queries/employee-iban-history.query.ts';
import { duplicateEmployeeIbanStatement } from '../persistence/drizzle-employee-iban-transactions.ts';
import { createEmployeeIbanAccess } from '../persistence/employee-iban-access.adapter.ts';
import {
  employeeIbanFixture,
  generatedIban,
  ibanTerms,
  type IbanFixture,
} from './employee-iban.fixture.ts';
let f: IbanFixture;
beforeAll(async () => {
  f = await employeeIbanFixture();
  await f.setIban.execute({ ...f.context, input: ibanTerms() });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('returns exact full shape and a masked query that never selects protected columns', async () => {
  const full = await f.db.withTenant(f.company, (tx) =>
    employeeIban(tx, f.context, createEmployeeIbanAccess()),
  );
  expect(full).toEqual({
    iban: ibanTerms().iban,
    bank_id: ibanTerms().bank_id,
    holder_name_en: ibanTerms().holder_name_en,
    status: 'SET',
    iban_last4: '0101',
    revision: 1,
    set_at: expect.any(String),
    set_by: f.userId,
    can_read_full: true,
    can_manage: true,
  });
  const masked = await f.db.withTenant(f.company, (tx) =>
    employeeIban(tx, f.context, {
      check: async () => ({ read: false, manage: false, masked: true, featureEnabled: true }),
    }),
  );
  expect(masked).toEqual({
    status: 'SET',
    iban_last4: '0101',
    iban: null,
    bank_id: null,
    holder_name_en: null,
    revision: 1,
    set_at: expect.any(String),
    set_by: null,
    can_read_full: false,
    can_manage: false,
  });
  const query = new PgDialect().sqlToQuery(employeeIbanStatement(f.context, false)).sql;
  expect(query).not.toMatch(/bank_id|holder_name_en|set_by/);
  expect(query.match(/iban/g)).toHaveLength(3);
});
it('history projects full values newest first with a revision cursor', async () => {
  await f.setIban.execute({ ...f.context, input: ibanTerms(generatedIban(22), 1) });
  const page = await f.db.withTenant(f.company, (tx) =>
    employeeIbanHistory(tx, f.context, { limit: 1 }, createEmployeeIbanAccess()),
  );
  expect(page).toMatchObject({
    items: [
      {
        revision: 2,
        iban: generatedIban(22),
        bank_id: 'kw-cbk',
        holder_name_en: 'SYNTHETIC HOLDER',
        cleared: false,
        set_by: f.userId,
        reason: 'Synthetic change',
      },
    ],
    next_cursor: 2,
  });
});
it('current, history and duplicate lookups use the indexes introduced with this slice', async () => {
  const statements = [
    employeeIbanStatement(f.context, true),
    employeeIbanHistoryStatement(f.context, { limit: 20, cursor: 3 }),
    duplicateEmployeeIbanStatement(f.context, generatedIban(22)),
  ];
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const results = [];
    for (const statement of statements)
      results.push(
        JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`)),
      );
    return results;
  });
  expect(plans[0]).toContain('employee_ibans_employee_revision_key');
  expect(plans[1]).toContain('employee_ibans_employee_revision_key');
  expect(plans[2]).toContain('employee_ibans_company_iban_idx');
});

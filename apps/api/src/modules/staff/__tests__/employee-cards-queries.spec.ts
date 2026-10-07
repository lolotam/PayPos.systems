import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';
import {
  activeEmployeeCardStatement,
  readEmployeeCards,
} from '../queries/employee-cards.query.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
let f: EmployeeFixture;
let employeeId: string;
let cardId: string;
const codeHash = 'cd'.repeat(32);

beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
  employeeId = (
    await f.useCase.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, 'Card query employee'),
    })
  ).id;
  cardId = ids.newId();
  await f.h.owner`INSERT INTO employee_cards(company_id,id,business_id,employee_id,card_code_hash,card_code_suffix,issued_at,issued_by)
    VALUES (${f.company},${cardId},${f.business},${employeeId},${codeHash},'9mQx',timestamptz '2026-10-07 12:00:00+00',${f.userId})`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const viewFor = (employee: string) =>
  f.db.withTenant(
    f.company,
    (tx) => readEmployeeCards(tx, f.company, f.userId, f.business, employee, createEmployeeCardAccess()),
    { userId: f.userId },
  );

it('returns the contract shape with the suffix only, and nothing for a missing employee', async () => {
  const view = await viewFor(employeeId);
  expect(view).toEqual({
    active: {
      id: cardId,
      employee_id: employeeId,
      card_code_suffix: '9mQx',
      issued_at: '2026-10-07T12:00:00.000Z',
      revoked_at: null,
    },
    can_manage: true,
  });
  expect(JSON.stringify(view)).not.toContain(codeHash);
  expect(await viewFor(ids.newId())).toBeNull();
  const foreign = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(activeEmployeeCardStatement(f.company, f.business, employeeId)),
  );
  expect(foreign).toHaveLength(0);
});

it('EXPLAIN ANALYZE reads the active card through an employee_cards index', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${activeEmployeeCardStatement(f.company, f.business, employeeId)}`,
    );
  });
  const text = JSON.stringify(plan);
  expect(text).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
  expect(text).toContain('"Relation Name":"employee_cards"');
  expect(text).toMatch(/"Index Name":"employee_cards_/);
  expect(text).not.toContain('Seq Scan');
});

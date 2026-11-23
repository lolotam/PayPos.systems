import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  estimateFixture,
  estimatePath,
  ids,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

let fixture: EstimateFixture;
let carryOnly = '';

type CarryBody = {
  employees: {
    employee_id: string;
    total: string | null;
    partial: boolean;
    carries: { commission: string; tip_card: string };
  }[];
  total: string | null;
};

/** صف كشف مزروع بالمالك: الكشف بيتكتب بقفل الكاتبين، وهنا بنزرعه عشان المرحّل يشير ليه. */
async function seedStatement(f: EstimateFixture, period: string): Promise<string> {
  const id = ids.newId();
  await f.h.owner`INSERT INTO commission_statements(company_id,id,business_id,period)
    VALUES (${f.company},${id},${f.business},${period})`;
  return id;
}

/** مرحّل مزروع بالمالك لأن اعتماد الشهر (اللي بيكتبه) مش في الـ PR ده. */
async function seedCarry(
  f: EstimateFixture,
  carry: {
    employee: string;
    kind: 'COMMISSION' | 'TIP_CARD';
    amount: string;
    source: [string, string];
    target: [string, string];
  },
): Promise<void> {
  await f.h.owner`INSERT INTO commission_carries(
    company_id,id,business_id,employee_id,kind,amount,source_statement_id,source_period,
    target_period,target_statement_id)
    VALUES (${f.company},${ids.newId()},${f.business},${carry.employee},${carry.kind},${carry.amount},
      ${carry.source[0]},${carry.source[1]},${carry.target[1]},${carry.target[0]})`;
}

beforeAll(async () => {
  fixture = await estimateFixture();
  const october = await seedStatement(fixture, '2026-10');
  const november = await seedStatement(fixture, '2026-11');
  const december = await seedStatement(fixture, '2026-12');
  carryOnly = ids.newId();
  await fixture.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${fixture.company},${carryOnly},${fixture.business},${fixture.branch},'Carry only',
      ${employeeNameMatchKey('Carry only')},'staff','2026-01-01',9)`;
  const base = { source: [october, '2026-10'] as [string, string] };
  const target = [november, '2026-11'] as [string, string];
  await seedCarry(fixture, {
    ...base,
    employee: fixture.employee,
    kind: 'COMMISSION',
    amount: '-5.000',
    target,
  });
  await seedCarry(fixture, {
    ...base,
    employee: fixture.employee,
    kind: 'TIP_CARD',
    amount: '-2.000',
    target,
  });
  await seedCarry(fixture, {
    ...base,
    employee: carryOnly,
    kind: 'COMMISSION',
    amount: '-1.500',
    target,
  });
  // مرحّل لشهر تاني: ما يظهرش في تقدير نوفمبر.
  await seedCarry(fixture, {
    ...base,
    employee: fixture.secondEmployee,
    kind: 'COMMISSION',
    amount: '-9.000',
    target: [december, '2026-12'],
  });
});

afterAll(async () => {
  await fixture?.h.close();
});

const get = (f: EstimateFixture, actor = f.cookie) =>
  f.h.send('GET', estimatePath(f.business, '2026-11'), { cookie: actor, company: f.company });

it('shows a business-wide reader each carry on its own and never netted, apart from the priced total', async () => {
  const body = (await get(fixture)).body as CarryBody;
  const sarah = body.employees.find((employee) => employee.employee_id === fixture.employee);
  expect(sarah?.carries).toEqual({ commission: '-5.000', tip_card: '-2.000' });
  expect(sarah?.total).toBe('1.000');
  expect(sarah?.partial).toBe(false);
  const nadia = body.employees.find((employee) => employee.employee_id === fixture.secondEmployee);
  expect(nadia?.carries).toEqual({ commission: '0.000', tip_card: '0.000' });
});

it('lists an employee who has only a carry for the business-wide reader, with a zero total', async () => {
  const body = (await get(fixture)).body as CarryBody;
  const only = body.employees.find((employee) => employee.employee_id === carryOnly);
  expect(only).toMatchObject({
    total: '0.000',
    carries: { commission: '-1.500', tip_card: '0.000' },
  });
  expect(body.total).toBe('2.000');
});

it('gives a branch-scoped reader no carry, labels her figures partial and hides a carry-only employee', async () => {
  const body = (await get(fixture, fixture.branchCookie)).body as CarryBody;
  expect(body.employees.map((employee) => employee.employee_id)).toEqual([fixture.employee]);
  expect(body.employees[0]).toMatchObject({
    partial: true,
    carries: { commission: '0.000', tip_card: '0.000' },
  });
  expect(JSON.stringify(body)).not.toContain('-5.000');
});

it('leaves the database unchanged: a read of the estimate writes no statement and no carry', async () => {
  const count = async () => {
    const [statements] = await fixture.h
      .owner`SELECT count(*)::int AS count FROM commission_statements`;
    const [carries] = await fixture.h.owner`SELECT count(*)::int AS count FROM commission_carries`;
    return [statements?.['count'], carries?.['count']];
  };
  const before = await count();
  await get(fixture);
  await get(fixture, fixture.branchCookie);
  expect(await count()).toEqual(before);
});

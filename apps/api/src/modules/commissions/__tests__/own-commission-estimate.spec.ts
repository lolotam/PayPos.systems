import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  insertCommissionLineHead,
  insertCommissionLineProjection,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { insertCommissionCorrection } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import { insertCommissionPlanVersion } from '../../../../../../packages/db/test/commission-plan-version-fixtures.ts';
import {
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { interceptDatabase } from '../../../../test/service-session.fixture.ts';
import {
  ids,
  must,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import { ownCommissionEstimateProviders } from '../commission-own-estimate.providers.ts';
import {
  type OwnCommissionEstimateReads,
} from '../queries/own-commission-estimate-context.ts';
import { readOwnCommissionEstimate } from '../queries/own-commission-estimate.query.ts';

const MONTH = '2026-10';
const now = new Date('2026-10-15T08:00:00Z');
const CUSTOMER_NAME = 'Synthetic customer';

let f: TipFixture;
let reads: OwnCommissionEstimateReads;
let who = '';
let correctionLine = '';

const tenantOf = (employee: string): CommissionLineTenant => ({
  company: f.company,
  business: f.business,
  branch: f.branch,
  employee,
  membership: f.membership,
  service: must(f.services[1]),
  customer: f.customer,
});

const names = async (
  tx: Parameters<OwnCommissionEstimateReads['monthsBack']>[0],
  companyId: string,
  businessId: string,
  serviceIds: readonly string[],
) => {
  const rows = await tx.execute<{ id: string; name_en: string; name_ar: string | null }>(
    sql`SELECT id, name_en, name_ar FROM services WHERE company_id = ${companyId}
      AND business_id = ${businessId}::uuid AND id = ANY(${`{${serviceIds.join(',')}}`}::uuid[])`,
  );
  return new Map(rows.map((row) => [row.id, { nameEn: row.name_en, nameAr: row.name_ar }]));
};

const setColumns = (columns: string[] | null, monthsBack: number | null) =>
  f.h.owner`INSERT INTO business_settings (company_id, business_id, staff_columns, staff_months_back)
    VALUES (${f.company}, ${f.business}, ${columns}, ${monthsBack})
    ON CONFLICT (company_id, business_id)
    DO UPDATE SET staff_columns = EXCLUDED.staff_columns, staff_months_back = EXCLUDED.staff_months_back`;

const context = () => ({ companyId: f.company, businessId: f.business, userId: f.userId });
const read = (query: unknown = {}, as = who, database: TenantWrappers = f.db) => {
  who = as;
  return database.withTenant(f.company, (tx) =>
    readOwnCommissionEstimate(tx, context(), query, now, reads),
  );
};

async function seedMonth(
  employee: string,
  rows: { net: string; ruleKind: string; status?: string; period?: string; date?: string }[],
) {
  await f.db.withTenant(f.company, async (tx) => {
    for (const row of rows) {
      await insertCommissionLineProjection(tx, tenantOf(employee), ids, {
        period: row.period ?? MONTH,
        businessDate: row.date ?? `${row.period ?? MONTH}-05`,
        net: row.net,
        ruleKind: row.ruleKind,
        rulePctBps: row.ruleKind === 'PCT' ? 1000 : null,
        status: row.status ?? 'ACTIVE',
      });
    }
  });
}

async function seedStatement(period: string): Promise<string> {
  const id = ids.newId();
  await f.h.owner`INSERT INTO commission_statements(company_id,id,business_id,period)
    VALUES (${f.company},${id},${f.business},${period})`;
  return id;
}

async function seedFrozenRows(
  tx: Parameters<Parameters<typeof f.db.withTenant>[1]>[0],
  statementId: string,
  source: string,
) {
  const row = (employee: string, overrides: Record<string, unknown>) =>
    insertCommissionLine(tx, tenantOf(employee), statementId, ids, overrides);
  const mine = must(f.employees[0]);
  const customer = { customerId: f.customer, customerName: CUSTOMER_NAME };
  await row(mine, { kind: 'EMPLOYEE' });
  await row(mine, {
    kind: 'COMMISSION',
    sourceRef: `line:${ids.newId()}`,
    amount: '10.000',
    serviceNameEn: 'Closed service',
    ...customer,
  });
  const correction = { kind: 'CORRECTION', sourcePeriod: source };
  await row(mine, {
    ...correction,
    sourceRef: `line:${ids.newId()}`,
    amount: '5.000',
    lineId: ids.newId(),
    serviceId: must(f.services[1]),
    serviceNameEn: 'Closed service',
    businessDate: '2026-09-02',
    ...customer,
  });
  await row(mine, {
    ...correction,
    sourceRef: `sale:${ids.newId()}`,
    amount: '4.000',
    previousAmount: '10.000',
    newAmount: '14.000',
  });
  await row(mine, { kind: 'TIP_CARD', amount: '2.000', sourceRef: `tip:${ids.newId()}` });
  for (const kind of ['CORRECTION_TIP_CARD', 'CORRECTION_TIP_CASH']) {
    await row(mine, {
      kind,
      sourcePeriod: source,
      previousAmount: '0.000',
      newAmount: '1.000',
      amount: '1.000',
      sourceRef: `${kind}:${ids.newId()}`,
    });
  }
  const colleague = must(f.employees[1]);
  await row(colleague, { kind: 'EMPLOYEE', employeeNumber: 2 });
  await row(colleague, {
    kind: 'COMMISSION',
    sourceRef: `line:${ids.newId()}`,
    amount: '100.000',
    employeeNumber: 2,
  });
}

async function freezeMonth(period: string, to: 'APPROVED' | 'PAID') {
  const source = `2026-0${Number(period.slice(5)) - 1}`;
  await walkCommissionStatement(f.db, {
    tenant: tenantOf(must(f.employees[0])),
    period,
    ids,
    to,
    reviewer: f.userId,
    afterApproved: (tx, statementId) => seedFrozenRows(tx, statementId, source),
  });
}

const rowCounts = async () =>
  JSON.stringify(
    await f.h.owner`SELECT
      (SELECT count(*) FROM commission_lines)::int AS lines,
      (SELECT count(*) FROM commission_statements)::int AS statements,
      (SELECT count(*) FROM commission_corrections)::int AS corrections,
      (SELECT count(*) FROM commission_statement_lines)::int AS frozen`,
  );

beforeAll(async () => {
  f = await tipFixture();
  const provider = ownCommissionEstimateProviders({
    context: async () => ({ employeeId: who, currentMonth: MONTH, timeZone: 'Asia/Kuwait' }),
    serviceNames: names,
  })[0] as { useValue: OwnCommissionEstimateReads };
  reads = provider.useValue;
  await setColumns(['date', 'estimated_commission', 'tip'], null);
  const [mine, colleague, noPlan, noSalary] = f.employees as [string, string, string, string];
  await seedMonth(mine, [
    { net: '10.000', ruleKind: 'PCT' },
    { net: '20.000', ruleKind: 'PCT', status: 'CANCELLED' },
  ]);
  await seedMonth(colleague, [{ net: '30.000', ruleKind: 'PCT' }]);
  await seedMonth(noPlan, [{ net: '10.000', ruleKind: 'FOLLOW_PLAN' }]);
  await seedMonth(noSalary, [{ net: '10.000', ruleKind: 'FOLLOW_PLAN' }]);
  const target = await seedStatement(MONTH);
  correctionLine = ids.newId();
  await f.db.withTenant(f.company, async (tx) => {
    await insertCommissionLineHead(tx, tenantOf(mine), ids, {
      lineId: correctionLine,
      period: '2026-09',
      businessDate: '2026-09-20',
    });
    await insertCommissionPlanVersion(tx, tenantOf(mine), ids, {
      effectiveFrom: '2026-09-01',
      createdBy: f.ownerId,
    });
    for (const employee of [mine, noPlan, noSalary]) {
      await insertCommissionCorrection(tx, tenantOf(employee), ids, target, {
        sourcePeriod: '2026-09',
        targetPeriod: MONTH,
        sourceRef: `line:${correctionLine}`,
      });
    }
    await insertCommissionPlanVersion(tx, tenantOf(noSalary), ids, {
      effectiveFrom: '2026-09-01',
      createdBy: f.ownerId,
      plan: {
        base: { enabled: false },
        tiers: {
          enabled: true,
          accumulator: 'AMOUNT',
          mode: 'MARGINAL',
          steps: [
            { from: { kind: 'SALARY_MULTIPLE', value: '1.00' }, calc: { kind: 'PCT', bps: 1000 } },
          ],
        },
        package_sale: { enabled: false },
      },
    });
  });
  await freezeMonth('2026-09', 'APPROVED');
  await freezeMonth('2026-08', 'PAID');
});

afterAll(async () => {
  await f?.close();
});

it('MY-05 prices only the own active lines, keeps the corrections, and writes nothing', async () => {
  const before = await rowCounts();
  const estimate = await read({}, must(f.employees[0]));
  expect(estimate).toMatchObject({ status: 'ESTIMATE', recalculated: false });
  if (estimate.status !== 'ESTIMATE') throw new Error('expected ESTIMATE');
  expect(estimate.per_line).toHaveLength(1);
  expect(estimate.per_line[0]?.amount).toBe('1.000');
  expect(estimate.corrections).toHaveLength(1);
  expect(estimate.corrections[0]).toMatchObject({
    kind: 'LINE',
    source_period: '2026-09',
    business_date: '2026-09-20',
  });
  expect(JSON.stringify(estimate)).not.toContain(CUSTOMER_NAME);
  expect(JSON.stringify(estimate)).not.toContain(must(f.employees[1]));
  expect(await rowCounts()).toBe(before);
});

it('MY-05 a whole-period plan version reprices the month and reports recalculated', async () => {
  const colleague = must(f.employees[1]);
  await f.db.withTenant(f.company, (tx) =>
    insertCommissionPlanVersion(tx, tenantOf(colleague), ids, {
      effectiveFrom: `${MONTH}-01`,
      wholePeriod: true,
      createdBy: f.ownerId,
    }),
  );
  expect(await read({}, colleague)).toMatchObject({ status: 'ESTIMATE', recalculated: true });
});

it('MY-05 NO_PLAN and NO_SALARY hide the total and the per-line amounts but keep the corrections', async () => {
  for (const [employee, status] of [
    [must(f.employees[2]), 'NO_PLAN'],
    [must(f.employees[3]), 'NO_SALARY'],
  ] as const) {
    const response = await read({}, employee);
    expect(response).toMatchObject({ status });
    expect(response).not.toHaveProperty('total');
    expect(response).not.toHaveProperty('per_line');
    expect((response as { corrections: unknown[] }).corrections).toHaveLength(1);
  }
});

it('MY-06 and CS-Q30 an APPROVED month reads only the own frozen rows, as the manager sees them', async () => {
  const response = await read({ month: '2026-09' }, must(f.employees[0]));
  expect(response).toMatchObject({ status: 'APPROVED', total: '22.000' });
  const body = (response as { corrections: { kind: string; service_name_en: string | null }[] })
    .corrections;
  expect(body.map((c) => c.kind).sort()).toEqual(['LINE', 'SALE', 'TIP_CARD', 'TIP_CASH']);
  expect(body.find((c) => c.kind === 'LINE')?.service_name_en).toBe('Closed service');
  expect(body.filter((c) => c.kind !== 'LINE').every((c) => c.service_name_en === null)).toBe(true);
  expect(JSON.stringify(response)).not.toContain(CUSTOMER_NAME);
  expect(JSON.stringify(response)).not.toContain('100.000');
});

it('MY-06 a PAID month answers APPROVED with the same frozen amount', async () => {
  await setColumns(['date', 'estimated_commission', 'tip'], 4);
  try {
    expect(await read({ month: '2026-08' }, must(f.employees[0]))).toMatchObject({
      status: 'APPROVED',
      total: '22.000',
    });
  } finally {
    await setColumns(['date', 'estimated_commission', 'tip'], null);
  }
});

it('MY-05 and MY-20 HIDDEN returns only the status and queries no commission table', async () => {
  const statements: string[] = [];
  const database = interceptDatabase(f.db, async (statement) => {
    statements.push(statement);
  });
  await setColumns(['date', 'tip'], null);
  try {
    expect(await read({}, must(f.employees[0]), database)).toEqual({ status: 'HIDDEN' });
  } finally {
    await setColumns(['date', 'estimated_commission', 'tip'], null);
  }
  expect(statements.join('\n')).not.toMatch(
    /commission_lines|commission_statements|commission_corrections|commission_statement_lines/,
  );
});

it('MY-13 the default window is two months, a stored value widens it, and older months are refused', async () => {
  const employee = must(f.employees[0]);
  await expect(read({ month: '2026-08' }, employee)).rejects.toMatchObject({
    code: 'MY_PERIOD_OUT_OF_RANGE',
  });
  await expect(read({ month: '2026-11' }, employee)).rejects.toMatchObject({
    code: 'MY_PERIOD_OUT_OF_RANGE',
  });
  await setColumns(['date', 'estimated_commission', 'tip'], 4);
  try {
    expect(await read({ month: '2026-08' }, employee)).toMatchObject({ status: 'APPROVED' });
  } finally {
    await setColumns(['date', 'estimated_commission', 'tip'], null);
  }
});

it('rejects a bad month and any subject key before reading a commission row', async () => {
  const employee = must(f.employees[0]);
  await expect(read({ month: 'bad' }, employee)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  await expect(read({ employee_id: employee }, employee)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

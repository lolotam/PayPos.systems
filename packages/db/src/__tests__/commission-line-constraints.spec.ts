import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError, OTHER_COMMISSION_IDS } from '../../test/commission-statement-fixtures.ts';
import {
  COMMISSION_LINE_TENANTS,
  insertCommissionLineHead,
  insertCommissionLineProjection,
  insertCommissionLineRow,
  seedCommissionLineTenants,
} from '../../test/commission-line-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const insert = (row: Record<string, unknown> = {}) =>
  db.withTenant(A.company, (tx) => insertCommissionLineProjection(tx, A, ids, row));
const head = (row: Record<string, unknown> = {}) =>
  db.withTenant(A.company, (tx) => insertCommissionLineHead(tx, A, ids, row));
const line = (row: Record<string, unknown> = {}) =>
  db.withTenant(A.company, (tx) => insertCommissionLineRow(tx, A, ids, row));

async function expectPeriodCheck(
  work: Promise<unknown>,
  table: 'commission_line_heads' | 'commission_lines',
): Promise<void> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as Error & {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const source = failure.code ? failure : (failure.cause ?? failure);
  expect(source.code).toBe('23514');
  expect([`${table}_period_format`, `${table}_period_business_date`])
    .toContain(source.constraint_name);
}

it('round-trips every rule kind and exact money strings, keeping null value columns null', async () => {
  const rules = [
    { ruleKind: 'FOLLOW_PLAN' },
    { ruleKind: 'ZERO' },
    { ruleKind: 'PCT', rulePctBps: 0 },
    { ruleKind: 'PCT', rulePctBps: 10_000 },
    { ruleKind: 'FIXED', ruleFixedAmount: '0.000' },
    { ruleKind: 'FIXED', ruleFixedAmount: '99999999999.999' },
  ];
  for (const [index, rule] of rules.entries()) {
    await insert({ ...rule, lineId: `01920000-0000-7000-8000-00000000e10${index}` });
  }
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute<{
      rule_kind: string;
      rule_pct_bps: number | null;
      rule_fixed_amount: string | null;
      net: string;
      net_share: string;
    }>(sql`SELECT rule_kind,rule_pct_bps,rule_fixed_amount,net,net_share FROM commission_lines
      WHERE line_id BETWEEN '01920000-0000-7000-8000-00000000e100'
        AND '01920000-0000-7000-8000-00000000e10f'
      ORDER BY rule_kind,rule_pct_bps,rule_fixed_amount`),
  );
  expect(rows).toEqual([
    { rule_kind: 'FIXED', rule_pct_bps: null, rule_fixed_amount: '0.000', net: '10.001', net_share: '10.001' },
    { rule_kind: 'FIXED', rule_pct_bps: null, rule_fixed_amount: '99999999999.999', net: '10.001', net_share: '10.001' },
    { rule_kind: 'FOLLOW_PLAN', rule_pct_bps: null, rule_fixed_amount: null, net: '10.001', net_share: '10.001' },
    { rule_kind: 'PCT', rule_pct_bps: 0, rule_fixed_amount: null, net: '10.001', net_share: '10.001' },
    { rule_kind: 'PCT', rule_pct_bps: 10_000, rule_fixed_amount: null, net: '10.001', net_share: '10.001' },
    { rule_kind: 'ZERO', rule_pct_bps: null, rule_fixed_amount: null, net: '10.001', net_share: '10.001' },
  ]);
  const heads = await db.withTenant(A.company, (tx) =>
    tx.execute<{ customer_id: string; service_id: string; revision: number }>(
      sql`SELECT customer_id,service_id,revision FROM commission_line_heads WHERE customer_id=${A.customer}`,
    ),
  );
  expect(heads).toHaveLength(6);
  expect(heads.every((row) => row.customer_id === A.customer && row.service_id === A.service && row.revision === 1)).toBe(true);
});

it('refuses unknown and null rule kinds', async () => {
  await expectPgError(insert({ ruleKind: 'FOLLOW_SERVICE' }), '23514', 'commission_lines_rule_kind');
  await expectPgError(insert({ ruleKind: null }), '23502');
});

const invalidRules = [
  ['PCT without bps', { ruleKind: 'PCT', rulePctBps: null }, 'commission_lines_rule_pct_present'],
  ['ZERO with bps', { ruleKind: 'ZERO', rulePctBps: 1 }, 'commission_lines_rule_pct_present'],
  ['FOLLOW_PLAN with bps', { ruleKind: 'FOLLOW_PLAN', rulePctBps: 1 }, 'commission_lines_rule_pct_present'],
  ['FIXED with bps', { ruleKind: 'FIXED', rulePctBps: 1 }, 'commission_lines_rule_pct_present'],
  ['FIXED without amount', { ruleKind: 'FIXED', ruleFixedAmount: null }, 'commission_lines_rule_fixed_present'],
  ['ZERO with amount', { ruleKind: 'ZERO', ruleFixedAmount: '1.000' }, 'commission_lines_rule_fixed_present'],
  ['FOLLOW_PLAN with amount', { ruleKind: 'FOLLOW_PLAN', ruleFixedAmount: '1.000' }, 'commission_lines_rule_fixed_present'],
  ['PCT with amount', { ruleKind: 'PCT', rulePctBps: 1, ruleFixedAmount: '1.000' }, 'commission_lines_rule_fixed_present'],
] as const;

it.each(invalidRules)('refuses %s', async (_label, row, constraint) => {
  await expectPgError(insert({ ...row }), '23514', constraint);
});

it.each([-1, 10_001])('refuses rule bps %i outside the allowed range', async (rulePctBps) => {
  await expectPgError(
    insert({ ruleKind: 'PCT', rulePctBps }),
    '23514',
    'commission_lines_rule_pct_bounds',
  );
});

it('refuses negative and overflowing fixed amounts', async () => {
  await expectPgError(
    insert({ ruleKind: 'FIXED', ruleFixedAmount: '-0.001' }),
    '23514',
    'commission_lines_rule_fixed_nonnegative',
  );
  await expectPgError(
    insert({ ruleKind: 'FIXED', ruleFixedAmount: '100000000000.000' }),
    '22003',
  );
});

it.each([0, 10_001])('refuses performer share_bps %i', async (shareBps) => {
  await expectPgError(insert({ shareBps }), '23514', 'commission_lines_share_bps_bounds');
});

it('refuses negative net and a net_share greater than net', async () => {
  await expectPgError(insert({ net: '-0.001', netShare: '0.000' }), '23514', 'commission_lines_net_nonnegative');
  await expectPgError(insert({ net: '1.000', netShare: '1.001' }), '23514', 'commission_lines_net_share_within_net');
});

it.each([
  ['net', { net: 'NaN', netShare: '10.001' }, 'commission_lines_net_nonnegative'],
  ['net_share', { net: '10.001', netShare: 'NaN' }, 'commission_lines_net_share_nonnegative'],
] as const)('refuses %s = NaN', async (_label, row, constraint) => {
  await expectPgError(insert({ ...row }), '23514', constraint);
});

it('refuses a bad status in either projection table', async () => {
  await expectPgError(head({ status: 'VOID' }), '23514', 'commission_line_heads_status');
  const lineId = await head();
  await expectPgError(line({ lineId, status: 'VOID' }), '23514', 'commission_lines_status');
});

it('refuses revision zero', async () => {
  await expectPgError(head({ revision: 0 }), '23514', 'commission_line_heads_revision_positive');
});

it.each(['2026-13', '2026-1', '26-11', ''])('refuses malformed head period %s', async (period) => {
  await expectPeriodCheck(head({ period }), 'commission_line_heads');
});

it('refuses malformed line periods', async () => {
  const lineId = await head();
  await expectPeriodCheck(line({ lineId, period: '2026-13' }), 'commission_lines');
});

it('refuses well-formed periods different from business_date month', async () => {
  const lineId = await head();
  await expectPgError(head({ period: '2026-10' }), '23514', 'commission_line_heads_period_business_date');
  await expectPgError(line({ lineId, period: '2026-10' }), '23514', 'commission_lines_period_business_date');
});

it('refuses duplicate head and performer primary keys', async () => {
  const lineId = await insert();
  await expectPgError(head({ lineId }), '23505', 'commission_line_heads_pkey');
  await expectPgError(line({ lineId }), '23505', 'commission_lines_pkey');
});

it('refuses a performer row without its head', async () => {
  await expectPgError(line(), '23503', 'commission_lines_head_fk');
});

it('refuses branch and service from another business or tenant, and a customer from another tenant', async () => {
  await expectPgError(head({ branchId: OTHER_COMMISSION_IDS.branch }), '23503', 'commission_line_heads_branch_fk');
  await expectPgError(head({ branchId: B.branch }), '23503', 'commission_line_heads_branch_fk');
  await expectPgError(head({ serviceId: OTHER_COMMISSION_IDS.service }), '23503', 'commission_line_heads_service_fk');
  await expectPgError(head({ serviceId: B.service }), '23503', 'commission_line_heads_service_fk');
  await expectPgError(head({ customerId: B.customer }), '23503', 'commission_line_heads_customer_fk');
});

it('refuses an employee from another business or tenant', async () => {
  const lineId = await head();
  await expectPgError(line({ lineId, employeeId: OTHER_COMMISSION_IDS.employee }), '23503', 'commission_lines_employee_fk');
  await expectPgError(line({ lineId, employeeId: B.employee }), '23503', 'commission_lines_employee_fk');
});

const foreignLineReferences = [
  ['branch of another business', { branchId: OTHER_COMMISSION_IDS.branch }, 'commission_lines_branch_fk'],
  ['branch that does not exist', { branchId: '01920000-0000-7000-8000-00000000e401' }, 'commission_lines_branch_fk'],
  ['service of another business', { serviceId: OTHER_COMMISSION_IDS.service }, 'commission_lines_service_fk'],
  ['service that does not exist', { serviceId: '01920000-0000-7000-8000-00000000e402' }, 'commission_lines_service_fk'],
] as const;

it.each(foreignLineReferences)('refuses a performer row with a %s', async (_label, row, constraint) => {
  const lineId = await head();
  await expectPgError(line({ lineId, ...row }), '23503', constraint);
});

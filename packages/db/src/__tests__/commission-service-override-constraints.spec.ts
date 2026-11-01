import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError, OTHER_COMMISSION_IDS } from '../../test/commission-statement-fixtures.ts';
import {
  commissionServiceOverrideInsertWithout,
  expectPgErrorAmong,
  insertCommissionServiceOverride,
  seedCommissionServiceOverrideTenants,
  SERVICE_OVERRIDE_IDS,
  SERVICE_OVERRIDE_TENANTS,
} from '../../test/commission-service-override-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const tenant = SERVICE_OVERRIDE_TENANTS.A;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionServiceOverrideTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const insert = (row: Record<string, unknown> = {}) =>
  db.withTenant(tenant.company, (tx) => insertCommissionServiceOverride(tx, tenant, ids, row));

it('stores every valid kind and keeps the valueless kinds valueless', async () => {
  await insert({ ruleKind: 'FOLLOW_PLAN', effectiveFrom: '2026-11-02' });
  await insert({ ruleKind: 'ZERO', effectiveFrom: '2026-11-02' });
  await insert({ ruleKind: 'PCT', rulePctBps: 0, effectiveFrom: '2026-11-02' });
  await insert({ ruleKind: 'PCT', rulePctBps: 10_000, effectiveFrom: '2026-11-02' });
  await insert({ ruleKind: 'FIXED', ruleFixedAmount: '0.000', effectiveFrom: '2026-11-02' });
  await insert({
    ruleKind: 'FIXED',
    ruleFixedAmount: '99999999999.999',
    effectiveFrom: '2026-11-02',
  });
  // الفلتر على تاريخ السطور دي بس، عشان ما يتأثرش الاختبار بصفوف الاختبارات التانية.
  const rows = await db.withTenant(tenant.company, (tx) =>
    tx.execute<{
      rule_kind: string;
      rule_pct_bps: number | null;
      rule_fixed_amount: string | null;
    }>(
      sql`SELECT rule_kind,rule_pct_bps,rule_fixed_amount FROM commission_service_overrides
        WHERE effective_from='2026-11-02'
        ORDER BY rule_kind,rule_pct_bps,rule_fixed_amount`,
    ),
  );
  // المبلغ الثابت راجع نص مش number: الفلوس مش بتتحوّل لعدد عشري.
  expect(rows).toEqual([
    { rule_kind: 'FIXED', rule_pct_bps: null, rule_fixed_amount: '0.000' },
    { rule_kind: 'FIXED', rule_pct_bps: null, rule_fixed_amount: '99999999999.999' },
    { rule_kind: 'FOLLOW_PLAN', rule_pct_bps: null, rule_fixed_amount: null },
    { rule_kind: 'PCT', rule_pct_bps: 0, rule_fixed_amount: null },
    { rule_kind: 'PCT', rule_pct_bps: 10_000, rule_fixed_amount: null },
    { rule_kind: 'ZERO', rule_pct_bps: null, rule_fixed_amount: null },
  ]);
});

it('refuses FOLLOW_SERVICE in the override rule CHECK', async () => {
  await expectPgError(
    insert({ ruleKind: 'FOLLOW_SERVICE' }),
    '23514',
    'commission_service_overrides_rule_kind',
  );
});

it('the catalog keeps its four kinds: FOLLOW_SERVICE is refused in services', async () => {
  await expectPgError(
    db.withTenant(tenant.company, (tx) =>
      tx.execute(sql`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
        VALUES(${tenant.company},${ids.newId()},${tenant.business},'Forbidden catalog kind',1.000,'FOLLOW_SERVICE')`),
    ),
    '23514',
    'services_rule_kind',
  );
});

it('refuses an unknown kind', async () => {
  await expectPgError(
    insert({ ruleKind: 'MIXED' }),
    '23514',
    'commission_service_overrides_rule_kind',
  );
});

it('refuses a null kind', async () => {
  await expectPgError(insert({ ruleKind: null }), '23502');
});

const invalidRuleShapes: {
  label: string;
  row: Record<string, unknown>;
  constraint: string;
}[] = [
  {
    label: 'PCT without a bps value',
    row: { ruleKind: 'PCT' },
    constraint: 'commission_service_overrides_rule_pct_present',
  },
  {
    label: 'ZERO with a bps value',
    row: { ruleKind: 'ZERO', rulePctBps: 10 },
    constraint: 'commission_service_overrides_rule_pct_present',
  },
  {
    label: 'FOLLOW_PLAN with a bps value',
    row: { ruleKind: 'FOLLOW_PLAN', rulePctBps: 10 },
    constraint: 'commission_service_overrides_rule_pct_present',
  },
  {
    label: 'FIXED with an extra bps value',
    row: { ruleKind: 'FIXED', ruleFixedAmount: '1.000', rulePctBps: 10 },
    constraint: 'commission_service_overrides_rule_pct_present',
  },
  {
    label: 'FIXED without an amount',
    row: { ruleKind: 'FIXED' },
    constraint: 'commission_service_overrides_rule_fixed_present',
  },
  {
    label: 'ZERO with an amount',
    row: { ruleKind: 'ZERO', ruleFixedAmount: '1.000' },
    constraint: 'commission_service_overrides_rule_fixed_present',
  },
  {
    label: 'FOLLOW_PLAN with an amount',
    row: { ruleKind: 'FOLLOW_PLAN', ruleFixedAmount: '1.000' },
    constraint: 'commission_service_overrides_rule_fixed_present',
  },
];

it.each(invalidRuleShapes)('refuses $label', async ({ row, constraint }) => {
  await expectPgError(insert(row), '23514', constraint);
});

it('refuses a PCT value with a fixed amount beside it', async () => {
  await expectPgError(
    insert({ ruleKind: 'PCT', rulePctBps: 1500, ruleFixedAmount: '1.000' }),
    '23514',
    'commission_service_overrides_rule_fixed_present',
  );
});

it.each([-1, 10_001])('refuses the bps value %i', async (bps) => {
  await expectPgError(
    insert({ ruleKind: 'PCT', rulePctBps: bps }),
    '23514',
    'commission_service_overrides_rule_pct_bounds',
  );
});

it('refuses a negative fixed amount', async () => {
  await expectPgError(
    insert({ ruleKind: 'FIXED', ruleFixedAmount: '-1.000' }),
    '23514',
    'commission_service_overrides_rule_fixed_nonnegative',
  );
});

it('refuses a fixed amount above numeric(14,3)', async () => {
  await expectPgError(insert({ ruleKind: 'FIXED', ruleFixedAmount: '100000000000.000' }), '22003');
});

it.each([
  'company_id',
  'id',
  'business_id',
  'employee_id',
  'service_id',
  'effective_from',
  'created_at',
  'created_by',
])('refuses a row without %s', async (missing) => {
  // الإدراج كـ owner: إثبات قيد NOT NULL على العمود، بعيداً عن سياسة العزل (الـ owner بيتخطاها).
  const query = commissionServiceOverrideInsertWithout(tenant, ids, missing);
  await expectPgError(Promise.resolve(owner.unsafe(query.text, query.params)), '23502');
});

it('refuses a duplicate id inside one company', async () => {
  const id = ids.newId();
  await insert({ id });
  await expectPgError(insert({ id }), '23505', 'commission_service_overrides_pkey');
});

it('refuses an employee of another business in the same company', async () => {
  await expectPgError(
    insert({ employeeId: OTHER_COMMISSION_IDS.employee }),
    '23503',
    'commission_service_overrides_employee_fk',
  );
});

it('refuses a service of another business in the same company', async () => {
  await expectPgError(
    insert({ serviceId: SERVICE_OVERRIDE_IDS.otherBusinessService }),
    '23503',
    'commission_service_overrides_service_fk',
  );
});

it('refuses an employee of another company', async () => {
  await expectPgError(
    insert({ employeeId: SERVICE_OVERRIDE_TENANTS.B.employee }),
    '23503',
    'commission_service_overrides_employee_fk',
  );
});

it('refuses a service of another company', async () => {
  await expectPgError(
    insert({ serviceId: SERVICE_OVERRIDE_IDS.serviceB }),
    '23503',
    'commission_service_overrides_service_fk',
  );
});

it('refuses a creator that does not exist', async () => {
  await expectPgError(
    insert({ createdBy: '01920000-0000-7000-8000-0000000000ff' }),
    '23503',
    'commission_service_overrides_created_by_user_id_fk',
  );
});

it('refuses a business that belongs to another company', async () => {
  // النشاط الغلط بيكسر مفتاح النشاط ومفتاح الموظف ومفتاح الخدمة في نفس الوقت،
  // وPostgreSQL بيبلّغ عن واحد منهم بس حسب ترتيب التيجر.
  await expectPgErrorAmong(insert({ businessId: SERVICE_OVERRIDE_TENANTS.B.business }), '23503', [
    'commission_service_overrides_business_fk',
    'commission_service_overrides_employee_fk',
    'commission_service_overrides_service_fk',
  ]);
});

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { commissionServiceOverridesStatement } from '../queries/commission-service-overrides.query.ts';
import { closeCommissionFixture } from './commission-plan-versions.fixture.ts';
import {
  businessToday,
  commissionServiceOverridesFixture,
  shiftDate,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeAll(async () => {
  f = await commissionServiceOverridesFixture();
  const today = await businessToday(f);
  // سجل واقعي من مئتي تغيير على خدمة موجودة؛ الصفوف كلها تحافظ على المفتاح الأجنبي.
  await f.h.owner`INSERT INTO commission_service_overrides(
    company_id,id,business_id,employee_id,service_id,rule_kind,rule_pct_bps,rule_fixed_amount,
    effective_from,created_at,created_by)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.employee},${f.service},
      'ZERO',NULL,NULL,${shiftDate(today, -1)}::date,now(),${f.userId} FROM generate_series(1, 200)`;
  await f.h.owner`ANALYZE commission_service_overrides`;
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('the list plan reads the table through an index and never with a sequential scan', async () => {
  const scope = {
    companyId: f.company,
    businessId: f.business,
    employeeId: f.employee,
    serviceId: undefined,
  };
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionServiceOverridesStatement(scope, { limit: 20 }, 'Asia/Kuwait')}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toContain('commission_service_overrides_employee_service_idx');
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Incremental Sort"');
  });
});

it('the filtered list plan still reads the table through an index', async () => {
  const scope = {
    companyId: f.company,
    businessId: f.business,
    employeeId: f.employee,
    serviceId: f.service,
  };
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionServiceOverridesStatement(scope, { limit: 20 }, 'Asia/Kuwait')}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toMatch(/commission_service_overrides_(employee_service|service)_idx/);
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Incremental Sort"');
  });
});

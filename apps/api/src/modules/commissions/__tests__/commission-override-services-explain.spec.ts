import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { commissionOverrideServicesStatement } from '../../../../test/harness.ts';
import { closeCommissionFixture } from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';
import { commissionOverrideCurrentStatement } from '../queries/commission-override-services.query.ts';

let f: CommissionServiceOverrideFixture;

const scope = (): Parameters<typeof commissionOverrideCurrentStatement>[0] => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  employeeId: f.employee,
});

beforeAll(async () => {
  f = await commissionServiceOverridesFixture();
  // بيانات تمثيلية: مئتا تجاوز على خدمة موجودة، وخدمة تانية لنشاط تاني في نفس الشركة،
  // عشان خطة الجملة الأولى تتحقق على شركة فيها أكتر من نشاط (شرط الخطة §3.1).
  await f.h.owner`INSERT INTO commission_service_overrides(
    company_id,id,business_id,employee_id,service_id,rule_kind,rule_pct_bps,rule_fixed_amount,
    effective_from,created_at,created_by)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.employee},${f.service},
      'ZERO',NULL,NULL,CURRENT_DATE,now(),${f.userId} FROM generate_series(1, 200)`;
  await f.h.owner`ANALYZE services`;
  await f.h.owner`ANALYZE commission_service_overrides`;
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('the services page plan reads the catalog through an index with no sort', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionOverrideServicesStatement(f.company, f.business, {
        limit: 50,
      })}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toMatch(/services_(company_business_id_key|pkey)/);
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Incremental Sort"');
  });
});

it('the services page plan keeps its index on a later page too', async () => {
  const page = await f.db.withTenant(f.company, (tx) =>
    tx.execute(commissionOverrideServicesStatement(f.company, f.business, { limit: 1 })),
  );
  const cursor = (page[0] as { id: string } | undefined)?.id;
  expect(cursor).toBeDefined();
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionOverrideServicesStatement(f.company, f.business, {
        ...(cursor === undefined ? {} : { cursor }),
        limit: 50,
      })}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toMatch(/services_(company_business_id_key|pkey)/);
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Incremental Sort"');
  });
});

it('the current-override plan reads the employee/service index with no sort', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionOverrideCurrentStatement(scope(), [f.service], 'Asia/Kuwait')}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toContain('commission_service_overrides_employee_service_idx');
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toContain('"Node Type":"Incremental Sort"');
  });
});

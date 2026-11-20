import { sql } from 'drizzle-orm';

import type { IdGenerator, Tx } from '../src/index.ts';
import {
  seedCommissionStatementTenants,
  type CommissionTenant,
} from './commission-statement-fixtures.ts';
import { USER } from './tenancy-fixtures.ts';

const defaultPlan = {
  base: { enabled: false },
  tiers: { enabled: false },
  package_sale: { enabled: false },
};

/** يجهز الشركة والنشاط والفرع والموظف والمستخدم اللازمين لمفاتيح إصدار الخطة. */
export async function seedCommissionPlanVersionTenants(ownerUrl: string): Promise<void> {
  await seedCommissionStatementTenants(ownerUrl);
}

/** يدرج نسخة صالحة افتراضياً مع إتاحة تغيير حقل واحد في اختبارات القيود والعزل. */
export async function insertCommissionPlanVersion(
  tx: Tx,
  tenant: CommissionTenant,
  ids: IdGenerator,
  row: Record<string, unknown> = {},
): Promise<void> {
  const value = (key: string, fallback: unknown) => (key in row ? row[key] : fallback);
  // نسخة الإصلاح بتسري من أول يوم في شهرها (Q2)، فالافتراضي بيتشتق من شهر الإصلاح؛ والشهر المشوّه
  // بيفضل على الافتراضي العادي، عشان رفضه يكون من فحص الشهر مش من نص تاريخ ما ينفعش أصلاً.
  const repairPeriod = value('repairPeriod', null) as string | null;
  const realRepairMonth =
    repairPeriod !== null &&
    /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(repairPeriod) &&
    repairPeriod.slice(0, 4) !== '0000';
  const effectiveFrom = realRepairMonth ? `${repairPeriod}-01` : '2026-10-25';
  await tx.execute(sql`INSERT INTO commission_plan_versions(
    company_id,id,business_id,employee_id,version,effective_from,whole_period,repair_period,plan,created_by)
    VALUES (${value('companyId', tenant.company)},${ids.newId()},${value('businessId', tenant.business)},
      ${value('employeeId', tenant.employee)},${value('version', 1)},
      ${value('effectiveFrom', effectiveFrom)},
      ${value('wholePeriod', false)},${repairPeriod},
      ${JSON.stringify(value('plan', defaultPlan))}::jsonb,${value('createdBy', USER)})`);
}

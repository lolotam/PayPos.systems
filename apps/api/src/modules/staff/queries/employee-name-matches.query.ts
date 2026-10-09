import {
  employeeNameMatches as responseSchema,
  type EmployeeNameMatches,
  type EmployeeNameMatchesInput,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

export interface EmployeeNameMatchKeys {
  readonly name_en_key: string;
  readonly name_ar_key: string | null;
  readonly exclude_employee_id?: string;
}

// المفتاح بيتحسب بقاعدة packages/domain الوحيدة، عشان المقارنة تطابق المفاتيح المخزّنة وقت الحفظ بالظبط.
export function matchKeysOf(input: EmployeeNameMatchesInput): EmployeeNameMatchKeys {
  return {
    name_en_key: employeeNameMatchKey(input.name_en),
    name_ar_key: input.name_ar == null ? null : employeeNameMatchKey(input.name_ar),
    ...(input.exclude_employee_id === undefined
      ? {}
      : { exclude_employee_id: input.exclude_employee_id }),
  };
}

// استمارتا إنشاء وتعديل الموظف تعرضان تفاصيل التطابق المرئي فقط ووجود تطابق مخفي دون عدده.
export function employeeNameMatchesStatement(
  companyId: string,
  businessId: string,
  input: EmployeeNameMatchKeys,
  allowedBranches: readonly string[],
) {
  return sql`WITH allowed_branches AS (
    SELECT jsonb_array_elements_text(${JSON.stringify(allowedBranches)}::jsonb)::uuid AS id
  ), matched AS MATERIALIZED (
    SELECT e.id, e.name_en, e.name_ar, e.primary_branch_id, e.role_code,
      (e.primary_branch_id IN (SELECT id FROM allowed_branches)
        AND NOT EXISTS (SELECT 1 FROM employee_branches eb
          WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL
          AND eb.branch_id NOT IN (SELECT id FROM allowed_branches))) AS visible
    FROM employees e
    WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.deleted_at IS NULL
      ${input.exclude_employee_id === undefined ? sql`` : sql`AND e.id <> ${input.exclude_employee_id}`}
      AND (e.name_en_key = ${input.name_en_key}
        OR (e.name_ar_key IS NOT NULL AND ${input.name_ar_key}::text IS NOT NULL
          AND e.name_ar_key = ${input.name_ar_key}))
  ), visible_matches AS (
    SELECT id, name_en, name_ar, primary_branch_id, role_code FROM matched
    WHERE visible ORDER BY name_en, id LIMIT 10
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.name_en, v.id) FROM visible_matches v), '[]'::jsonb) AS matches,
    count(*) FILTER (WHERE visible)::int AS visible_total,
    COALESCE(bool_or(NOT visible), false) AS hidden_exists FROM matched`;
}

export async function employeeNameMatches(
  tx: Tx,
  companyId: string,
  businessId: string,
  userId: string,
  input: EmployeeNameMatchesInput,
  access: EmployeeDetailAccess,
): Promise<EmployeeNameMatches | 'FORBIDDEN' | 'FEATURE_DISABLED'> {
  const decision = await access.listScope(tx, companyId, userId, businessId);
  if (decision.allowedBranchIds.length === 0) return 'FORBIDDEN';
  if (!decision.featureEnabled) return 'FEATURE_DISABLED';
  const [row] = await tx.execute(
    employeeNameMatchesStatement(
      companyId,
      businessId,
      matchKeysOf(input),
      decision.allowedBranchIds,
    ),
  );
  return responseSchema.parse(row);
}

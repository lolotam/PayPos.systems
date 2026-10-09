import {
  employeeNameMatches as responseSchema,
  type EmployeeNameMatches,
  type EmployeeNameMatchesInput,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

// رموز Unicode هنا قواعد مطابقة وليست نصوص واجهة؛ نفس التعبير يخدم العمود والمعامل.
const nameKey = (value: SQL) => sql`btrim(regexp_replace(lower(translate(
  regexp_replace(normalize(${value}::text, NFKC), U&'[\\064B-\\0652\\0670\\0640]', '', 'g'),
  U&'\\0623\\0625\\0622\\0671\\0629\\0649', U&'\\0627\\0627\\0627\\0627\\0647\\064A'
)), '\\s+', ' ', 'g'))`;

// استمارتا إنشاء وتعديل الموظف تعرضان تفاصيل التطابق المرئي فقط، وعدداً بلا تفاصيل لباقي الفروع.
export function employeeNameMatchesStatement(
  companyId: string,
  businessId: string,
  input: EmployeeNameMatchesInput,
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
      AND (${nameKey(sql`e.name_en`)} = ${nameKey(sql`${input.name_en}`)}
        OR (e.name_ar IS NOT NULL AND ${input.name_ar ?? null}::text IS NOT NULL
          AND ${nameKey(sql`e.name_ar`)} = ${nameKey(sql`${input.name_ar ?? null}`)}))
  ), visible_matches AS (
    SELECT id, name_en, name_ar, primary_branch_id, role_code FROM matched
    WHERE visible ORDER BY name_en, id LIMIT 10
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.name_en, v.id) FROM visible_matches v), '[]'::jsonb) AS matches,
    count(*) FILTER (WHERE visible)::int AS visible_total,
    count(*) FILTER (WHERE NOT visible)::int AS hidden_count FROM matched`;
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
    employeeNameMatchesStatement(companyId, businessId, input, decision.allowedBranchIds),
  );
  return responseSchema.parse(row);
}

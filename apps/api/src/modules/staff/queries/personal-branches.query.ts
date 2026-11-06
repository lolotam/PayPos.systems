import { personalBranches, type PersonalBranches } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';

export const PERSONAL_BRANCH_READS = Symbol('PERSONAL_BRANCH_READS');
export interface PersonalBranchContext {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
}
export interface PersonalBranchReads {
  /** أسماء الفروع من مالك البيانات بنفس المعاملة. */
  workspaces(tx: Tx, businessId: string): Promise<PersonalBranches['items']>;
  /** عضوية حية لإثبات سياق الموظفة دون منح صلاحيات تجارية. */
  memberships(
    tx: Tx,
    context: PersonalBranchContext,
    now: Date,
  ): Promise<
    readonly {
      scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH';
      scope_id: string;
    }[]
  >;
}

// شاشة إجازاتي: فروع الموظفة النشطة فقط.
export function personalBranchesStatement(
  c: PersonalBranchContext,
  branches: PersonalBranches['items'],
  now: Date,
) {
  return sql`SELECT b.id,b.name_ar,b.name_en,b.timezone
    FROM employees e JOIN employee_branches eb ON eb.company_id=e.company_id AND eb.employee_id=e.id
    JOIN jsonb_to_recordset(${JSON.stringify(branches)}::jsonb)
      AS b(id uuid,name_ar text,name_en text,timezone text) ON b.id=eb.branch_id
    WHERE e.company_id=${c.companyId} AND e.business_id=${c.businessId}
      AND e.id=${c.employeeId} AND e.user_id=${c.userId} AND e.deleted_at IS NULL
      AND e.hire_date<=(${now.toISOString()}::timestamptz AT TIME ZONE b.timezone)::date
      AND (e.contract_end IS NULL OR e.contract_end>=(${now.toISOString()}::timestamptz AT TIME ZONE b.timezone)::date)
      AND eb."from"<=(${now.toISOString()}::timestamptz AT TIME ZONE b.timezone)::date
      AND (eb."to" IS NULL OR eb."to">(${now.toISOString()}::timestamptz AT TIME ZONE b.timezone)::date)
    ORDER BY b.id`;
}
export async function readPersonalBranches(
  tx: Tx,
  c: PersonalBranchContext,
  now: Date,
  reads: PersonalBranchReads,
): Promise<PersonalBranches> {
  const memberships = await reads.memberships(tx, c, now);
  const branches = (await reads.workspaces(tx, c.businessId)).filter((b) =>
    memberships.some(
      (m) =>
        (m.scope_type === 'COMPANY' && m.scope_id === c.companyId) ||
        (m.scope_type === 'BUSINESS' && m.scope_id === c.businessId) ||
        (m.scope_type === 'BRANCH' && m.scope_id === b.id),
    ),
  );
  const items = await tx.execute<PersonalBranches['items'][number]>(
    personalBranchesStatement(c, branches, now),
  );
  if (items.length === 0) throw new ApiError('FORBIDDEN');
  return personalBranches.parse({ items: [...items] });
}

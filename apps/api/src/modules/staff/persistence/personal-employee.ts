import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { personalMemberships } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { personalMember } from '../domain/passkey-binding.ts';
import { scheduleToday } from '../domain/schedule-calendar.ts';

async function branchDays(tx: Tx, workspace: { companyId: string; businessId: string }, now: Date) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: workspace.businessId }]);
  const branches =
    tree?.id === workspace.companyId
      ? (tree.businesses.find((business) => business.id === workspace.businessId)?.branches ?? [])
      : [];
  return branches.flatMap((branch) => {
    try {
      return [{ branchId: branch.id, today: scheduleToday(now, branch.effective_timezone) }];
    } catch {
      // التاريخ المجهول لا يمنح أهلية لارتباط مؤرخ، حتى لو بقيت عضوية نشطة.
      return [];
    }
  });
}

/** employee_id يؤخذ من ربط المستخدم الموثق؛ لا يقبله هذا القارئ من المتصفح. */
export async function personalEmployee(
  tx: Tx,
  userId: string,
  workspace: { companyId: string; businessId: string },
  lock = false,
  clock: Clock = systemClock,
) {
  const { companyId, businessId } = workspace;
  const memberships = await personalMemberships(tx, companyId, userId, lock);
  const [employee] = await tx.execute<{ id: string; primary_branch_id: string }>(sql`
    SELECT id,primary_branch_id FROM employees WHERE company_id=${companyId}
      AND business_id=${businessId} AND user_id=${userId} AND deleted_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`);
  if (employee === undefined) return null;
  const days = await branchDays(tx, workspace, clock.now());
  const attached = await tx.execute<{
    branch_id: string;
  }>(sql`SELECT branch_id FROM employee_branches
    WHERE company_id=${companyId} AND employee_id=${employee.id}
      AND EXISTS (
        SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(
          days.map((day) => ({
            branch_id: day.branchId,
            today: day.today,
          })),
        )}::jsonb) AS local_day(branch_id uuid,today date)
        WHERE local_day.branch_id=employee_branches.branch_id
          AND "from"<=local_day.today AND ("to" IS NULL OR "to">local_day.today)
      )`);
  return personalMember(
    companyId,
    businessId,
    [employee.primary_branch_id, ...attached.map((r) => r.branch_id)],
    memberships,
  )
    ? employee.id
    : null;
}

/** قبل الإثبات لا نعيد بيانات الموظف للعميل؛ نتيجة الاستعداد والأهلية فقط. */
export function createPersonalEligibility(database: TenantWrappers, clock: Clock = systemClock) {
  const employee = (
    userId: string,
    workspace: { companyId: string; businessId: string },
    deadline?: Date,
  ) =>
    database.withTenant(
      workspace.companyId,
      (tx) => personalEmployee(tx, userId, workspace, false, clock),
      deadline === undefined
        ? {}
        : { timeoutMs: Math.max(1, deadline.getTime() - Date.now()), drainOnTimeout: true },
    );
  return {
    employee,
    eligible: async (
      userId: string,
      workspace: { companyId: string; businessId: string },
      deadline?: Date,
    ) => (await employee(userId, workspace, deadline)) !== null,
    deviceValid: async () => true,
  };
}

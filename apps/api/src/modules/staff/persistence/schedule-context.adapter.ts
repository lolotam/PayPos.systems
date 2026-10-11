import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { describeWorkspaces } from '../../tenancy/index.ts';
import { scheduleAccess } from '../../identity/index.ts';

export async function employeeHoursBranches(tx: Tx, companyId: string, businessId: string) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business = tree?.id === companyId ? tree.businesses.find((b) => b.id === businessId) : undefined;
  return business?.branches.map((branch) => ({ id: branch.id, timezone: branch.effective_timezone })) ?? [];
}

export async function attendanceReportWorkplaces(tx: Tx, companyId: string, businessId: string, branchId: string, month?: string) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business = tree?.id === companyId ? tree.businesses.find((entry) => entry.id === businessId) : undefined;
  if (!business) return null;
  const historical = branchId === 'all' && month !== undefined ? await tx.execute<{ branch_id: string }>(sql`
    SELECT DISTINCT branch_id FROM attendance_sessions WHERE company_id=${companyId} AND business_id=${businessId}
      AND working_date>=(${month}||'-01')::date AND working_date<((${month}||'-01')::date+interval '1 month')
    UNION SELECT DISTINCT branch_id FROM employee_branches WHERE company_id=${companyId} AND business_id=${businessId}
      AND "from"<((${month}||'-01')::date+interval '1 month')
      AND ("to" IS NULL OR "to">(${month}||'-01')::date)`) : [];
  const historicalIds = new Set(historical.map((row) => row.branch_id));
  return { businessId: business.id, branches: business.branches
    .filter((branch) => branchId === 'all' ? branch.is_active || historicalIds.has(branch.id) : branch.id === branchId)
    .map((branch) => ({ id: branch.id, timezone: branch.effective_timezone })) };
}

export async function schedulingContext(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string | null,
) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business =
    tree?.id === companyId ? tree.businesses.find((b) => b.id === businessId) : undefined;
  if (!business) return null;
  if (branchId === null)
    return {
      timezone: 'Asia/Kuwait',
      branchIds: business.branches
        .filter((b) => b.is_active)
        .map((b) => b.id)
        .sort(),
    };
  const branch = business.branches.find((b) => b.id === branchId && b.is_active);
  return branch ? { timezone: branch.effective_timezone } : null;
}
export function schedulingAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
  action: 'read' | 'manage' | 'settings',
  lock = false,
) {
  return scheduleAccess(tx, companyId, userId, { businessId, branchId, action }, lock);
}

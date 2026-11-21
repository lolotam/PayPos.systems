import type { Tx } from '@pospay/db';
import { readOwnRatingsAccess } from '../../identity/index.ts';
import { readOwnEmployee } from '../../staff/index.ts';
import { activeBusinessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';

export async function ownRatingContext(
  tx: Tx,
  c: {
    companyId: string;
    businessId: string;
    userId: string;
  },
  now: Date,
) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: c.businessId }]);
  const business =
    tree?.id === c.companyId ? tree.businesses.find((b) => b.id === c.businessId) : null;
  if (!business) return null;
  const branches = business.branches.filter((b) => b.is_active);
  const employee = await readOwnEmployee(tx, { ...c, branches }, now);
  if (!employee) return null;
  const allowed = await readOwnRatingsAccess(
    tx,
    {
      ...c,
      subjectUserId: employee.userId,
      branchIds: employee.branchIds,
    },
    now,
  );
  const branchId = allowed[0];
  if (!branchId) return null;
  const timeZone = await activeBusinessTimeZone(tx, c.companyId, c.businessId, branchId);
  if (!timeZone) return null;
  return { employeeId: employee.employeeId, timeZone };
}

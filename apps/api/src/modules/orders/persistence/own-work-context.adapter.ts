import type { Tx } from '@pospay/db';
import { readOwnServiceSessionsAccess } from '../../identity/index.ts';
import { readOwnEmployee } from '../../staff/index.ts';
import { activeBusinessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';

export async function ownWorkContext(
  tx: Tx,
  c: {
    companyId: string;
    businessId: string;
    userId: string;
    branchId?: string;
  },
  now: Date,
) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: c.businessId }]);
  const business =
    tree?.id === c.companyId ? tree.businesses.find((b) => b.id === c.businessId) : null;
  if (!business) return null;
  const branches = business.branches.filter(
    (b) => b.is_active && (c.branchId === undefined || b.id === c.branchId),
  );
  const employee = await readOwnEmployee(tx, { ...c, branches }, now);
  if (!employee) return null;
  const allowed = await readOwnServiceSessionsAccess(
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
  const timezone = await activeBusinessTimeZone(tx, c.companyId, c.businessId, branchId);
  if (!timezone) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    employeeId: employee.employeeId,
    currentMonth: `${part('year')}-${part('month')}`,
    branches: business.branches.map((b) => ({ id: b.id, name_ar: b.name_ar, name_en: b.name_en })),
  };
}

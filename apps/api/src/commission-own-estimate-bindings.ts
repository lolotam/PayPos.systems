import type { Tx } from '@pospay/db';

import { readCommissionServiceNames } from './modules/catalog/index.ts';
import { ownCommissionEstimateProviders } from './modules/commissions/index.ts';
import { readOwnCommissionsAccess } from './modules/identity/index.ts';
import { readOwnEmployee } from './modules/staff/index.ts';
import { activeBusinessTimeZone, describeWorkspaces } from './modules/tenancy/index.ts';
import type { Clock } from './shared/ports/clock.port.ts';

/**
 * سياق الموظفة لتقدير عمولتي: الشجرة والموظفة وصلاحية read:commissions:own وتوقيت النشاط، كلها على
 * معاملة القراءة نفسها. بيرجع null لأي فشل فيهم، والمسار بيحوّله لرفض موحّد.
 */
async function ownCommissionEstimateContext(
  tx: Tx,
  c: { companyId: string; businessId: string; userId: string; branchId?: string },
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
  const allowed = await readOwnCommissionsAccess(
    tx,
    { ...c, subjectUserId: employee.userId, branchIds: employee.branchIds },
    now,
  );
  const branchId = allowed[0];
  if (!branchId) return null;
  const timeZone = await activeBusinessTimeZone(tx, c.companyId, c.businessId, branchId);
  if (!timeZone) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    employeeId: employee.employeeId,
    currentMonth: `${part('year')}-${part('month')}`,
    timeZone,
  };
}

/**
 * ما بيربطه الجذر لتقدير عمولتي (57-3): سياق الموظفة من identity وstaff وtenancy، وأسماء الخدمات من
 * الكتالوج. في ملف مستقل لإبقاء app.ts تحت حد الأسطر.
 *
 * @param clock ساعة الطلب
 * @returns مزودو Nest
 */
export function commissionOwnEstimateBindings(clock?: Clock) {
  return ownCommissionEstimateProviders(
    { context: ownCommissionEstimateContext, serviceNames: readCommissionServiceNames },
    clock,
  );
}

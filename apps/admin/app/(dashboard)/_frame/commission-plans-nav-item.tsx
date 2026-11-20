'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Star } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { planScope, usePlanAccess } from '@/commissions/api/plan-access';
import { useCommissionPlanEmployees } from '@/commissions/api/use-commission-plan-employees';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

/**
 * مدخل منشئ الخطط في القائمة: بيبان بس لما صلاحية الخطط تتأكد بصفحة موظفين ناجحة،
 * ويختفي لحظة قفل الوصول عشان اللي ملوش الصلاحية ما يشوفش لينك بيرد عليه 403.
 */
export function CommissionPlansNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const scope =
    ready?.business !== undefined && ready.business !== null && userId !== null
      ? planScope(ready.company.id, ready.business.id, userId)
      : null;
  const access = usePlanAccess(scope);
  const employees = useCommissionPlanEmployees(scope);
  // البيانات المحفوظة هي الشرط مش isSuccess: إعادة جلب خلفية فاشلة ما بيخفيش اللينك، والقفل بس هو اللي بيخفيه.
  if (scope === null || employees.data === undefined || access.denied) return null;
  return (
    <AppSidebarItem
      asChild
      icon={<Star />}
      label={t(locale, 'commissionPlanBuilder.navTitle')}
      active={pathname === '/commissions/plans'}
    >
      <Link href="/commissions/plans" />
    </AppSidebarItem>
  );
}

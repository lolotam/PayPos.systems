'use client';
import { t } from '@pospay/i18n';
import { ServiceSessionDayPage } from '@/orders/pages/service-session-day-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function ServiceSessionDayRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  // الفرع لازم يكون مختار صراحةً؛ أول فرع في النشاط مش افتراض لقائمة اليوم.
  if (!workspace.branch) return <p>{t(locale, 'serviceSessions.chooseBranch')}</p>;
  const scope = { companyId: workspace.company.id, businessId: workspace.business.id, branchId: workspace.branch.id, userId };
  return <ServiceSessionDayPage key={`${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}`} scope={scope} timezone={workspace.branch.effective_timezone} />;
}

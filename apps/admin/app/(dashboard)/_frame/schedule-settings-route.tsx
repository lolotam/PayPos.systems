'use client';
import { t } from '@pospay/i18n';
import { ScheduleSettingsPage } from '@/staff/pages/schedule-settings-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
export function ScheduleSettingsRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    // الصفحة على مستوى النشاط، فتفتح بلا فرع؛ وقسم الفرع في اللوحة بيظهر بس لما يكون في فرع مختار.
    branchId: workspace.branch?.id ?? '',
    userId,
  };
  return (
    <ScheduleSettingsPage
      key={`${scope.companyId}:${scope.businessId}:${scope.branchId}:${userId}`}
      scope={scope}
    />
  );
}

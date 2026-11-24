'use client';
import { t } from '@pospay/i18n';
import { useSearchParams } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { EmployeeDetailPage } from '@/staff/pages/employee-detail-page';
import { employeeDetailQueryTab } from '@/staff/model/employee-detail-tabs';

/** راوت صفحة الموظف: `tab="leave"` من مسار الإجازات، وغيره يقرأ `?tab=` ويعود لـ«البيانات» عند المجهول. */
export function EmployeeDetailRoute({
  employeeId,
  tab,
}: {
  employeeId: string;
  tab?: 'leave';
}) {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const queryTab = employeeDetailQueryTab(useSearchParams().get('tab'));
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <EmployeeDetailPage
      key={`${workspace.company.id}:${workspace.business.id}:${userId}:${employeeId}`}
      companyId={workspace.company.id}
      business={workspace.business}
      userId={userId}
      employeeId={employeeId}
      tab={tab ?? queryTab}
    />
  );
}

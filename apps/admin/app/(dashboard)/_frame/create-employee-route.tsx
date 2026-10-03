'use client';
import { t } from '@pospay/i18n';
import { CreateEmployeePage } from '@/staff/pages/create-employee-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function CreateEmployeeRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <CreateEmployeePage
      key={`${workspace.company.id}:${workspace.business.id}:${userId}`}
      companyId={workspace.company.id}
      business={workspace.business}
      userId={userId}
    />
  );
}

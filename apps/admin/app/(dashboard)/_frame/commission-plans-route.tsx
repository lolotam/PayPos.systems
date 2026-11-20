'use client';

import { t } from '@pospay/i18n';
import { useSessionUser } from '@/session/api/use-session';
import { CommissionPlansPage } from '@/commissions/pages/commission-plans-page';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

/** مسار منشئ الخطط: الهوية هي مفتاح الصفحة عشان تغييرها يعيد الشاشة من الصفر بكاش فاضي. */
export function CommissionPlansRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  return (
    <CommissionPlansPage
      key={`${workspace.company.id}:${workspace.business.id}:${userId}`}
      companyId={workspace.company.id}
      userId={userId}
      businessId={workspace.business.id}
    />
  );
}

'use client';
import { t } from '@pospay/i18n';
import { CustomerPackagesPage } from '@/orders/pages/customer-packages-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

/**
 * راوت باقات العميلة: نفس بناء النطاق بتاع راوت بيع الباقة بنفس رسائل «اختار نشاط/فرع»،
 * والقيد على company:business:branch:user:customer عشان تغيير النطاق أو العميلة يقفل
 * التفصيل والحوار المفتوح ويجيب بيانات النطاق الجديد بس.
 */
export function CustomerPackagesRoute({ customerId }: { customerId: string }) {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  if (!workspace.branch) return <p>{t(locale, 'serviceSessions.chooseBranch')}</p>;
  const scope = {
    companyId: workspace.company.id,
    businessId: workspace.business.id,
    branchId: workspace.branch.id,
    userId,
  };
  return (
    <CustomerPackagesPage
      key={`${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}:${customerId}`}
      scope={scope}
      customerId={customerId}
    />
  );
}

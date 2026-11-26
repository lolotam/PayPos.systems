'use client';
import { t } from '@pospay/i18n';
import { CustomerImportPage } from '@/customers/pages/customer-import-page';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { businessScope } from '@/workspace/model/business-scope';

/**
 * راوت استيراد العملاء: مدير النشاط يستورد على مستوى النشاط، ومدير الفرع والكاشير على فرعهم فقط (CI-Q4، CI-T5).
 * مفتاح العنصر يشمل الفرع عشان تغيير النطاق يمسح المعاينة والحالة المفتوحة.
 */
export function CustomerImportRoute() {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  if (workspace.status !== 'ready' || userId === null) return null;
  if (!workspace.business) return <p>{t(locale, 'admin.chooseBusiness')}</p>;
  // النطاق على النشاط المختار مش على الشركة: نشاط وصله اليوزر عن طريق فرع بس
  // استيرادُه على مستوى النشاط بيرد 403.
  const branchScoped = businessScope(workspace.business, workspace.company.scope) === 'BRANCH';
  if (branchScoped && !workspace.branch) return <p>{t(locale, 'customerImport.chooseBranch')}</p>;
  const branchId = branchScoped ? workspace.branch?.id : undefined;
  return (
    <CustomerImportPage
      key={`${workspace.company.id}:${workspace.business.id}:${branchId ?? 'business'}:${userId}`}
      companyId={workspace.company.id}
      business={workspace.business}
      {...(branchId ? { branchId } : {})}
      userId={userId}
    />
  );
}

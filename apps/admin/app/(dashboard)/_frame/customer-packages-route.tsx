'use client';
import { t } from '@pospay/i18n';
import { useSearchParams } from 'next/navigation';
import { CustomerPackagesPage } from '@/orders/pages/customer-packages-page';
import { resolveScopeHint } from '@/orders/model/resolve-scope-hint';
import { usePackageRouteSelection } from '@/orders/model/use-package-route-selection';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { CustomerPackagesScopeGate } from './customer-packages-scope-gate';

/**
 * راوت باقات العميلة: نفس بناء النطاق بتاع راوت بيع الباقة بنفس رسائل «اختار نشاط/فرع»،
 * والقيد على company:business:branch:user:customer عشان تغيير النطاق أو العميلة يقفل
 * التفصيل والحوار المفتوح ويجيب بيانات النطاق الجديد بس.
 * تلميحات النطاق من روابط التبويب الجديد (ids بس) بتتحقق ضد قايمة الجلسة نفسها: تطابق → متابعة،
 * وعدم تطابق → رفض واضح وزر تبديل بإرادة المستخدم (مفيش كتابة تلقائية في الكوكيز المشتركة)،
 * والعنوان ما يمنش أي صلاحية — الخادم بيجدد الترخيص على كل طلب، ومفيش أسماء أو تليفونات أو PII.
 */
export function CustomerPackagesRoute({ customerId }: { customerId: string }) {
  const locale = useLocale();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const searchParams = useSearchParams();
  const scopeKey =
    workspace.status === 'ready' && workspace.business && workspace.branch && userId !== null
      ? [workspace.company.id, workspace.business.id, workspace.branch.id, userId].join(':')
      : null;
  const selection = usePackageRouteSelection(scopeKey);
  if (workspace.status !== 'ready' || userId === null) return null;
  const hint = resolveScopeHint(
    {
      companyId: searchParams.get('scope_company') ?? undefined,
      businessId: searchParams.get('scope_business') ?? undefined,
      branchId: searchParams.get('scope_branch') ?? undefined,
    },
    workspace.companies,
    {
      company: workspace.company.id,
      business: workspace.business?.id,
      branch: workspace.branch?.id,
    },
  );
  if (!hint.matches) {
    return (
      <CustomerPackagesScopeGate
        hint={hint}
        onChoose={(choice) => {
          selection.adoptScope(
            [choice.companyId, choice.businessId, choice.branchId, userId].join(':'),
          );
          workspace.choose(choice);
        }}
      />
    );
  }
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
      selection={selection}
      customerId={customerId}
    />
  );
}

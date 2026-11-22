'use client';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { parsePackageRouteId } from '../model/customer-package-view';
import { type usePackageRouteSelection } from '../model/use-package-route-selection';
import { CustomerPackageList } from '../ui/customer-package-list';
import { PackagesSelectionArea } from '../ui/packages-selection-area';
import { usePackagePageList } from './use-package-page-list';

interface CustomerPackagesPageProps {
  scope: SessionServiceScope;
  customerId: string;
  selection: ReturnType<typeof usePackageRouteSelection>;
}

/**
 * شاشة باقات العميلة: العنوان عام ومفيش اسم عميلة ولا تليفون في العنوان ولا في الكاش (FR-A08، SC-005).
 * إثبات قراءة حالي قبل عرض أي بيانات من الكاش — انتظار أو رفض يخفي القايمة (r4654058100).
 * الباقة المفتوحة بتعيش في الاستعلام ?package= فزر الرجوع بيقفلها، ومقطع عميلة فاسخ يعرض
 * «غير موجود» من غير أي طلب.
 */
export function CustomerPackagesPage({ scope, customerId, selection }: CustomerPackagesPageProps) {
  const locale = useLocale();
  const { entitlementId, hasRawSelection, select, close } = selection;
  // المقطع الفاسخ للعميلة يعرض «غير موجود» من غير أي طلب (CP-02).
  const validCustomerId = parsePackageRouteId(customerId);
  const { proof, canShowPackages, listProps } = usePackagePageList(scope, validCustomerId);
  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'customerPackages.title')} />
      {validCustomerId === null ? (
        <p role="alert">{t(locale, 'customerPackages.notFound')}</p>
      ) : proof === 'refused' ? (
        <p role="alert">{t(locale, 'customerPackages.notAllowed')}</p>
      ) : proof === 'pending' ? (
        <p role="status">{t(locale, 'customerPackages.loading')}</p>
      ) : (
        <>
          <CustomerPackageList {...listProps} onSelect={select} selectedId={entitlementId} />
          {canShowPackages ? (
            <PackagesSelectionArea
              scope={scope}
              customerId={validCustomerId}
              entitlementId={entitlementId}
              hasRawSelection={hasRawSelection}
              onClose={close}
            />
          ) : null}
        </>
      )}
    </PageShell>
  );
}

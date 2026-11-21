'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackages } from '../api/use-customer-packages';
import type { SessionServiceScope } from '../api/use-session-services';
import { parsePackageRouteId } from '../model/customer-package-view';
import { packageListState, usePackageRouteSelection } from '../model/use-package-route-selection';
import { CustomerPackageDetail } from '../ui/customer-package-detail';
import { CustomerPackageList } from '../ui/customer-package-list';

/**
 * شاشة باقات العميلة: العنوان عام ومفيش اسم عميلة ولا تليفون في العنوان ولا في الكاش (FR-A08، SC-005).
 * الباقة المفتوحة بتعيش في الاستعلام ?package= فزر الرجوع بيقفلها، ومقطع عميلة فاسخ يعرض
 * «غير موجود» من غير أي طلب.
 */
export function CustomerPackagesPage({
  scope,
  customerId,
}: {
  scope: SessionServiceScope;
  customerId: string;
}) {
  const locale = useLocale();
  const { entitlementId, hasRawSelection, select, close } = usePackageRouteSelection();
  // المقطع الفاسخ للعميلة يعرض «غير موجود» من غير أي طلب (CP-02).
  const validCustomerId = parsePackageRouteId(customerId);
  const list = useCustomerPackages(scope, validCustomerId ?? customerId, validCustomerId !== null);
  const items = list.data?.items ?? [];
  const derived = packageListState({
    isError: list.isError,
    isPending: list.isPending,
    error: list.error,
    itemCount: items.length,
  });
  return (
    <section className="grid gap-4 text-start">
      <h1 className="text-lg font-semibold">{t(locale, 'customerPackages.title')}</h1>
      {validCustomerId === null ? (
        <p role="alert">{t(locale, 'customerPackages.notFound')}</p>
      ) : (
        <>
          <CustomerPackageList
            items={items}
            state={derived.state}
            errorMessage={derived.errorMessage}
            hasMore={list.hasNextPage}
            onRetry={() => void list.refetch()}
            onMore={() => void list.fetchNextPage()}
            onSelect={select}
            selectedId={entitlementId}
          />
          <PackagesSelectionArea
            scope={scope}
            customerId={validCustomerId}
            entitlementId={entitlementId}
            hasRawSelection={hasRawSelection}
            onClose={close}
          />
        </>
      )}
    </section>
  );
}

function PackagesSelectionArea({
  scope,
  customerId,
  entitlementId,
  hasRawSelection,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string | null;
  hasRawSelection: boolean;
  onClose: () => void;
}) {
  const locale = useLocale();
  if (entitlementId !== null) {
    return (
      <CustomerPackageDetail
        scope={scope}
        customerId={customerId}
        entitlementId={entitlementId}
        onClose={onClose}
      />
    );
  }
  if (hasRawSelection) {
    // قيمة ?package= فاسخ: تفصيل «غير موجود» من غير أي طلب تفصيل.
    return <p role="alert">{t(locale, 'customerPackages.detailNotFound')}</p>;
  }
  return null;
}

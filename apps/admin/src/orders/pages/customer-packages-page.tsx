'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useCustomerPackages } from '../api/use-customer-packages';
import type { SessionServiceScope } from '../api/use-session-services';
import { parsePackageRouteId } from '../model/customer-package-view';
import {
  packageListState,
  type usePackageRouteSelection,
} from '../model/use-package-route-selection';
import { CustomerPackageList } from '../ui/customer-package-list';
import { PackagesSelectionArea } from '../ui/packages-selection-area';

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
  const list = useCustomerPackages(
    scope,
    validCustomerId ?? customerId,
    validCustomerId !== null,
    true,
  );
  const proof = readAccessProof(list);
  const { state, errorMessage } = packageListState({
    isError: list.isError,
    isPending: list.isPending,
    error: list.error,
    itemCount: list.data?.items.length ?? 0,
  });
  const canShowPackages =
    proof === 'granted' || (list.isFetchNextPageError && errorMessage === 'loadFailed');
  return (
    <section className="grid gap-4 text-start">
      <h1 className="text-lg font-semibold">{t(locale, 'customerPackages.title')}</h1>
      {validCustomerId === null ? (
        <p role="alert">{t(locale, 'customerPackages.notFound')}</p>
      ) : proof === 'refused' ? (
        <p role="alert">{t(locale, 'customerPackages.notAllowed')}</p>
      ) : proof === 'pending' ? (
        <p role="status">{t(locale, 'customerPackages.loading')}</p>
      ) : (
        <>
          <CustomerPackageList
            items={canShowPackages ? (list.data?.items ?? []) : []}
            state={state}
            errorMessage={errorMessage}
            hasMore={list.hasNextPage}
            onRetry={() => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch())}
            onMore={() => void list.fetchNextPage()}
            onSelect={select}
            selectedId={entitlementId}
          />
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
    </section>
  );
}

'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { useAccessProof } from '@/shared/api/use-access-proof';
import { useCustomerPackages } from '../api/use-customer-packages';
import type { SessionServiceScope } from '../api/use-session-services';
import { parsePackageRouteId } from '../model/customer-package-view';
import { packageListState, usePackageRouteSelection } from '../model/use-package-route-selection';
import { CustomerPackageList } from '../ui/customer-package-list';
import { PackagesSelectionArea } from '../ui/packages-selection-area';

/**
 * Ø´Ø§Ø´Ø© Ø¨Ø§Ù‚Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„Ø©: Ø§Ù„Ø¹Ù†ÙˆØ§Ù† Ø¹Ø§Ù… ÙˆÙ…ÙÙŠØ´ Ø§Ø³Ù… Ø¹Ù…ÙŠÙ„Ø© ÙˆÙ„Ø§ ØªÙ„ÙŠÙÙˆÙ† ÙÙŠ Ø§Ù„Ø¹Ù†ÙˆØ§Ù† ÙˆÙ„Ø§ ÙÙŠ Ø§Ù„ÙƒØ§Ø´ (FR-A08ØŒ SC-005).
 * Ø¥Ø«Ø¨Ø§Øª Ù‚Ø±Ø§Ø¡Ø© Ø­Ø§Ù„ÙŠ Ù‚Ø¨Ù„ Ø¹Ø±Ø¶ Ø£ÙŠ Ø¨ÙŠØ§Ù†Ø§Øª Ù…Ù† Ø§Ù„ÙƒØ§Ø´ â€” Ø§Ù†ØªØ¸Ø§Ø± Ø£Ùˆ Ø±ÙØ¶ ÙŠØ®ÙÙŠ Ø§Ù„Ù‚Ø§ÙŠÙ…Ø© (r4654058100).
 * Ø§Ù„Ø¨Ø§Ù‚Ø© Ø§Ù„Ù…ÙØªÙˆØ­Ø© Ø¨ØªØ¹ÙŠØ´ ÙÙŠ Ø§Ù„Ø§Ø³ØªØ¹Ù„Ø§Ù… ?package= ÙØ²Ø± Ø§Ù„Ø±Ø¬ÙˆØ¹ Ø¨ÙŠÙ‚ÙÙ„Ù‡Ø§ØŒ ÙˆÙ…Ù‚Ø·Ø¹ Ø¹Ù…ÙŠÙ„Ø© ÙØ§Ø³Ø® ÙŠØ¹Ø±Ø¶
 * Â«ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Â» Ù…Ù† ØºÙŠØ± Ø£ÙŠ Ø·Ù„Ø¨.
 */
export function CustomerPackagesPage({
  scope,
  customerId,
}: {
  scope: SessionServiceScope;
  customerId: string;
}) {
  const locale = useLocale();
  const scopeId = `${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}`;
  const { entitlementId, hasRawSelection, select, close } = usePackageRouteSelection(scopeId);
  // Ø§Ù„Ù…Ù‚Ø·Ø¹ Ø§Ù„ÙØ§Ø³Ø® Ù„Ù„Ø¹Ù…ÙŠÙ„Ø© ÙŠØ¹Ø±Ø¶ Â«ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Â» Ù…Ù† ØºÙŠØ± Ø£ÙŠ Ø·Ù„Ø¨ (CP-02).
  const validCustomerId = parsePackageRouteId(customerId);
  const list = useCustomerPackages(scope, validCustomerId ?? customerId, validCustomerId !== null);
  const proof = useAccessProof(
    list.isFetching,
    list.isError,
    list.error,
    scopeId,
    validCustomerId !== null,
  );
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
      ) : proof === 'refused' ? (
        <p role="alert">{t(locale, 'customerPackages.notAllowed')}</p>
      ) : proof === 'pending' ? (
        <p role="status">{t(locale, 'customerPackages.loading')}</p>
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

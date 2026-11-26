'use client';
import { t } from '@pospay/i18n';
import { useRef } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { HeldAttempt } from '../api/use-refund-package';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageDetailContent } from './customer-package-detail-content';
import { DetailFailure } from './detail-failure';

/**
 * تفصيل الباقة المستقل: إثبات قراءة حالي قبل أي بيانات من الكاش — انتظار يعرض تحميل،
 * رفض أو 404 يقفلان بزر، وفشل عابر بيجيب إعادة محاولة (FR-A07).
 * حقول البيع بتظهر بس اللي رجعت من القراءة غير null، ومعرفات البائع والفرع والنوع ما بتتعرضش (FR-A09).
 */
export function CustomerPackageDetail({
  scope,
  customerId,
  entitlementId,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const heldRefundAttemptRef = useRef<HeldAttempt | null>(null);
  const detail = useCustomerPackageDetail(scope, customerId, entitlementId, true);
  const proof = readAccessProof(detail);
  if (detail.isLoading || proof === 'pending')
    return <p role="status">{t(locale, 'customerPackages.detailLoading')}</p>;
  if (proof === 'refused' || proof === 'failed' || detail.isError) {
    const status =
      detail.fetchStatus !== 'paused' &&
      typeof detail.error === 'object' &&
      detail.error !== null &&
      'status' in detail.error
        ? (detail.error as { status?: unknown }).status
        : undefined;
    const mode =
      proof === 'refused' || status === 403 ? 'refused' : status === 404 ? 'missing' : 'transient';
    return <DetailFailure mode={mode} onRetry={() => void detail.refetch()} onClose={onClose} />;
  }
  const data = detail.data;
  if (data === undefined) return null;
  return (
    <CustomerPackageDetailContent
      scope={scope}
      customerId={customerId}
      entitlementId={entitlementId}
      data={data}
      heldRefundAttemptRef={heldRefundAttemptRef}
      onSaved={() => void detail.refetch()}
      onClose={onClose}
    />
  );
}

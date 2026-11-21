'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAccessProof } from '@/shared/api/use-access-proof';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageComponents } from './customer-package-components';
import { DetailFailure } from './detail-failure';
import { DetailHeader } from './detail-header';
import { DetailSaleFacts } from './detail-sale-facts';
import { ExtendPackageDialog } from './extend-package-dialog';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const detail = useCustomerPackageDetail(scope, customerId, entitlementId);
  const proof = useAccessProof(
    detail.isFetching,
    detail.isError,
    detail.error,
    `${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}:${entitlementId}`,
  );
  if (detail.isLoading || proof === 'pending')
    return <p role="status">{t(locale, 'customerPackages.detailLoading')}</p>;
  if (proof === 'refused' || detail.isError) {
    const status =
      typeof detail.error === 'object' && detail.error !== null && 'status' in detail.error
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
      dialogOpen={dialogOpen}
      onExtend={() => setDialogOpen(true)}
      onDialogClose={() => setDialogOpen(false)}
      onSaved={() => {
        void detail.refetch();
        setDialogOpen(false);
      }}
      onClose={onClose}
    />
  );
}

/** جسم التفصيل بعد الإثبات: الحقول والمكوّنات والسجلات وحوار التمديد على can_extend الحي. */
function CustomerPackageDetailContent({
  scope,
  customerId,
  entitlementId,
  data,
  dialogOpen,
  onExtend,
  onDialogClose,
  onSaved,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  data: NonNullable<ReturnType<typeof useCustomerPackageDetail>['data']>;
  dialogOpen: boolean;
  onExtend: () => void;
  onDialogClose: () => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <section
      className="grid gap-3 rounded-card border border-border p-3 text-start"
      aria-label={t(locale, 'customerPackages.title')}
    >
      <DetailHeader data={data} onClose={onClose} />
      <DetailSaleFacts data={data} />
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.components')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.components')}</h3>
        <CustomerPackageComponents components={data.components} />
      </section>
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.redemptions')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.redemptions')}</h3>
        <PackageRedemptionList redemptions={data.redemptions} components={data.components} />
      </section>
      <PackageExtensionHistory extensions={data.extensions} timeZone={data.business_timezone} />
      {data.can_extend ? (
        <Button type="button" onClick={onExtend}>
          {t(locale, 'customerPackages.extend')}
        </Button>
      ) : null}
      {dialogOpen && data.can_extend ? (
        <ExtendPackageDialog
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          currentExpiresOn={data.expires_on}
          onSaved={onSaved}
          onClose={onDialogClose}
        />
      ) : null}
    </section>
  );
}

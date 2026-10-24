'use client';

import { buildEmployeeAppLink } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { QRCodeSVG } from 'qrcode.react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeAppLink } from '../api/use-employee-app-link';
import { employeeAppPosOrigin, isForbidden } from '../model/employee-app-link';
import { EmployeeAppLinkActions } from '../ui/employee-app-link-actions';

export function EmployeeAppLinkPage(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const read = useEmployeeAppLink(props.companyId, props.userId, props.businessId);
  if (read.isPending) return <p role="status">{t(locale, 'admin.loading')}</p>;
  if (read.isError && isForbidden(read.error)) {
    return <p role="alert">{t(locale, 'errors.FORBIDDEN')}</p>;
  }
  if (read.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert">{t(locale, 'employeeAppLink.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={() => void read.refetch()}>
          {t(locale, 'pos.retry')}
        </Button>
      </div>
    );
  }
  const data = read.data;
  const link = buildEmployeeAppLink(
    employeeAppPosOrigin(),
    data.company_id,
    data.business_id,
  );
  if (link === null) return <p role="alert">{t(locale, 'employeeAppLink.notConfigured')}</p>;
  const businessName =
    locale === 'ar' && data.business_name_ar !== null
      ? data.business_name_ar
      : data.business_name_en;
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader
        title={t(locale, 'employeeAppLink.title')}
        description={t(locale, 'employeeAppLink.lead')}
      />
      <div>
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeAppLink.business')}</p>
        <p className="font-medium">{businessName}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeAppLink.link')}</p>
        <p className="break-all font-mono text-start" dir="ltr">
          {link}
        </p>
      </div>
      <div
        role="img"
        aria-label={t(locale, 'employeeAppLink.qrLabel')}
        className="w-fit max-w-full rounded-interactive border border-border bg-white p-4"
      >
        <QRCodeSVG value={link} size={256} marginSize={4} className="h-auto max-w-full" />
      </div>
      <EmployeeAppLinkActions link={link} businessName={businessName} />
    </section>
  );
}

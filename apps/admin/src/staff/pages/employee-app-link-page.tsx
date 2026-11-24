'use client';

import { buildEmployeeAppLink } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeAppLink } from '../api/use-employee-app-link';
import { employeeAppPosOrigin, isForbidden } from '../model/employee-app-link';
import { EmployeeAppLinkCard } from '../ui/employee-app-link-card';
import { EmployeeAppLinkShell } from '../ui/employee-app-link-shell';

export function EmployeeAppLinkPage(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const read = useEmployeeAppLink(props.companyId, props.userId, props.businessId);
  if (read.isPending)
    return (
      <EmployeeAppLinkShell>
        <p role="status">{t(locale, 'admin.loading')}</p>
      </EmployeeAppLinkShell>
    );
  if (read.isError && isForbidden(read.error))
    return (
      <EmployeeAppLinkShell>
        <p role="alert">{t(locale, 'errors.FORBIDDEN')}</p>
      </EmployeeAppLinkShell>
    );
  if (read.isError)
    return (
      <EmployeeAppLinkShell>
        <div className="flex flex-col items-start gap-2">
          <p role="alert">{t(locale, 'employeeAppLink.loadFailed')}</p>
          <Button type="button" variant="outline" onClick={() => void read.refetch()}>
            {t(locale, 'pos.retry')}
          </Button>
        </div>
      </EmployeeAppLinkShell>
    );
  const data = read.data;
  const link = buildEmployeeAppLink(employeeAppPosOrigin(), data.company_id, data.business_id);
  if (link === null)
    return (
      <EmployeeAppLinkShell>
        <p role="alert">{t(locale, 'employeeAppLink.notConfigured')}</p>
      </EmployeeAppLinkShell>
    );
  const businessName =
    locale === 'ar' && data.business_name_ar !== null
      ? data.business_name_ar
      : data.business_name_en;
  return (
    <EmployeeAppLinkShell>
      <EmployeeAppLinkCard link={link} businessName={businessName} />
    </EmployeeAppLinkShell>
  );
}

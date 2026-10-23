'use client';

import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useStaffColumns } from '../api/use-staff-columns';
import { isStaffColumnsRefusal, staffColumnsFailureMessage } from '../model/staff-columns-failure';
import { StaffColumnsForm } from '../ui/staff-columns-form';

export function StaffAppColumnsPage(props: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const query = useStaffColumns(props.companyId, props.userId, props.businessId);
  const settings = query.data;
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'staffAppColumns.title')}
        description={t(locale, 'staffAppColumns.lead')}
      />
      {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {query.isError ? (
        isStaffColumnsRefusal(query.error) ? (
          <p role="alert">{t(locale, 'errors.FORBIDDEN')}</p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p role="alert">{staffColumnsFailureMessage(query.error, locale)}</p>
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t(locale, 'pos.retry')}
            </Button>
          </div>
        )
      ) : null}
      {settings && !query.isError ? (
        <StaffColumnsForm
          companyId={props.companyId}
          userId={props.userId}
          businessId={props.businessId}
          server={settings}
        />
      ) : null}
    </section>
  );
}

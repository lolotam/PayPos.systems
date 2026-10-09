'use client';
import { findGccBank, formatIbanForDisplay } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeIban } from '../api/use-employee-iban';
import { IbanForm } from './iban-form';
import { IbanHistoryTable } from './iban-history-table';

export function EmployeeIbanSection({
  companyId,
  businessId,
  userId,
  employeeId,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
}) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<number>();
  const { current, history, save, accessDenied } = useEmployeeIban(
    companyId,
    businessId,
    userId,
    employeeId,
    cursor,
  );
  if (accessDenied || !current.isFetchedAfterMount || !current.data || current.isError) return null;
  const view = current.data;
  const bank = findGccBank(view.bank_id ?? '');
  return (
    <section aria-label={t(locale, 'employeeIban.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'employeeIban.title')}</h3>
      {view.status === 'NOT_SET' ? (
        <p>{t(locale, 'employeeIban.notSet')}</p>
      ) : (
        <p dir="ltr">
          {view.iban
            ? formatIbanForDisplay(view.iban)
            : `${t(locale, 'employeeIban.masked')} ${view.iban_last4}`}
        </p>
      )}
      {view.can_read_full ? (
        <>
          <p>{bank ? (locale === 'ar' ? bank.nameAr : bank.nameEn) : ''}</p>
          <p dir="ltr">{view.holder_name_en}</p>
          <IbanHistory history={history} cursor={cursor} setCursor={setCursor} />
        </>
      ) : null}
      {view.can_manage ? (
        <IbanForm
          key={view.revision}
          current={view}
          pending={save.isPending}
          onSave={(input) => save.mutate(input, { onSuccess: () => setCursor(undefined) })}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'employeeIban.saved')}</p> : null}
    </section>
  );
}

function IbanHistory({
  history,
  cursor,
  setCursor,
}: {
  history: ReturnType<typeof useEmployeeIban>['history'];
  cursor: number | undefined;
  setCursor: (cursor: number | undefined) => void;
}) {
  const locale = useLocale();
  if (!history.isFetchedAfterMount || !history.data || history.isError) return null;
  return (
    <>
      <IbanHistoryTable items={history.data.items} />
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!cursor || history.isFetching}
          onClick={() => setCursor(undefined)}
        >
          {t(locale, 'staff.first')}
        </Button>
        <Button
          variant="outline"
          disabled={!history.data.next_cursor || history.isFetching}
          onClick={() => setCursor(history.data?.next_cursor ?? undefined)}
        >
          {t(locale, 'staff.next')}
        </Button>
      </div>
    </>
  );
}

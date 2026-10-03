'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useSalaries } from '../api/use-salaries';
import { SalaryForm } from './salary-form';
import { SalaryHistoryTable } from './salary-history-table';
export function EmployeeSalarySection({
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
  const [cursor, setCursor] = useState<string>();
  const { history, save } = useSalaries(companyId, businessId, userId, employeeId, cursor);
  // بيانات cache لا تثبت الصلاحية لهذا الفتح؛ ننتظر قراءة ناجحة بعد تركيب القسم.
  if (!history.isFetchedAfterMount || !history.data || history.isError) return null;
  return (
    <section aria-label={t(locale, 'salary.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'salary.title')}</h3>
      <p>{t(locale, 'salary.lead')}</p>
      <SalaryHistoryTable items={history.data.items} />
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
          onClick={() => setCursor(history.data.next_cursor ?? undefined)}
        >
          {t(locale, 'staff.next')}
        </Button>
      </div>
      {history.data.can_manage ? (
        <SalaryForm
          pending={save.isPending}
          onSave={(input) => save.mutate(input, { onSuccess: () => setCursor(undefined) })}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'salary.saved')}</p> : null}
    </section>
  );
}

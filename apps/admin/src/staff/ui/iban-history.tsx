'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useEmployeeIban } from '../api/use-employee-iban';
import { IbanHistoryTable } from './iban-history-table';

export function IbanHistory({
  history,
  cursor,
  setCursor,
  timeZone,
}: {
  history: ReturnType<typeof useEmployeeIban>['history'];
  cursor: number | undefined;
  setCursor: (cursor: number | undefined) => void;
  timeZone: string;
}) {
  const locale = useLocale();
  if (!history.isFetchedAfterMount || !history.data || history.isError) return null;
  return (
    <>
      <IbanHistoryTable items={history.data.items} timeZone={timeZone} />
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

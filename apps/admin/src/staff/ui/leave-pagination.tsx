'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function LeavePagination({
  cursor,
  next,
  fetching,
  onPage,
}: {
  cursor: string | undefined;
  next: string | null;
  fetching: boolean;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={!cursor || fetching} onClick={() => onPage(undefined)}>
        {t(locale, 'leave.previous')}
      </Button>
      <Button
        variant="outline"
        disabled={!next || fetching}
        onClick={() => onPage(next ?? undefined)}
      >
        {t(locale, 'leave.next')}
      </Button>
    </div>
  );
}

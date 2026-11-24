'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** ترقيم الأسابيع: زرا «السابق» و«التالي» في تذييل كرت القائمة (القالب المشترك). */
export function SchedulePaging({
  cursor,
  next,
  fetching,
  failed,
  onPage,
}: {
  cursor: string | undefined;
  next: string | undefined | null;
  fetching: boolean;
  failed: boolean;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={!cursor || fetching} onClick={() => onPage(undefined)}>
        {t(locale, 'shell.schedule_previous')}
      </Button>
      <Button
        variant="outline"
        disabled={!next || fetching || failed}
        onClick={() => onPage(next ?? undefined)}
      >
        {t(locale, 'shell.schedule_next')}
      </Button>
    </div>
  );
}

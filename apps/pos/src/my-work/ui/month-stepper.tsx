import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { monthLabel } from '../model/work-month';

/** تنقل بين الشهور: السابق بيتقفل عند حد `staff_months_back`، والتالي بيتقفل عند الشهر الحالي. */
export function MonthStepper({
  month,
  canGoBack,
  canGoForward,
  onPrevious,
  onNext,
}: {
  month: string | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="outline" disabled={!canGoBack} onClick={onPrevious}>
        {t(locale, 'myWork.previousMonth')}
      </Button>
      <span className="font-semibold tabular-nums">{month ? monthLabel(month, locale) : ''}</span>
      <Button variant="outline" disabled={!canGoForward} onClick={onNext}>
        {t(locale, 'myWork.nextMonth')}
      </Button>
    </div>
  );
}

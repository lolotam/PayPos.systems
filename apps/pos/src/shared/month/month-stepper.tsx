import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { monthLabel } from './month';

/** تنقل بين الشهور: السابق بيتقفل عند حد `staff_months_back`، والتالي بيتقفل عند الشهر الحالي. */
export function MonthStepper({
  month,
  canGoBack,
  canGoForward,
  labels,
  onPrevious,
  onNext,
}: {
  month: string | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  labels: { previous: string; next: string };
  onPrevious: () => void;
  onNext: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="outline" disabled={!canGoBack} onClick={onPrevious}>
        {labels.previous}
      </Button>
      <span className="font-semibold tabular-nums">{month ? monthLabel(month, locale) : ''}</span>
      <Button variant="outline" disabled={!canGoForward} onClick={onNext}>
        {labels.next}
      </Button>
    </div>
  );
}

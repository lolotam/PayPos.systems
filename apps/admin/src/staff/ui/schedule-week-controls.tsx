'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { FilterField, FilterRow } from '@/shared/ui/filter-row';
export function ScheduleWeekControls({
  week,
  timezone,
  fetching,
  onWeek,
  onReload,
}: {
  week: string;
  timezone: string;
  fetching: boolean;
  onWeek: (week: string) => void;
  onReload: () => void;
}) {
  const locale = useLocale();
  return (
    <FilterRow>
      <FilterField>
        <Label htmlFor="schedule-week">{t(locale, 'shell.schedule_week')}</Label>
        <Input
          id="schedule-week"
          type="date"
          required
          value={week}
          onChange={(event) => onWeek(event.target.value)}
        />
      </FilterField>
      <p className="text-sm text-muted-foreground">{timezone}</p>
      <Button variant="outline" disabled={fetching} onClick={onReload}>
        {t(locale, 'schedules.reload')}
      </Button>
    </FilterRow>
  );
}

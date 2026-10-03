'use client';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
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
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <Label htmlFor="schedule-week">{t(locale, 'shell.schedule_week')}</Label>
        <Input
          id="schedule-week"
          type="date"
          required
          value={week}
          onChange={(event) => onWeek(event.target.value)}
        />
      </div>
      <p className="text-sm text-muted-foreground">{timezone}</p>
      <Button variant="outline" disabled={fetching} onClick={onReload}>
        {t(locale, 'staff.reload')}
      </Button>
    </div>
  );
}

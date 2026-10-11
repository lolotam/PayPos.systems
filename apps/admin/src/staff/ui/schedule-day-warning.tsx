'use client';
import type { ScheduleShift } from '@pospay/contracts';
import { dayDiffersFromDefault } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function ScheduleDayWarning({ shifts, entry, name }: {
  shifts: ScheduleShift[]; entry: ScheduleShift | null; name: string;
}) {
  const locale = useLocale();
  if (!dayDiffersFromDefault(shifts, entry)) return null;
  return <p role="status" className="text-sm text-muted-foreground">
    {t(locale, 'shell.schedule_defaultWarning').replace('{name}', name)}
  </p>;
}

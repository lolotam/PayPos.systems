'use client';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { FilterField, FilterRow } from '@/shared/ui/filter-row';

export function ServiceSessionDayFilters({
  date,
  lateOnly,
  onDate,
  onLate,
}: {
  date: string;
  lateOnly: boolean;
  onDate: (date: string) => void;
  onLate: (lateOnly: boolean) => void;
}) {
  const locale = useLocale();
  return (
    <FilterRow className="text-start">
      <FilterField>
        <Label htmlFor="service-day">{t(locale, 'serviceLineEdit.date')}</Label>
        <Input
          id="service-day"
          type="date"
          dir="ltr"
          value={date}
          onChange={(event) => onDate(event.target.value)}
        />
      </FilterField>
      <Label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={lateOnly}
          onChange={(event) => onLate(event.target.checked)}
        />
        {t(locale, 'serviceLineEdit.lateOnly')}
      </Label>
    </FilterRow>
  );
}

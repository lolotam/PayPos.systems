'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeePageNavigation({
  cursor,
  next,
  stale = false,
  onChange,
}: {
  cursor: string | undefined;
  next: string | null;
  stale?: boolean;
  onChange: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={stale || cursor === undefined} onClick={() => onChange(undefined)}>
        {t(locale, 'staff.first')}
      </Button>
      <Button
        variant="outline"
        disabled={stale || next === null}
        onClick={() => onChange(next ?? undefined)}
      >
        {t(locale, 'staff.next')}
      </Button>
    </div>
  );
}

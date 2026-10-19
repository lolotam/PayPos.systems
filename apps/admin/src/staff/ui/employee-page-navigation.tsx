'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeePageNavigation({
  cursor,
  next,
  onChange,
  disabled = false,
}: {
  cursor: string | undefined;
  next: string | null;
  onChange: (cursor: string | undefined) => void;
  disabled?: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={disabled || cursor === undefined}
        onClick={() => onChange(undefined)}
      >
        {t(locale, 'staff.first')}
      </Button>
      <Button
        variant="outline"
        disabled={disabled || next === null}
        onClick={() => onChange(next ?? undefined)}
      >
        {t(locale, 'staff.next')}
      </Button>
    </div>
  );
}

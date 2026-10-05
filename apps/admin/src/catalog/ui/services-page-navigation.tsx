'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function ServicesPageNavigation({
  cursor,
  next,
  onChange,
}: {
  cursor: string | undefined;
  next: string | null;
  onChange: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={cursor === undefined} onClick={() => onChange(undefined)}>
        {t(locale, 'catalogServices.first')}
      </Button>
      <Button
        variant="outline"
        disabled={next === null}
        onClick={() => onChange(next ?? undefined)}
      >
        {t(locale, 'catalogServices.next')}
      </Button>
    </div>
  );
}

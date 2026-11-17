'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const tabs = [
  ['open', 'catalogServiceCategories.tabOpen'],
  ['closed', 'catalogServiceCategories.tabClosed'],
  ['all', 'catalogServiceCategories.tabAll'],
] as const;

export function ServiceCategoryStatusTabs({
  value,
  onChange,
}: {
  value: 'open' | 'closed' | 'all';
  onChange: (status: 'open' | 'closed' | 'all') => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2" role="group">
      {tabs.map(([status, key]) => (
        <Button
          key={status}
          variant={value === status ? 'default' : 'outline'}
          aria-pressed={value === status}
          onClick={() => onChange(status)}
        >
          {t(locale, key)}
        </Button>
      ))}
    </div>
  );
}

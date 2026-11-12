'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const tabs = [
  { value: 'data', label: 'leaveHistory.tabData' },
  { value: 'leave', label: 'leaveHistory.tabLeave' },
] as const;

export type EmployeeFileTab = (typeof tabs)[number]['value'];

export function EmployeeFileTabs({
  value,
  onChange,
}: {
  value: EmployeeFileTab;
  onChange: (value: EmployeeFileTab) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2" role="group" aria-label={t(locale, 'leaveHistory.tabsLabel')}>
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          type="button"
          variant={value === tab.value ? 'default' : 'outline'}
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {t(locale, tab.label)}
        </Button>
      ))}
    </div>
  );
}

'use client';
import type { ServiceCategoryBranchView } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const tabs = [
  ['in_use', 'catalogServiceCategoryBranches.tabInUse'],
  ['available', 'catalogServiceCategoryBranches.tabAvailable'],
] as const;

export function BranchServiceCategoryViewTabs({
  value,
  onChange,
}: {
  value: ServiceCategoryBranchView;
  onChange: (view: ServiceCategoryBranchView) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2" role="group">
      {tabs.map(([view, key]) => (
        <Button
          key={view}
          variant={value === view ? 'default' : 'outline'}
          aria-pressed={value === view}
          onClick={() => onChange(view)}
        >
          {t(locale, key)}
        </Button>
      ))}
    </div>
  );
}

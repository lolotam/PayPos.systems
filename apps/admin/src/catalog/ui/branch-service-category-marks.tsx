'use client';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function BranchServiceCategoryMarks({
  ownedHere,
  hiddenHere,
}: {
  ownedHere: boolean;
  hiddenHere: boolean;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      {ownedHere ? (
        <Badge variant="neutral">{t(locale, 'catalogServiceCategoryBranches.ownedHere')}</Badge>
      ) : null}
      {hiddenHere ? (
        <Badge variant="neutral">{t(locale, 'catalogServiceCategoryBranches.hiddenHere')}</Badge>
      ) : null}
    </div>
  );
}

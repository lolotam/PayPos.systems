import type { PersonalBranches } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function LeaveBranchSelector({
  items,
  selected,
  select,
}: {
  items: PersonalBranches['items'];
  selected: string;
  select: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <label>
      {t(locale, 'leave.branch')}
      <select value={selected} onChange={(event) => select(event.target.value)}>
        <option value="">{t(locale, 'myLeave.chooseBranch')}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
          </option>
        ))}
      </select>
    </label>
  );
}

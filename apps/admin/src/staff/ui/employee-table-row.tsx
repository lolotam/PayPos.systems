'use client';
import type { EmployeeListItem, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Button, Identifier } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeeTableRow({
  item,
  branch,
  selected,
  onSelect,
}: {
  item: EmployeeListItem;
  branch: WorkspaceBranch | undefined;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</td>
      <td>
        <Badge variant="neutral">{t(locale, `roles.${item.role_code}`)}</Badge>
      </td>
      <td>
        {branch ? (
          locale === 'ar' ? (
            (branch.name_ar ?? branch.name_en)
          ) : (
            branch.name_en
          )
        ) : (
          <Identifier value={item.primary_branch_id} />
        )}
      </td>
      <td>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'staff.edit')}
        </Button>
      </td>
    </tr>
  );
}

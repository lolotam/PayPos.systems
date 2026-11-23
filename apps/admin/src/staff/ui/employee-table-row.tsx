'use client';
import type { EmployeeListItem, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Button, Identifier } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../model/employee-number-display';

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
    <tr role="row" className={selected ? 'bg-secondary/50' : ''}>
      <td role="cell">{displayEmployeeNumber(item.employee_number)}</td>
      <td role="cell" data-cell-label={t(locale, 'staff.name')}>
        {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
      </td>
      <td role="cell" data-cell-label={t(locale, 'staff.role')}>
        <Badge variant="neutral">{t(locale, `roles.${item.role_code}`)}</Badge>
      </td>
      <td role="cell" data-cell-label={t(locale, 'staff.primaryBranch')}>
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
      <td role="cell">
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

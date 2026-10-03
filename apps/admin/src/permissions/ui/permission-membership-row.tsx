import type { PermissionMembership } from '@pospay/contracts';
import { roleName, t } from '@pospay/i18n';
import { Badge, Button, Identifier } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  item: PermissionMembership;
  selected: boolean;
  onSelect: (id: string) => void;
  scopeName?: string | undefined;
};

export function PermissionMembershipRow({ item, selected, onSelect, scopeName }: Props) {
  const locale = useLocale();
  const scopeLabel =
    item.scope_type === 'COMPANY'
      ? 'permissions.company'
      : item.scope_type === 'BUSINESS'
        ? 'permissions.business'
        : 'permissions.branch';
  return (
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>
        <Identifier
          value={item.user_id ?? item.employee_id}
          copy={{
            label: t(locale, 'permissions.copyHolder'),
            success: t(locale, 'admin.copied'),
            error: t(locale, 'admin.unexpected'),
          }}
        />
      </td>
      <td>
        <Badge variant="neutral">
          {roleName(
            locale,
            item.role_code,
            locale === 'ar' ? (item.role_name_ar ?? item.role_name_en) : item.role_name_en,
          )}
        </Badge>
      </td>
      <td>
        <p>{t(locale, scopeLabel)}</p>
        {scopeName ? <p>{scopeName}</p> : <Identifier value={item.scope_id} />}
      </td>
      <td>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'permissions.view')}
        </Button>
      </td>
    </tr>
  );
}

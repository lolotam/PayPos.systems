import type { MembershipPermissions } from '@pospay/contracts';
import { roleName } from '@pospay/i18n';
import { CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionMembershipHeading({
  membership,
}: {
  membership: MembershipPermissions['membership'];
}) {
  const locale = useLocale();
  const name =
    locale === 'ar'
      ? (membership.role_name_ar ?? membership.role_name_en)
      : membership.role_name_en;
  return (
    <CardHeader>
      <CardTitle>{roleName(locale, membership.role_code, name)}</CardTitle>
    </CardHeader>
  );
}

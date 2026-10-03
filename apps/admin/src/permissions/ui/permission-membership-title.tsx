'use client';

import type { PermissionMembership } from '@pospay/contracts';
import { roleName } from '@pospay/i18n';
import { CardHeader, CardTitle } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function PermissionMembershipTitle({ membership }: { membership: PermissionMembership }) {
  const locale = useLocale();
  return (
    <CardHeader>
      <CardTitle>
        {roleName(
          locale,
          membership.role_code,
          locale === 'ar'
            ? (membership.role_name_ar ?? membership.role_name_en)
            : membership.role_name_en,
        )}
      </CardTitle>
    </CardHeader>
  );
}

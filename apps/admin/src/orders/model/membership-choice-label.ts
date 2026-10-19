import type { PermissionMembership } from '@pospay/contracts';
import { roleName, t, type Locale } from '@pospay/i18n';

function scopeKey(scope: PermissionMembership['scope_type']) {
  if (scope === 'COMPANY') return 'permissions.company' as const;
  if (scope === 'BUSINESS') return 'permissions.business' as const;
  return 'permissions.branch' as const;
}

// اسم الدور من الكتالوج، والنطاق من اسم الفرع أو النشاط لو موجود، عشان الاختيار ما يبقاش رقم ترتيب.
export function membershipChoiceLabel(
  locale: Locale,
  membership: PermissionMembership | undefined,
  names: Readonly<Record<string, string>>,
  index: number,
): string {
  if (!membership) {
    return t(locale, 'serviceLineCancel.membershipN').replace('{n}', String(index + 1));
  }
  const stored =
    locale === 'ar'
      ? (membership.role_name_ar ?? membership.role_name_en)
      : membership.role_name_en;
  const role = roleName(locale, membership.role_code, stored);
  const named = names[`${membership.scope_type}:${membership.scope_id}`];
  const scope = named ?? t(locale, scopeKey(membership.scope_type));
  return `${role} — ${scope}`;
}

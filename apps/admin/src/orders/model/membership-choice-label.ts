import type { MyMembership } from '@pospay/contracts';
import { roleName, t, type Locale } from '@pospay/i18n';

// اسم الدور من الكتالوج، واسم النطاق جاي مع العضوية، عشان المدير يميّز الفرع من غير قراءة عضويات الشركة.
export function membershipChoiceLabel(
  locale: Locale,
  membership: MyMembership | undefined,
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
  const scope =
    locale === 'ar'
      ? (membership.scope_name_ar ?? membership.scope_name_en)
      : membership.scope_name_en;
  return `${role} — ${scope}`;
}

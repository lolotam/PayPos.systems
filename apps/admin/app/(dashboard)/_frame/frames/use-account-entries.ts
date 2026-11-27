'use client';

import { t } from '@pospay/i18n';
import type { AccountMenuEntry } from '@pospay/ui';
import { usePathname } from 'next/navigation';

import type { useSignOut } from '@/session/api/use-sign-out';
import { useLocale } from '@/shared/locale/locale-context';

import { APPEARANCE_HREF, TWO_FACTOR_HREF } from '../frame-routes';

export type SignOutController = ReturnType<typeof useSignOut>;

/**
 * مداخل قائمة الحساب بالترتيب: الاسم يضيفه المكوّن، ثم المصادقة والمظهر وتسجيل الخروج.
 * اختيار النمط والوضع مش هنا — اتنقل لزرّي في الشريط العلوي: النمط قائمة مستقلة،
 * والوضع زرّ تبديل بضغطة واحدة. القائمة تقبل مداخل فقط، فعلامة «الحالي» تُكتب في نص المدخل.
 */
export function useAccountEntries(signOut: SignOutController): AccountMenuEntry[] {
  const locale = useLocale();
  const pathname = usePathname();
  const mark = (text: string, current: boolean) =>
    current ? `${text} — ${t(locale, 'adminNav.currentStyleBadge')}` : text;
  return [
    {
      id: 'authenticator',
      label: mark(t(locale, 'admin.enrolLink'), pathname === TWO_FACTOR_HREF),
      href: TWO_FACTOR_HREF,
    },
    {
      id: 'appearance',
      label: mark(t(locale, 'adminNav.appearanceTitle'), pathname === APPEARANCE_HREF),
      href: APPEARANCE_HREF,
    },
    {
      id: 'sign-out',
      label: signOut.failed
        ? `${t(locale, 'admin.signOut')} — ${t(locale, 'admin.unexpected')}`
        : t(locale, 'admin.signOut'),
      pending: signOut.pending,
      onSelect: () => void signOut.submit(),
    },
  ];
}

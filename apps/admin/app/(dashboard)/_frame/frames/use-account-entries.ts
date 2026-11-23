'use client';

import { t, type MessageKey } from '@pospay/i18n';
import {
  readThemePreference,
  setThemePreference,
  subscribeToThemePreference,
  type AccountMenuEntry,
  type ThemePreference,
} from '@pospay/ui';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import type { useSignOut } from '@/session/api/use-sign-out';
import { useLocale } from '@/shared/locale/locale-context';
import type { NavigationStyle } from '@/workspace/nav-types';

import { APPEARANCE_HREF, TWO_FACTOR_HREF } from '../frame-routes';
import { NAVIGATION_STYLES } from '../navigation-model';
import { useNavStyle } from '../nav-style/nav-style-context';

export type SignOutController = ReturnType<typeof useSignOut>;

const STYLE_LABELS: Readonly<Record<NavigationStyle, MessageKey>> = {
  A: 'adminNav.styleALabel',
  B: 'adminNav.styleBLabel',
  C: 'adminNav.styleCLabel',
};

const THEMES: readonly (readonly [ThemePreference, MessageKey])[] = [
  ['light', 'theme.light'],
  ['dark', 'theme.dark'],
  ['system', 'theme.system'],
];

/**
 * مداخل قائمة الحساب بالترتيب: الاسم يضيفه المكوّن، ثم المصادقة والمظهر واختيار النمط والوضع وتسجيل الخروج.
 * القائمة تقبل مداخل فقط، فعلامة «الحالي» تُكتب في نص المدخل بدل اللون وحده.
 */
export function useAccountEntries(signOut: SignOutController): AccountMenuEntry[] {
  const locale = useLocale();
  const { style, setStyle } = useNavStyle();
  const theme = useSyncExternalStore(
    subscribeToThemePreference,
    readThemePreference,
    () => 'system',
  );
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
    ...NAVIGATION_STYLES.map((option) => ({
      id: `style-${option}`,
      label: mark(
        `${t(locale, 'adminNav.accountMenuStyle')}: ${t(locale, STYLE_LABELS[option])}`,
        option === style,
      ),
      onSelect: () => setStyle(option),
    })),
    ...THEMES.map(([option, key]) => ({
      id: `theme-${option}`,
      label: mark(`${t(locale, 'adminNav.accountMenuTheme')}: ${t(locale, key)}`, option === theme),
      onSelect: () => setThemePreference(option),
    })),
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

'use client';

import { t } from '@pospay/i18n';
import {
  Button,
  Moon,
  Sun,
  effectiveTheme,
  readThemePreference,
  setThemePreference,
  subscribeToThemePreference,
} from '@pospay/ui';
import { useSyncExternalStore } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

/** الوضع الفعّال على الشاشة: الاختيار المحفوظ، أو وضع النظام لما الاختيار تبع النظام. */
const readEffectiveTheme = () => effectiveTheme(readThemePreference());

/** على السيرفر مفيش تخزين ولا استعلام وسائط، فالوضع الآمن هو الفاتح. */
const serverTheme = (): 'light' | 'dark' => 'light';

/**
 * زرّ تبديل الوضع في الشريط العلوي: يبدّل بين الفاتح والغامق بضغطة واحدة.
 * اسمه يسمّي الوضع الهدف لا الحالي («Display theme: Dark»)، لأن زرّ «تبديل»
 * بلا هدف يبني قارئ الشاشة على تخمين، و`aria-pressed` يقول إن الوضع الغامق شغّال.
 * لما يكون الاختيار تبع النظام، أول ضغطة تثبّت اختيارًا صريحًا؛ مفيش خيار
 * «تبع النظام» في الهيدر، والصفحة `/appearance` هي مكان الخيارات الثلاثة.
 */
export function HeaderThemeToggle() {
  const locale = useLocale();
  const theme = useSyncExternalStore(subscribeToThemePreference, readEffectiveTheme, serverTheme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `${t(locale, 'adminNav.accountMenuTheme')}: ${t(locale, nextTheme === 'dark' ? 'theme.dark' : 'theme.light')}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={theme === 'dark'}
      onClick={() => setThemePreference(nextTheme)}
      className="shrink-0 text-muted-foreground"
    >
      {theme === 'dark' ? (
        <Sun aria-hidden="true" data-theme-icon="sun" className="size-4" />
      ) : (
        <Moon aria-hidden="true" data-theme-icon="moon" className="size-4" />
      )}
    </Button>
  );
}

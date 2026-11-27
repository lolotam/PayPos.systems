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
 * لما يكون الاختيار تبع النظام، أول ضغطة تثبّت اختيارًا صريحًا؛ مفيش خيار «تبع النظام» في الهيدر.
 */
export function FrameThemeToggle() {
  const locale = useLocale();
  const theme = useSyncExternalStore(subscribeToThemePreference, readEffectiveTheme, serverTheme);
  const label = t(locale, 'adminNav.accountMenuTheme');
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
      className="shrink-0 text-muted-foreground [&_svg]:size-5"
    >
      {theme === 'dark' ? (
        <Sun aria-hidden="true" data-theme-icon="sun" className="size-5" />
      ) : (
        <Moon aria-hidden="true" data-theme-icon="moon" className="size-5" />
      )}
    </Button>
  );
}

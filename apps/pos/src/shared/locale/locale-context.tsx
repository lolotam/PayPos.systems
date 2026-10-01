import { createContext, useContext, type ReactNode } from 'react';

import type { Locale } from '@pospay/i18n';

interface LocaleController {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleController | null>(null);

export function LocaleProvider({
  locale,
  setLocale,
  children,
}: LocaleController & { children: ReactNode }) {
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocaleController(): LocaleController {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider is missing');
  return value;
}

export function useLocale(): Locale {
  return useLocaleController().locale;
}

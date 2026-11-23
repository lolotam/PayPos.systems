'use client';

import { t } from '@pospay/i18n';
import { PageHeader, PageShell, ThemeSwitch } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { NavigationStyle } from '@/workspace/nav-types';

import { StyleCard } from './style-card';

const STYLES: readonly NavigationStyle[] = ['A', 'B', 'C'];

/**
 * صفحة المظهر: بطاقات الأنماط الثلاثة ومبدّل الوضع. النمط الحالي ودالة الاختيار تصلان من المستضيف
 * (إطار لوحة الإدارة)، فالصفحة لا تعرف الكوكي ولا مسارًا؛ وأي مستخدم مسجّل يفتحها بلا صلاحية (FR-005).
 */
export function AppearancePage({
  style,
  onChoose,
}: {
  style: NavigationStyle;
  onChoose: (style: NavigationStyle) => void;
}) {
  const locale = useLocale();
  return (
    <PageShell layout="list" className="flex flex-col gap-6">
      <PageHeader
        title={t(locale, 'adminNav.appearanceTitle')}
        description={t(locale, 'adminNav.appearanceLead')}
      />
      <section aria-labelledby="appearance-style" className="flex flex-col gap-3">
        <h2 id="appearance-style" className="text-lg font-semibold">
          {t(locale, 'adminNav.appearanceStyleHeading')}
        </h2>
        <p className="text-sm text-muted-foreground">{t(locale, 'adminNav.appearanceStyleLead')}</p>
        <div className="grid gap-4 min-[768px]:grid-cols-3">
          {STYLES.map((option) => (
            <StyleCard key={option} style={option} current={option === style} onChoose={onChoose} />
          ))}
        </div>
      </section>
      <section aria-labelledby="appearance-theme" className="flex flex-col gap-3">
        <h2 id="appearance-theme" className="text-lg font-semibold">
          {t(locale, 'adminNav.appearanceThemeHeading')}
        </h2>
        <p className="text-sm text-muted-foreground">{t(locale, 'adminNav.appearanceThemeLead')}</p>
        <ThemeSwitch
          labels={{
            label: t(locale, 'theme.label'),
            light: t(locale, 'theme.light'),
            dark: t(locale, 'theme.dark'),
            system: t(locale, 'theme.system'),
          }}
        />
      </section>
    </PageShell>
  );
}

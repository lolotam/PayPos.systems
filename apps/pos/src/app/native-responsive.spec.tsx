import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t, type Locale } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PersonalScreen } from '@/personal-staff/ui/personal-screen';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { DeviceScreen } from './device-screen';
import { StartScreen } from './start-screen';

/**
 * اختبارات التجاوب دي بتفحص **بنية** الشاشة ووضوح النصوص في اللغتين (RTL و LTR).
 *
 * `jsdom` مابيحسبش layout حقيقي، فمفيش داعي نلف على `window.innerWidth` بمقاسات
 * وهمية: المقاسات دي مالهاش أي تأثير على النتيجة. القياسات الحقيقية (العرض،
 * الالتفاف، والتمرير) مكانها المتصفح أو المحاكي على جهاز حقيقي.
 */

vi.mock('@/device/api/use-device-session', () => ({
  useDeviceSession: () => ({
    screen: { kind: 'pairing', notice: null },
    submitting: false,
    retry: () => Promise.resolve(),
    submit: () => Promise.resolve(null),
    startOver: () => Promise.resolve(),
  }),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: () => ({
    epoch: 0,
    online: true,
    loading: false,
    confirmedNoSession: true,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  }),
}));

/** اللغتين: العربي RTL والإنجليزي LTR. */
const LOCALES = [
  { locale: 'ar', dir: 'rtl' },
  { locale: 'en', dir: 'ltr' },
] as const;

/** عرض ثابت بالبكسل: أكبر من 360 (عرض أضيق موبايل). */
const FIXED_WIDTH = /^(?:min-)?w-\[(\d+)px\]$/;

function expectVisible(element: HTMLElement | null): void {
  expect(element).not.toBeNull();
  expect(element?.hasAttribute('hidden')).toBe(false);
  expect(element?.classList.contains('hidden')).toBe(false);
  expect(element?.getAttribute('aria-hidden')).not.toBe('true');
}

/** مفيش عنصر بيفرض عرض أكبر من أضيق موبايل ولا بيستخدم عرض الشاشة كله. */
function expectNoOverflow(root: HTMLElement): void {
  const offenders: string[] = [];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const name of element.classList) {
      if (name === 'w-screen') offenders.push(name);
      const match = FIXED_WIDTH.exec(name);
      if (match !== null && Number(match[1]) > 360) offenders.push(name);
    }
  }
  expect(offenders).toEqual([]);
}

function shell(locale: Locale, dir: 'rtl' | 'ltr', children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <DirectionProvider dir={dir}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          {children}
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>
  );
}

/** الشاشات اللي بيتفحص عليها: شاشة البداية، والكاونتر، وشاشة الموظفة (MOB-T22). */
describe('the native screens (MOB-T22)', () => {
  it.each(LOCALES)('shows the start screen in $locale', ({ locale, dir }) => {
    const view = render(shell(locale, dir, <StartScreen onChoose={() => undefined} />));

    expectVisible(screen.getByRole('heading', { name: t(locale, 'nativeShell.title') }));
    expectVisible(screen.getByRole('button', { name: t(locale, 'nativeShell.counter') }));
    expectVisible(screen.getByRole('button', { name: t(locale, 'nativeShell.employee') }));
    expectNoOverflow(view.container);
  });

  it.each(LOCALES)('shows the counter flow in $locale', ({ locale, dir }) => {
    const view = render(shell(locale, dir, <DeviceScreen />));

    expectVisible(screen.getByRole('heading', { name: t(locale, 'pos.pairingTitle') }));
    expectVisible(screen.getByRole('button', { name: t(locale, 'pos.pairSubmit') }));
    expectNoOverflow(view.container);
  });

  it.each(LOCALES)('shows the employee flow in $locale', ({ locale, dir }) => {
    const view = render(shell(locale, dir, <PersonalScreen />));

    expectVisible(screen.getByRole('heading', { name: t(locale, 'personalStaff.title') }));
    expectVisible(
      screen.getByRole('button', {
        name: t(locale, locale === 'ar' ? 'pos.languageEnglish' : 'pos.languageArabic'),
      }),
    );
    expectNoOverflow(view.container);
  });
});

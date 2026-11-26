import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { MustUpdateScreen } from './must-update-screen';

function mount(storeUrl: string) {
  return render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <MustUpdateScreen storeUrl={storeUrl} />
    </LocaleProvider>,
  );
}

describe('MustUpdateScreen', () => {
  it('shows the title, the lead and the store button (VER-T11)', () => {
    mount('https://apps.apple.com/app/id1');

    expect(screen.getByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
    expect(screen.getByText(t('ar', 'nativeShell.mustUpdateLead'))).toBeDefined();
    const link = screen.getByRole('link', { name: t('ar', 'nativeShell.mustUpdateButton') });
    expect(link.getAttribute('href')).toBe('https://apps.apple.com/app/id1');
    expect(screen.queryByText(t('ar', 'nativeShell.mustUpdateFallback'))).toBeNull();
  });

  it('shows the update line and no button for a link outside the store hosts (VER-T11)', () => {
    mount('https://evil.example/app');

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(t('ar', 'nativeShell.mustUpdateFallback'))).toBeDefined();
    expect(screen.getByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
  });

  it('keeps the language switch available', () => {
    mount('https://apps.apple.com/app/id1');

    expect(screen.getByRole('button', { name: t('ar', 'pos.languageEnglish') })).toBeDefined();
  });
});

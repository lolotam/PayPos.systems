import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { LoginPage } from './login-page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

describe('login page', () => {
  it('renders the Arabic sign-in heading from right to left', () => {
    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <LoginPage />
        </LocaleProvider>
      </DirectionProvider>,
    );
    const heading = screen.getByRole('heading', { name: t('ar', 'admin.signInTitle') });
    expect(heading.closest('[dir="rtl"]')).not.toBeNull();
  });
});

import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionDayNavItem } from './session-day-nav-item';

const state = vi.hoisted(() => ({ pathname: '/orders/service-sessions' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));

it('links the day list and marks it current only on that path', () => {
  const view = render(<SessionDayNavItem />);
  const link = screen.getByRole('link', { name: t('en', 'serviceLineEdit.title') });
  expect(link.getAttribute('href')).toBe('/orders/service-sessions');
  expect(link.getAttribute('aria-current')).toBe('page');
  state.pathname = '/orders/service-sessions/new';
  view.rerender(<SessionDayNavItem />);
  expect(screen.getByRole('link', { name: t('en', 'serviceLineEdit.title') }).getAttribute('aria-current')).toBeNull();
});

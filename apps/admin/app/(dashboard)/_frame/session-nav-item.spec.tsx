import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionNavItem } from './session-nav-item';

const state = vi.hoisted(() => ({ pathname: '/orders/service-sessions/new' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));

it('links the reception route and marks it current only on that path', () => {
  const view = render(<SessionNavItem />);
  const link = screen.getByRole('link', { name: t('en', 'serviceSessions.title') });
  expect(link.getAttribute('href')).toBe('/orders/service-sessions/new');
  expect(link.getAttribute('aria-current')).toBe('page');
  state.pathname = '/orders';
  view.rerender(<SessionNavItem />);
  expect(screen.getByRole('link', { name: t('en', 'serviceSessions.title') }).getAttribute('aria-current')).toBeNull();
});

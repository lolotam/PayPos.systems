import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StaffNavigation } from './staff-navigation';
const state = vi.hoisted(() => ({ path: '/staff/attendance-report' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
it.each([
  '/staff/attendance',
  '/staff/attendance-exceptions',
  '/staff/attendance-requests',
  '/staff/attendance-report',
])('keeps attendance entries adjacent and highlights only %s', (path) => {
  state.path = path;
  render(<StaffNavigation />);
  expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
    '/staff',
    '/staff/employee-numbers',
    '/staff/import',
    '/staff/attendance',
    '/staff/attendance-exceptions',
    '/staff/attendance-requests',
    '/staff/attendance-report',
  ]);
  expect(
    screen.getByRole('link', { name: t('en', 'staff.listTitle') }).getAttribute('aria-current'),
  ).toBeNull();
  const current = screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current).toHaveLength(1);
  expect(current[0]?.getAttribute('href')).toBe(path);
});
it('highlights employee numbers without highlighting the employee list', () => {
  state.path = '/staff/employee-numbers';
  render(<StaffNavigation />);
  expect(
    screen
      .getByRole('link', { name: t('en', 'companyEmployeeNumbers.title') })
      .getAttribute('aria-current'),
  ).toBe('page');
  expect(
    screen.getByRole('link', { name: t('en', 'staff.listTitle') }).getAttribute('aria-current'),
  ).toBeNull();
});

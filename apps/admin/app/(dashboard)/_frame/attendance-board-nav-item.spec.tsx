import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AttendanceBoardNavItem } from './attendance-board-nav-item';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/staff/attendance' }));
it('shows the staff attendance entry without computing effective permissions', () => {
  render(<AttendanceBoardNavItem />);
  const link = screen.getByRole('link', { name: t('en', 'attendanceBoard.title') });
  expect(link.getAttribute('href')).toBe('/staff/attendance');
  expect(link.getAttribute('aria-current')).toBe('page');
});

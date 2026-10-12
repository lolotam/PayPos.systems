import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AttendanceReportNavItem } from './attendance-report-nav-item';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/staff/attendance-report' }));
it('shows the report entry without computing effective permissions', () => {
  render(<AttendanceReportNavItem />);
  const link = screen.getByRole('link', { name: t('en', 'attendanceReport.title') });
  expect(link.getAttribute('href')).toBe('/staff/attendance-report');
  expect(link.getAttribute('aria-current')).toBe('page');
});

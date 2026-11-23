import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderDashboard } from '../dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from '../frames/frame-test-support';
import { NAVIGATION_PAGES } from '../navigation-model';
import { currentPlace } from './current-page';
import type { MenuContext } from './menu-context';
import { resolveTopLevels } from './resolve-top-levels';
import { visiblePageIds } from './visible-page-ids';

vi.mock('next/navigation', async () => (await import('../frames/frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('../frames/frame-test-support')).localeMock,
);
vi.mock(
  './use-visible-page-ids',
  async () => (await import('../frames/frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('../dashboard-mocks')).dashboardWorkspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('../dashboard-mocks')).dashboardSessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('../frames/frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('../frames/frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('../frames/frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const REPORT_PATHS = ['/staff/attendance-report', '/staff/attendance-statement'];
const ATTENDANCE_PATHS = [
  '/staff/attendance',
  '/staff/attendance-exceptions',
  '/staff/attendance-requests',
  '/staff/attendance-report',
  '/staff/attendance-statement',
];

function everythingVisible(): MenuContext {
  return {
    translate: (key) => key,
    pathname: '/',
    visibleIds: frameState.visible,
  };
}

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});

describe('which entry is current (was staff-navigation.spec and the session nav items)', () => {
  it.each(ATTENDANCE_PATHS)('marks only the attendance entry of %s, never the employee list', (path) => {
    const place = currentPlace('C', path);
    // الدفتر والتقرير يقعان اليوم تحت التقارير في خريطة التطبيق (قرار المالك)، والبقية تحت الحضور.
    expect(place.listId).toBe(REPORT_PATHS.includes(path) ? 'staff-reports' : 'attendance');
    expect(place.pageId).not.toBe('employees');
    expect(place.pageId).toBeDefined();
    const others = ATTENDANCE_PATHS.filter((other) => other !== path).map(
      (other) => currentPlace('C', other).pageId,
    );
    expect(others).not.toContain(place.pageId);
  });

  it('keeps the live attendance entries adjacent after the employee entries', () => {
    const team = resolveTopLevels('C', everythingVisible()).find((item) => item.id === 'team');
    const hrefs = team?.lists.flatMap((list) => list.pages.map((page) => page.href));
    const start = hrefs?.indexOf('/staff/attendance') ?? -1;
    expect(start).toBeGreaterThan(-1);
    expect(hrefs?.slice(start, start + 3)).toEqual([
      '/staff/attendance',
      '/staff/attendance-requests',
      '/staff/attendance-exceptions',
    ]);
    expect(hrefs?.slice(0, 3)).toEqual(['/staff', '/staff/employee-numbers', '/staff/import']);
  });

  it('lists the attendance report and statement together under the staff reports', () => {
    const business = resolveTopLevels('C', everythingVisible()).find((item) => item.id === 'business');
    const reports = business?.lists.find((list) => list.id === 'staff-reports');
    expect(reports?.pages.map((page) => page.href)).toEqual(
      expect.arrayContaining(['/staff/attendance-report', '/staff/attendance-statement']),
    );
  });

  it('marks employee numbers without marking the employee list', () => {
    const place = currentPlace('C', '/staff/employee-numbers');
    expect(place.pageId).toBe('employee-numbers');
  });

  it('does not mark the employee list on the staff app link page', () => {
    const place = currentPlace('C', '/staff/employee-app-link');
    expect(place.pageId).toBe('staff-app-link');
    expect(place.listId).not.toBe('employees');
  });

  it('marks the day list only on its own path and the reception entry only on its own', () => {
    expect(currentPlace('C', '/orders/service-sessions').pageId).toBe('sessions-day-list');
    expect(currentPlace('C', '/orders/service-sessions/new').pageId).toBe('record-visit');
    expect(currentPlace('C', '/orders').pageId).toBeUndefined();
  });

});

describe('catalog, sales and the entries that never had a read (was the nav items without a spec)', () => {
  it.each([
    ['/catalog', 'services'],
    ['/catalog/create', 'services'],
    ['/catalog/categories', 'categories'],
    ['/catalog/package-types', 'package-types'],
    ['/catalog/package-types/create', 'package-types'],
    ['/orders/package-sales/new', 'sell-package'],
  ])('marks the one matching catalog or sales entry for %s', (path, entryId) => {
    expect(currentPlace('C', path).pageId).toBe(entryId);
  });

  it('keeps the entries that had no read behind them visible with every read closed', () => {
    const closed = {
      always: true,
      'alert-rules-or-rating-access': false,
      'business-identity-access': false,
      'commission-plans-access': false,
      'employee-app-link-access': false,
      'imported-refunds-access': false,
      'leave-report-access': false,
      'staff-app-columns-access': false,
    } as const;
    const ids = visiblePageIds(NAVIGATION_PAGES, {
      conditions: closed,
      businessType: 'salon',
      country: 'KW',
      role: 'owner',
    });
    expect(ids).toEqual(
      expect.arrayContaining([
        'dashboard',
        'permissions',
        'weekly-schedules',
        'leave-approvals',
        'services',
        'categories',
        'package-types',
        'record-visit',
        'sell-package',
        'sessions-day-list',
        'employees',
        'employee-numbers',
        'import-employees',
        'attendance-board',
        'attendance-requests',
        'attendance-exceptions',
        'attendance-report',
        'attendance-statement',
      ]),
    );
  });

  it('links the day list and the reception entry at their own addresses', () => {
    const sales = resolveTopLevels('C', everythingVisible())
      .flatMap((item) => item.lists)
      .flatMap((list) => list.pages);
    expect(sales.find((page) => page.id === 'sessions-day-list')?.href).toBe('/orders/service-sessions');
    expect(sales.find((page) => page.id === 'record-visit')?.href).toBe('/orders/service-sessions/new');
  });
});

describe('what a user sees as current through the mounted frame', () => {
  it.each(ATTENDANCE_PATHS)('marks exactly one pill current on %s in style A', (path) => {
    frameState.pathname = path;
    renderDashboard(<p>Page body</p>, 'A');
    const pills = within(screen.getByRole('navigation', { name: label('adminNav.pillsLabel') }));
    const current = pills
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe(path);
  });

  it('marks the day list and not the reception entry on the day list path', () => {
    frameState.pathname = '/orders/service-sessions';
    renderDashboard(<p>Page body</p>, 'A');
    const pills = within(screen.getByRole('navigation', { name: label('adminNav.pillsLabel') }));
    expect(
      pills.getByRole('link', { name: new RegExp(label('serviceLineEdit.title')) }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      pills.getByRole('link', { name: new RegExp(label('serviceSessions.title')) }).getAttribute('aria-current'),
    ).toBeNull();
  });
});

describe('the account block (was dashboard-account.spec)', () => {
  it('shows the session name and email in the account menu, never the raw user id', () => {
    renderDashboard(<p>Page body</p>);
    fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
      key: 'Enter',
    });
    const menu = within(screen.getByRole('menu'));
    expect(menu.getByText('Sara Ali')).toBeTruthy();
    const email = menu.getByText('sara@example.test');
    expect(email.getAttribute('dir')).toBe('ltr');
    expect(email.classList.contains('truncate')).toBe(true);
    expect(screen.queryByText('user-1')).toBeNull();
  });
});

import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { frameState, renderFrame, resetFrameState, stubViewport } from './frame-test-support';
import { StyleAFrame } from './style-a-frame';

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frame-test-support')).localeMock,
);
vi.mock(
  '../menu/use-visible-page-ids',
  async () => (await import('./frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./frame-test-support')).workspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./frame-test-support')).sessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['ltr', 'rtl'] as const)('style A in %s', (dir) => {
  it('marks the current group, tab and pill', () => {
    frameState.pathname = '/staff/import';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>, dir);
    const sidebar = screen.getByRole('complementary');
    expect(sidebar.getAttribute('dir')).toBe(dir);
    expect(
      within(sidebar)
        .getByRole('link', { name: label('adminNav.groupATeam') })
        .getAttribute('aria-current'),
    ).toBe('page');
    const tabs = screen.getByRole('navigation', { name: label('adminNav.tabsLabel') });
    expect(
      within(tabs)
        .getByRole('link', { name: label('adminNav.submenuEmployees') })
        .getAttribute('aria-current'),
    ).toBe('page');
    const pills = screen.getByRole('navigation', { name: label('adminNav.pillsLabel') });
    expect(
      within(pills)
        .getByRole('link', { name: /Import employees/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(pills)
        .getByRole('link', { name: /Document types/ })
        .getAttribute('aria-current'),
    ).toBeNull();
  });

  it('marks Staff app columns under Setup, not under Employees', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>, dir);
    const sidebar = screen.getByRole('complementary');
    expect(
      within(sidebar)
        .getByRole('link', { name: label('adminNav.groupASetup') })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(sidebar)
        .getByRole('link', { name: label('adminNav.groupATeam') })
        .getAttribute('aria-current'),
    ).toBeNull();
  });
});

describe('style A visibility', () => {
  it('omits a group and a tab whose pages are all hidden', () => {
    frameState.visible = ['dashboard', 'employees', 'employee-numbers'];
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const sidebar = screen.getByRole('complementary');
    expect(
      within(sidebar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([label('adminNav.groupAHome'), label('adminNav.groupATeam')]);
    expect(screen.queryByRole('navigation', { name: label('adminNav.tabsLabel') })).toBeNull();
  });

  it('shows the Soon mark with the page name in the pills', () => {
    frameState.pathname = '/orders/service-sessions';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const pills = screen.getByRole('navigation', { name: label('adminNav.pillsLabel') });
    const soon = within(pills).getByRole('link', {
      name: new RegExp(label('adminNavPages.unassignedServices')),
    });
    expect(soon.textContent).toContain(label('adminNav.soonBadge'));
    expect(soon.getAttribute('href')).toBe('/soon/unassigned-services');
  });
});

describe('style A at tablet width and collapsed', () => {
  it('keeps the workspace switcher and account menu when the sidebar is a rail', () => {
    stubViewport(820);
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.getByRole('complementary').hasAttribute('data-collapsed')).toBe(true);
    expect(screen.getByRole('button', { name: /Synthetic business/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch language' })).toBeTruthy();
  });

  it('keeps them after the user collapses the sidebar on a desktop', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.collapseNavigation') }));
    expect(screen.getByRole('complementary').hasAttribute('data-collapsed')).toBe(true);
    expect(screen.getByRole('button', { name: /Synthetic business/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBeTruthy();
  });

  it('lets the page column follow the sidebar width by CSS, in both widths', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const column = screen.getByRole('main').parentElement as HTMLElement;
    expect(column.className).toContain('min-[1024px]:ms-66');
    expect(column.className).toContain('min-[1024px]:group-has-[aside[data-collapsed]]:ms-20');
    expect(column.className).toContain('min-[600px]:ms-20');
    expect(column.parentElement?.className).toContain('group');
  });
});

describe('style A on a phone', () => {
  beforeEach(() => stubViewport(390));

  it('shows four sections and More on the bottom bar', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.queryByRole('complementary')).toBeNull();
    const bar = screen.getByRole('navigation', { name: label('adminNav.bottomNavLabel') });
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      label('adminNav.groupAHome'),
      label('adminNav.groupASales'),
      label('adminNav.groupACatalog'),
      label('adminNav.groupATeam'),
    ]);
    expect(
      within(bar)
        .getByRole('link', { name: label('adminNav.groupATeam') })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(within(bar).getByRole('button', { name: label('adminNav.more') })).toBeTruthy();
  });

  it('opens the other sections with their sub-menus under More and closes after navigation', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.queryByRole('region', { name: label('adminNav.more') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.more') }));
    const sheet = screen.getByRole('region', { name: label('adminNav.more') });
    expect(
      within(sheet).getByRole('heading', { name: label('adminNav.groupAReports') }),
    ).toBeTruthy();
    expect(
      within(sheet).getByRole('heading', { name: label('adminNav.submenuStaffReports') }),
    ).toBeTruthy();
    expect(
      within(sheet).getByRole('link', { name: /Monthly attendance report|Attendance report/i }),
    ).toBeTruthy();
  });

  it('closes More when the route changes', () => {
    const { rerenderFrame } = renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.more') }));
    frameState.pathname = '/permissions';
    rerenderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.queryByRole('region', { name: label('adminNav.more') })).toBeNull();
  });
});

describe('links', () => {
  it('moves a plain click on a tab to the router and leaves a modified click to the browser', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const tabs = screen.getByRole('navigation', { name: label('adminNav.tabsLabel') });
    const attendance = within(tabs).getByRole('link', {
      name: label('adminNav.submenuAttendance'),
    });
    fireEvent.click(attendance, { metaKey: true });
    expect(frameState.push).not.toHaveBeenCalled();
    fireEvent.click(attendance);
    expect(frameState.push).toHaveBeenCalledWith('/staff/attendance');
  });
});

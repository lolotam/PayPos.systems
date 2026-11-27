import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTopLevels } from '../menu/resolve-top-levels';
import { CurrentRoute } from './current-route';
import {
  frameState,
  goTo,
  renderFrame,
  resetFrameState,
  resizeTo,
  stubViewport,
} from './frame-test-support';
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
const link = (scope: HTMLElement, name: string | RegExp) =>
  within(scope).getByRole('link', { name });
const tabsNav = () => screen.getByRole('navigation', { name: label('adminNav.tabsLabel') });
const moreButton = () => screen.getByRole('button', { name: label('adminNav.more') });
const pillsNav = () => screen.getByRole('navigation', { name: label('adminNav.pillsLabel') });

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
    expect(link(sidebar, label('adminNav.groupATeam')).getAttribute('aria-current')).toBe('page');
    expect(link(tabsNav(), label('adminNav.submenuEmployees')).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(link(pillsNav(), /Import employees/).getAttribute('aria-current')).toBe('page');
    expect(link(pillsNav(), /Document types/).getAttribute('aria-current')).toBeNull();
  });

  it('marks Staff app columns under Setup, not under Employees', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>, dir);
    const sidebar = screen.getByRole('complementary');
    expect(link(sidebar, label('adminNav.groupASetup')).getAttribute('aria-current')).toBe('page');
    expect(link(sidebar, label('adminNav.groupATeam')).getAttribute('aria-current')).toBeNull();
  });
});

describe.each(['ltr', 'rtl'] as const)('the style A sidebar header in %s', (dir) => {
  it('shows the PosPay mark without the wordmark, in the row of the collapse toggle', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>, dir);
    const sidebar = screen.getByRole('complementary');
    expect(sidebar.textContent).not.toContain(t('en', 'brand.latinName'));
    expect(sidebar.textContent).not.toContain(t('ar', 'brand.arabicName'));
    const mark = sidebar.querySelector<HTMLImageElement>(
      'img[src="/brand/logo-mark-simple-tile.png"]',
    );
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute('alt')).toBe(label('brand.title'));
    const row = mark?.parentElement as HTMLElement;
    expect(row.className).toContain('justify-center');
    expect(row.className).toContain('relative');
    const toggle = within(row).getByRole('button', { name: label('adminNav.collapseNavigation') });
    expect(toggle.className).toContain('end-2');
    expect(toggle.className).toContain('min-[1024px]:absolute');
    expect(toggle.className).not.toContain('right-2');
    expect(toggle.className).not.toContain('left-2');
  });

  it('drops the mark in the rail and keeps the toggle centred', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>, dir);
    const sidebar = screen.getByRole('complementary');
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.collapseNavigation') }));
    expect(sidebar.getAttribute('data-collapsed')).toBe('');
    expect(sidebar.querySelector('img[src="/brand/logo-mark-simple-tile.png"]')).toBeNull();
    const toggle = screen.getByRole('button', { name: label('adminNav.expandNavigation') });
    expect(toggle.className).not.toContain('end-2');
    expect(toggle.parentElement?.className).toContain('justify-center');
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
        .map((item) => item.textContent),
    ).toEqual([label('adminNav.groupAHome'), label('adminNav.groupATeam')]);
    expect(screen.queryByRole('navigation', { name: label('adminNav.tabsLabel') })).toBeNull();
  });

  it('shows the Soon mark with the page name in the pills', () => {
    frameState.pathname = '/orders/service-sessions';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const soon = link(pillsNav(), new RegExp(label('adminNavPages.unassignedServices')));
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

  it('keeps the sidebar collapsed after a pill click, because the frame does not reload', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.collapseNavigation') }));
    fireEvent.click(link(pillsNav(), /Import employees/));
    expect(screen.getByRole('complementary').hasAttribute('data-collapsed')).toBe(true);
    expect(link(pillsNav(), /Import employees/).getAttribute('aria-current')).toBe('page');
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
        .map((item) => item.textContent),
    ).toEqual([
      label('adminNav.groupAHome'),
      label('adminNav.groupASales'),
      label('adminNav.groupACatalog'),
      label('adminNav.groupATeam'),
    ]);
    expect(link(bar, label('adminNav.groupATeam')).getAttribute('aria-current')).toBe('page');
  });

  it('opens a labelled modal sheet with the other sections and their sub-menus as direct links', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.queryByRole('dialog')).toBeNull();
    moreButton().focus();
    fireEvent.click(moreButton());
    const sheet = screen.getByRole('dialog', { name: label('adminNav.more') });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(
      within(sheet).getByRole('heading', { name: label('adminNav.groupAReports') }),
    ).toBeTruthy();
    const staffReports = link(sheet, label('adminNav.submenuStaffReports'));
    expect(staffReports.getAttribute('href')).toBe('/staff/attendance-report');
    expect(
      within(sheet).queryByRole('heading', { name: label('adminNav.submenuStaffReports') }),
    ).toBeNull();
  });
});

describe('style A sheet on a phone', () => {
  beforeEach(() => stubViewport(390));

  it('closes the sheet on Escape and returns focus to More', async () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    moreButton().focus();
    fireEvent.click(moreButton());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(moreButton()));
  });

  it('follows a sub-menu link to its page, and the sheet is gone on the new route', () => {
    frameState.pathname = '/';
    renderFrame(
      <StyleAFrame>
        <CurrentRoute />
      </StyleAFrame>,
    );
    fireEvent.click(moreButton());
    fireEvent.click(link(screen.getByRole('dialog'), label('adminNav.submenuStaffReports')));
    expect(screen.getByText('Route: /staff/attendance-report')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not reopen the sheet when the user goes back to the page it was opened on', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    fireEvent.click(moreButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    goTo('/leave');
    expect(screen.queryByRole('dialog')).toBeNull();
    goTo('/staff');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('links', () => {
  const renderWithContent = () =>
    renderFrame(
      <StyleAFrame>
        <CurrentRoute>
          <a href="/staff/attendance-board">Link written by the page</a>
        </CurrentRoute>
      </StyleAFrame>,
    );

  beforeEach(() => {
    frameState.pathname = '/staff';
  });

  it('opens a tab through the router: the route and the current tab change, no reload', () => {
    renderWithContent();
    fireEvent.click(link(tabsNav(), label('adminNav.submenuAttendance')));
    expect(screen.getByText('Route: /staff/attendance')).toBeTruthy();
    expect(link(tabsNav(), label('adminNav.submenuAttendance')).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('leaves a modified click on a tab to the browser', () => {
    renderWithContent();
    fireEvent.click(link(tabsNav(), label('adminNav.submenuAttendance')), { metaKey: true });
    expect(screen.getByText('Route: /staff')).toBeTruthy();
  });

  it('opens a pill through the router even though the pills sit inside the page area', () => {
    renderWithContent();
    fireEvent.click(link(pillsNav(), /Import employees/));
    expect(screen.getByText('Route: /staff/import')).toBeTruthy();
  });

  it('leaves a link written by the page content to the browser', () => {
    renderWithContent();
    fireEvent.click(screen.getByRole('link', { name: 'Link written by the page' }));
    expect(screen.getByText('Route: /staff')).toBeTruthy();
    expect(frameState.push).not.toHaveBeenCalled();
  });

  it.each(['//evil.example/x', 'https://evil.example/x', String.raw`/\evil.example/x`])(
    'leaves the other-origin address %s to the browser',
    (href) => {
      renderWithContent();
      const tab = link(tabsNav(), label('adminNav.submenuAttendance'));
      tab.setAttribute('href', href);
      fireEvent.click(tab);
      expect(screen.getByText('Route: /staff')).toBeTruthy();
      expect(frameState.push).not.toHaveBeenCalled();
    },
  );
});

describe('style A sheet and the viewport', () => {
  const moreButtonNow = () => screen.getByRole('button', { name: label('adminNav.more') });

  it('closes the open sheet when the viewport grows past the phone width, and keeps it closed', () => {
    stubViewport(390);
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    fireEvent.click(moreButtonNow());
    expect(screen.getByRole('dialog')).toBeTruthy();
    resizeTo(820);
    expect(screen.queryByRole('dialog')).toBeNull();
    resizeTo(390);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to More even when pressing it did not move focus from another field', async () => {
    stubViewport(390);
    renderFrame(
      <StyleAFrame>
        <input aria-label="Page field" />
      </StyleAFrame>,
    );
    screen.getByRole('textbox', { name: 'Page field' }).focus();
    fireEvent.click(moreButtonNow());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(moreButtonNow()));
  });
});

describe('links owned by the page', () => {
  it('leaves a link the page draws in a portal to the browser, but takes a frame-owned portal link', () => {
    stubViewport(390);
    frameState.pathname = '/';
    renderFrame(
      <StyleAFrame>
        <CurrentRoute />
        {createPortal(<a href="/leave">Portal link of the page</a>, document.body)}
      </StyleAFrame>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Portal link of the page' }));
    expect(screen.getByText('Route: /')).toBeTruthy();
    expect(frameState.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.more') }));
    fireEvent.click(link(screen.getByRole('dialog'), label('adminNav.submenuStaffReports')));
    expect(screen.getByText('Route: /staff/attendance-report')).toBeTruthy();
  });
});

describe('the Soon mark in the rendered frame', () => {
  it('is on every not-built page: in the pills of its sub-menu, or on the tab of an all-not-built sub-menu', () => {
    const ctx = {
      translate: (key: Parameters<typeof t>[1]) => t('en', key),
      pathname: '/',
      visibleIds: frameState.visible,
    };
    const lists = resolveTopLevels('A', ctx).flatMap((group) => group.lists);
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    let checked = 0;
    for (const list of lists) {
      const soonPages = list.pages.filter((page) => page.status !== undefined);
      if (soonPages.length === 0) continue;
      goTo(list.pages[0]?.href ?? '/');
      for (const page of soonPages) {
        const scope = list.pages.length > 1 ? pillsNav() : tabsNav();
        const target = list.pages.length > 1 ? page.label : list.label;
        const shown = within(scope)
          .getAllByRole('link')
          .find((item) => item.textContent?.startsWith(target));
        expect(shown?.textContent).toContain(label('adminNav.soonBadge'));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

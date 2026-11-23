import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NAVIGATION_PAGES } from '../navigation-model';
import { Destination } from './focus-destination';
import {
  frameState,
  goTo,
  renderFrame,
  resetFrameState,
  selectBusiness,
  stubViewport,
} from './frame-test-support';
import { StyleCFrame } from './style-c-frame';

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
const rail = (workspace: Parameters<typeof t>[1]) =>
  screen.getByRole('button', { name: new RegExp(`^${label(workspace)}`) });
const panelRegion = () =>
  screen.queryByRole('complementary', { name: label('adminNav.localNavigation') });
const floatingPanel = () =>
  screen.queryByRole('dialog', { name: label('adminNav.localNavigation') });
const toggle = () => screen.getByRole('button', { name: label('adminNav.togglePanel') });
const finderTrigger = () => screen.getByRole('button', { name: label('adminNav.pageFinderLabel') });

const page = () => (
  <StyleCFrame>
    <Destination />
  </StyleCFrame>
);

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['ltr', 'rtl'] as const)('style C in %s', (dir) => {
  it('marks the current workspace on the rail and the current page in the panel', () => {
    frameState.pathname = '/staff/import';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>, dir);
    const team = rail('adminNav.workspaceCTeam');
    expect(team.getAttribute('aria-label')).toContain(label('adminNav.currentStyleBadge'));
    expect(team.hasAttribute('data-current')).toBe(true);
    const panel = within(panelRegion() as HTMLElement);
    expect(panel.getByRole('link', { name: /Import employees/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(panel.getByRole('link', { name: /^Employees/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getAllByRole('navigation').some((nav) => nav.getAttribute('dir') === dir)).toBe(
      true,
    );
  });

  it('keeps Staff app columns out of Employees', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>, dir);
    const panel = within(panelRegion() as HTMLElement);
    expect(
      panel.getByRole('link', { name: /Staff app columns/ }).getAttribute('aria-current'),
    ).toBe('page');
    expect(rail('adminNav.workspaceCBusiness').hasAttribute('data-current')).toBe(true);
  });
});

describe('style C visibility and the page finder', () => {
  const openFinder = (query: string) => {
    fireEvent.click(finderTrigger());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  };

  it('omits a workspace and a panel section whose pages are all hidden', () => {
    frameState.visible = ['dashboard', 'record-visit'];
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${label('adminNav.workspaceCTeam')}`) }),
    ).toBeNull();
    expect(screen.queryByText(label('adminNav.submenuPay'))).toBeNull();
    expect(rail('adminNav.workspaceCFrontDesk')).toBeTruthy();
  });

  it('finds a restaurant-only page by name with its Soon mark, and loses it for a salon', () => {
    const { unmount } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openFinder('kitchen');
    const found = screen.getByRole('link', { name: /Kitchen screens/ });
    expect(found.textContent).toContain(label('adminNav.soonBadge'));
    expect(found.getAttribute('href')).toBe('/soon/kitchen-screens');
    unmount();
    selectBusiness('salon');
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openFinder('kitchen');
    expect(screen.queryByRole('link', { name: /Kitchen screens/ })).toBeNull();
    expect(screen.getByText(label('adminNav.pageFinderEmpty'))).toBeTruthy();
  });

  it('drops the page from an open finder when the selected business changes to a salon', () => {
    const { rerenderFrame } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openFinder('kitchen');
    expect(screen.getByRole('link', { name: /Kitchen screens/ })).toBeTruthy();
    selectBusiness('salon');
    rerenderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(screen.queryByRole('link', { name: /Kitchen screens/ })).toBeNull();
    expect(screen.getByText(label('adminNav.pageFinderEmpty'))).toBeTruthy();
  });

  it('lists every visible not-built page in the finder, each with the Soon mark', () => {
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openFinder('');
    const soonPages = NAVIGATION_PAGES.filter(
      (entry) => entry.state === 'soon' && frameState.visible.includes(entry.id),
    );
    expect(soonPages.length).toBeGreaterThan(20);
    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    for (const entry of soonPages) {
      const found = links.filter((item) => item.getAttribute('href') === `/soon/${entry.id}`);
      expect(found).toHaveLength(1);
      expect(found[0]?.textContent).toContain(label('adminNav.soonBadge'));
    }
  });
});

describe('style C finder across routes', () => {
  it('keeps the same finder button after a navigation and opens a result through the router', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    const trigger = finderTrigger();
    goTo('/leave');
    expect(finderTrigger()).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'import employees' } });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('link', { name: /Import employees/ }),
    );
    expect(screen.getByRole('heading', { name: 'Destination /staff/import' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes an open finder on navigation and does not reopen it on the way back', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    fireEvent.click(finderTrigger());
    expect(screen.getByRole('dialog')).toBeTruthy();
    goTo('/leave');
    expect(screen.queryByRole('dialog')).toBeNull();
    goTo('/staff');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('style C on a tablet', () => {
  const openPanel = () => fireEvent.click(rail('adminNav.workspaceCTeam'));

  beforeEach(() => stubViewport(820));

  it('starts with the floating panel closed and still shows the account controls', () => {
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(floatingPanel()).toBeNull();
    expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Synthetic business/ })).toBeTruthy();
  });

  it('follows a plain click through the router: route changes, panel closes, the page keeps focus', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    openPanel();
    fireEvent.click(
      within(floatingPanel() as HTMLElement).getByRole('link', { name: /Import employees/ }),
    );
    expect(screen.getByRole('heading', { name: 'Destination /staff/import' })).toBeTruthy();
    expect(floatingPanel()).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Destination /staff/import' }),
    );
  });

  it('keeps the panel open and the route unchanged on a modified click', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    openPanel();
    fireEvent.click(
      within(floatingPanel() as HTMLElement).getByRole('link', { name: /Import employees/ }),
      {
        ctrlKey: true,
      },
    );
    expect(floatingPanel()).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Destination /staff', hidden: true })).toBeTruthy();
  });

  it('does not reopen the panel when the user goes back to the page it was opened on', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    openPanel();
    expect(floatingPanel()).toBeTruthy();
    goTo('/staff/import');
    expect(floatingPanel()).toBeNull();
    goTo('/staff');
    expect(floatingPanel()).toBeNull();
  });

  it('returns focus to the control that opened the panel, rail or toolbar', async () => {
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    rail('adminNav.workspaceCTeam').focus();
    openPanel();
    fireEvent.keyDown(floatingPanel() as HTMLElement, { key: 'Escape' });
    expect(floatingPanel()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rail('adminNav.workspaceCTeam')));
    toggle().focus();
    fireEvent.click(toggle());
    expect(floatingPanel()).toBeTruthy();
    fireEvent.keyDown(floatingPanel() as HTMLElement, { key: 'Escape' });
    expect(floatingPanel()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
  });
});

describe('style C panel on a desktop', () => {
  it('forgets a previewed workspace on the way out, so coming back shows the current one', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    fireEvent.click(rail('adminNav.workspaceCStock'));
    expect(
      within(panelRegion() as HTMLElement).getByRole('link', { name: /^Services/ }),
    ).toBeTruthy();
    goTo('/staff/import');
    const afterGoing = within(panelRegion() as HTMLElement);
    expect(afterGoing.queryByRole('link', { name: /^Services/ })).toBeNull();
    expect(afterGoing.getByRole('link', { name: /Import employees/ })).toBeTruthy();
    goTo('/staff');
    const afterBack = within(panelRegion() as HTMLElement);
    expect(afterBack.queryByRole('link', { name: /^Services/ })).toBeNull();
    expect(afterBack.getByRole('link', { name: /^Employees/ })).toBeTruthy();
  });

  it('toggles from the top bar button and keeps the choice across pages', () => {
    frameState.pathname = '/staff';
    renderFrame(page());
    expect(panelRegion()).toBeTruthy();
    fireEvent.click(toggle());
    expect(panelRegion()).toBeNull();
    goTo('/staff/import');
    expect(panelRegion()).toBeNull();
    fireEvent.click(toggle());
    expect(panelRegion()).toBeTruthy();
  });
});

describe('style C on a phone', () => {
  beforeEach(() => stubViewport(390));
  const tabs = () => screen.getByRole('navigation', { name: label('adminNav.workspacesLabel') });

  it('shows the five workspaces as bottom tabs with the current one marked', () => {
    frameState.pathname = '/catalog';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(within(tabs()).getAllByRole('link')).toHaveLength(5);
    expect(
      within(tabs())
        .getByRole('link', { name: label('adminNav.workspaceCStock') })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('opens a workspace tab on its overview and keeps that workspace marked there', () => {
    frameState.pathname = '/catalog';
    renderFrame(page());
    fireEvent.click(within(tabs()).getByRole('link', { name: label('adminNav.workspaceCTeam') }));
    expect(screen.getByRole('heading', { name: 'Destination /overview/team' })).toBeTruthy();
    const team = within(tabs()).getByRole('link', { name: label('adminNav.workspaceCTeam') });
    expect(team.getAttribute('aria-current')).toBe('page');
    expect(
      within(tabs())
        .getByRole('link', { name: label('adminNav.workspaceCStock') })
        .getAttribute('aria-current'),
    ).toBeNull();
  });
});

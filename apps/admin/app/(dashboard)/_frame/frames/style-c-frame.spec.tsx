import { t } from '@pospay/i18n';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  frameState,
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
const railButton = (name: RegExp) => screen.getByRole('button', { name });

function Destination() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <h1 ref={heading} tabIndex={-1}>
      Destination page
    </h1>
  );
}

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['ltr', 'rtl'] as const)('style C in %s', (dir) => {
  it('marks the current workspace on the rail and the current page in the panel', () => {
    frameState.pathname = '/staff/import';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>, dir);
    const team = railButton(new RegExp(`^${label('adminNav.workspaceCTeam')}`));
    expect(team.getAttribute('aria-label')).toContain(label('adminNav.currentStyleBadge'));
    expect(team.hasAttribute('data-current')).toBe(true);
    const panel = screen.getByRole('complementary', { name: label('adminNav.localNavigation') });
    expect(
      within(panel)
        .getByRole('link', { name: /Import employees/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(panel)
        .getByRole('link', { name: /^Employees/ })
        .getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.getAllByRole('navigation').some((nav) => nav.getAttribute('dir') === dir)).toBe(
      true,
    );
  });

  it('keeps Staff app columns out of Employees', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>, dir);
    const panel = screen.getByRole('complementary', { name: label('adminNav.localNavigation') });
    expect(
      within(panel)
        .getByRole('link', { name: /Staff app columns/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      railButton(new RegExp(`^${label('adminNav.workspaceCBusiness')}`)).hasAttribute(
        'data-current',
      ),
    ).toBe(true);
  });
});

describe('style C visibility', () => {
  it('omits a workspace and a panel section whose pages are all hidden', () => {
    frameState.visible = ['dashboard', 'record-visit'];
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${label('adminNav.workspaceCTeam')}`) }),
    ).toBeNull();
    expect(screen.queryByText(label('adminNav.submenuPay'))).toBeNull();
    expect(
      screen.getByRole('button', { name: new RegExp(`^${label('adminNav.workspaceCFrontDesk')}`) }),
    ).toBeTruthy();
  });

  it('finds a restaurant-only page by name with its Soon mark, and loses it for a salon', () => {
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kitchen' } });
    };
    const { unmount } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    open();
    const found = screen.getByRole('link', { name: /Kitchen screens/ });
    expect(found.textContent).toContain(label('adminNav.soonBadge'));
    expect(found.getAttribute('href')).toBe('/soon/kitchen-screens');
    unmount();
    selectBusiness('salon');
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    open();
    expect(screen.queryByRole('link', { name: /Kitchen screens/ })).toBeNull();
    expect(screen.getByText(label('adminNav.pageFinderEmpty'))).toBeTruthy();
  });
});

describe('style C on a tablet', () => {
  const openPanel = () =>
    fireEvent.click(railButton(new RegExp(`^${label('adminNav.workspaceCTeam')}`)));
  const panel = () => screen.queryByRole('dialog', { name: label('adminNav.localNavigation') });

  beforeEach(() => stubViewport(820));

  it('starts with the floating panel closed and still shows the account controls', () => {
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(panel()).toBeNull();
    expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Synthetic business/ })).toBeTruthy();
  });

  it('closes the panel after a same-tab navigation and leaves focus with the destination page', () => {
    frameState.pathname = '/staff';
    const { rerenderFrame } = renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openPanel();
    expect(panel()).toBeTruthy();
    frameState.pathname = '/staff/import';
    rerenderFrame(
      <StyleCFrame>
        <Destination />
      </StyleCFrame>,
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Destination page' }));
  });

  it('keeps the panel open when the link is followed with a modifier key', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openPanel();
    const link = within(panel() as HTMLElement).getByRole('link', { name: /Import employees/ });
    fireEvent.click(link, { ctrlKey: true });
    expect(panel()).toBeTruthy();
    expect(frameState.push).not.toHaveBeenCalled();
  });

  it('opens the page in the same tab through the router on a plain click', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    openPanel();
    fireEvent.click(within(panel() as HTMLElement).getByRole('link', { name: /Import employees/ }));
    expect(frameState.push).toHaveBeenCalledWith('/staff/import');
  });
});

describe('style C on a phone', () => {
  it('shows the five workspaces as bottom tabs with the current one marked', () => {
    stubViewport(390);
    frameState.pathname = '/catalog';
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    const tabs = screen.getByRole('navigation', { name: label('adminNav.workspacesLabel') });
    expect(within(tabs).getAllByRole('link')).toHaveLength(5);
    expect(
      within(tabs)
        .getByRole('link', { name: label('adminNav.workspaceCStock') })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('keeps the page finder reachable', () => {
    stubViewport(390);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    expect(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') })).toBeTruthy();
  });
});

it('toggles the desktop panel from the top bar button', () => {
  renderFrame(<StyleCFrame>Page body</StyleCFrame>);
  const toggle = screen.getByRole('button', { name: label('adminNav.togglePanel') });
  expect(
    screen.getByRole('complementary', { name: label('adminNav.localNavigation') }),
  ).toBeTruthy();
  act(() => toggle.click());
  expect(
    screen.queryByRole('complementary', { name: label('adminNav.localNavigation') }),
  ).toBeNull();
  act(() => toggle.click());
  expect(
    screen.getByRole('complementary', { name: label('adminNav.localNavigation') }),
  ).toBeTruthy();
});

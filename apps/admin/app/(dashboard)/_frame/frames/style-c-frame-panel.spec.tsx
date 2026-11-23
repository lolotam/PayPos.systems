import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  frameState,
  goTo,
  renderFrame,
  resetFrameState,
  resizeTo,
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
const floatingPanel = () =>
  screen.queryByRole('dialog', { name: label('adminNav.localNavigation') });

beforeEach(() => {
  resetFrameState();
  frameState.pathname = '/staff';
});

describe('style C floating panel and the desktop preference', () => {
  it('closes on a plain click on the current page link, and not on a modified click', () => {
    stubViewport(820);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCTeam'));
    const own = () =>
      within(floatingPanel() as HTMLElement).getByRole('link', { name: /^Employees/ });
    fireEvent.click(own(), { ctrlKey: true });
    expect(floatingPanel()).toBeTruthy();
    fireEvent.click(own());
    expect(floatingPanel()).toBeNull();
  });

  it('does not reopen after the viewport leaves the tablet width and comes back', () => {
    stubViewport(820);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCTeam'));
    expect(floatingPanel()).toBeTruthy();
    resizeTo(1280);
    resizeTo(820);
    expect(floatingPanel()).toBeNull();
  });

  it('does not open the tablet modal later because of a desktop open or inspect', () => {
    stubViewport(1280);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCStock'));
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.togglePanel') }));
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.togglePanel') }));
    resizeTo(820);
    expect(floatingPanel()).toBeNull();
  });

  it('keeps the desktop choice when the panel is closed on a tablet', () => {
    stubViewport(820);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCTeam'));
    fireEvent.keyDown(floatingPanel() as HTMLElement, { key: 'Escape' });
    resizeTo(1280);
    expect(
      screen.getByRole('complementary', { name: label('adminNav.localNavigation') }),
    ).toBeTruthy();
  });
});

describe('style C overlays on a query-only move', () => {
  it('closes the floating panel', () => {
    stubViewport(820);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCTeam'));
    goTo('/staff?filter=1');
    expect(floatingPanel()).toBeNull();
  });

  it('closes the page finder', () => {
    stubViewport(1280);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
    goTo('/staff?filter=1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the workspace a desktop user is previewing, because only a filter changed', () => {
    stubViewport(1280);
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    fireEvent.click(rail('adminNav.workspaceCStock'));
    goTo('/staff?filter=2');
    const panel = screen.getByRole('complementary', { name: label('adminNav.localNavigation') });
    expect(within(panel).getByRole('link', { name: /^Services/ })).toBeTruthy();
  });
});

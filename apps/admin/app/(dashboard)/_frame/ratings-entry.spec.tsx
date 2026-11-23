import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enterWorkspace, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { CurrentRoute } from './frames/current-route';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';

vi.mock('next/navigation', async () => (await import('./frames/frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frames/frame-test-support')).localeMock,
);
vi.mock(
  './menu/use-visible-page-ids',
  async () => (await import('./frames/frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./dashboard-mocks')).dashboardWorkspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./dashboard-mocks')).dashboardSessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frames/frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frames/frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frames/frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const entry = () => screen.queryAllByRole('link', { name: label('ratings.title') });
// frame-test-support gives the ratings read to the four manager roles only, like the real read.
const GRANTED = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const REFUSED = ['accountant', 'cashier', 'viewer', 'custom_admin'];

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
  frameState.pathname = '/ratings';
});

describe.each(['A', 'B', 'C'] as const)('the Ratings entry in style %s', (style) => {
  it.each(GRANTED)('is in the menu, at its own address, for the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, style);
    const links = entry();
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute('href') === '/ratings')).toBe(true);
    expect(links.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it.each(REFUSED)('is not in the menu for the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, style);
    expect(entry()).toHaveLength(0);
  });
});

describe('the Ratings entry in the page finder', () => {
  const search = () => {
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ratings' } });
    return within(screen.getByRole('dialog'));
  };

  it('is found when the read is granted', () => {
    enterWorkspace('salon', 'owner');
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, 'C');
    expect(
      search().getByRole('link', { name: /^Ratings/ }).getAttribute('href'),
    ).toBe('/ratings');
  });

  it.each(REFUSED)('is not found by the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, 'C');
    expect(search().queryByRole('link', { name: /^Ratings/ })).toBeNull();
  });
});
